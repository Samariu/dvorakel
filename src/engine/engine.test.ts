import { describe, expect, it } from 'vitest';
import { TypingSession } from './session';
import { computeResult, consistency } from './metrics';
import { keydownAction, textActions } from './input';

/** Types a string with a fixed interval between keys. */
function typeAll(s: TypingSession, text: string, t0 = 1000, dt = 100): number {
  let t = t0;
  for (const ch of text) {
    if (ch === '\b') s.backspace(t);
    else s.typeChar(ch, t);
    t += dt;
  }
  return t;
}

describe('TypingSession', () => {
  it('finishes when the last word is typed correctly (word mode)', () => {
    const s = new TypingSession(['über', 'groß']);
    typeAll(s, 'über groß');
    expect(s.finished).toBe(true);
    expect(s.typed).toEqual(['über', 'groß']);
    const r = computeResult(s.words, s.typed, s.ks, s.elapsedMs(0), false);
    expect(r.acc).toBe(100);
    expect(r.chars).toEqual({ correct: 8, incorrect: 0, extra: 0, missed: 0 });
    // 9 chars (incl. space) in 800 ms → 9/5 * 75 = 135 wpm
    expect(r.wpm).toBe(135);
  });

  it('counts corrected errors against accuracy but not WPM', () => {
    const s = new TypingSession(['the', 'end']);
    typeAll(s, 'thw\be end');
    const r = computeResult(s.words, s.typed, s.ks, s.elapsedMs(0), false);
    expect(s.typed).toEqual(['the', 'end']);
    expect(r.chars.incorrect).toBe(0);
    expect(r.acc).toBeCloseTo((100 * 7) / 8, 1);
  });

  it('allows going back into an incorrect previous word only', () => {
    const s = new TypingSession(['ab', 'cd', 'ef']);
    typeAll(s, 'ax ');
    s.backspace(5000);
    expect(s.wordIndex).toBe(0);
    s.backspace(5100);
    s.typeChar('b', 5200);
    s.typeChar(' ', 5300);
    s.typeChar('c', 5400);
    s.backspace(5500);
    s.backspace(5600); // previous word correct: stays
    expect(s.wordIndex).toBe(1);
  });

  it('ignores backspace in no-backspace mode', () => {
    const s = new TypingSession(['ab'], { noBackspace: true });
    typeAll(s, 'ax\b');
    expect(s.typed[0]).toBe('ax');
  });

  it('ctrl+backspace clears the current word', () => {
    const s = new TypingSession(['hello', 'world']);
    typeAll(s, 'hello wor');
    s.wordBackspace(9000);
    expect(s.typed).toEqual(['hello', '']);
  });

  it('ends timed tests at the limit and extends words', () => {
    let calls = 0;
    const s = new TypingSession(['a', 'b'], {
      timeLimitMs: 1000,
      extendWords: () => {
        calls++;
        return ['c', 'd'];
      },
    });
    s.typeChar('a', 0);
    s.typeChar(' ', 100);
    expect(calls).toBe(1);
    expect(s.tick(999)).toBe(false);
    expect(s.tick(1000)).toBe(true);
    expect(s.elapsedMs(5000)).toBe(1000);
  });

  it('records missed characters for premature spaces', () => {
    const s = new TypingSession(['hello', 'x']);
    typeAll(s, 'hel x');
    const r = computeResult(s.words, s.typed, s.ks, s.elapsedMs(0), false);
    expect(r.chars.missed).toBe(2);
  });

  it('does not allow skipping a word with space', () => {
    const s = new TypingSession(['a', 'b']);
    s.typeChar(' ', 0);
    expect(s.started).toBe(false);
  });
});

describe('consistency', () => {
  it('is 100 for constant speed and lower for uneven speed', () => {
    expect(consistency([60, 60, 60])).toBe(100);
    expect(consistency([30, 90, 30, 90])).toBeLessThan(60);
  });
});

describe('input mapping (Windows AltGr = Ctrl+Alt)', () => {
  it('takes umlauts from beforeinput regardless of modifiers', () => {
    expect(textActions('insertText', 'ü')).toEqual([{ type: 'char', ch: 'ü' }]);
    expect(textActions('insertText', 'ß')).toEqual([{ type: 'char', ch: 'ß' }]);
  });

  it('treats AltGr+Backspace as a plain backspace, Ctrl+Backspace as word delete', () => {
    expect(keydownAction({ key: 'Backspace', ctrlKey: true, altKey: true, metaKey: false })).toEqual({ type: 'back' });
    expect(keydownAction({ key: 'Backspace', ctrlKey: true, altKey: false, metaKey: false })).toEqual({ type: 'wordBack' });
    expect(keydownAction({ key: 'Backspace', ctrlKey: false, altKey: false, metaKey: false })).toEqual({ type: 'back' });
  });

  it('keydown of AltGr letters is not an action', () => {
    expect(keydownAction({ key: 'ä', ctrlKey: true, altKey: true, metaKey: false })).toEqual({ type: 'none' });
  });

  it('normalises typographic characters and ignores other input types', () => {
    expect(textActions('insertText', ' ')).toEqual([{ type: 'char', ch: ' ' }]);
    expect(textActions('deleteContentBackward', null)).toEqual([]);
    expect(textActions('insertLineBreak', null)).toEqual([]);
  });

  it('Tab and Escape restart', () => {
    expect(keydownAction({ key: 'Tab', ctrlKey: false, altKey: false, metaKey: false }).type).toBe('restart');
    expect(keydownAction({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false }).type).toBe('restart');
  });
});

describe('no-backspace mode', () => {
  it('turns a letter typed instead of a space into one error and moves on', () => {
    const s = new TypingSession(['the', 'cat'], { noBackspace: true });
    typeAll(s, 'thecat');
    expect(s.typed).toEqual(['the', 'cat']);
    expect(s.finished).toBe(true);
    const r = computeResult(s.words, s.typed, s.ks, s.elapsedMs(0), false);
    expect(r.acc).toBeCloseTo((100 * 5) / 6, 1);
    expect(r.chars).toEqual({ correct: 6, incorrect: 0, extra: 0, missed: 0 });
    // The missing space is not credited: 6 chars in 500 ms.
    expect(r.wpm).toBeCloseTo((6 / 5) * (60000 / 500), 1);
  });

  it('ends on the last word once it is complete, even with a mistake', () => {
    const s = new TypingSession(['ist', 'herum.'], { noBackspace: true });
    typeAll(s, 'ist herum,');
    expect(s.finished).toBe(true);
  });

  it('normal mode still waits for a correct last word (or a space)', () => {
    const s = new TypingSession(['ist', 'herum.']);
    typeAll(s, 'ist herum,');
    expect(s.finished).toBe(false);
    s.typeChar(' ', 99999);
    expect(s.finished).toBe(true);
  });

  it('keeps normal-mode extra letters at the end of a word', () => {
    const s = new TypingSession(['ab', 'cd']);
    typeAll(s, 'abx');
    expect(s.typed).toEqual(['abx']);
  });
});

describe('raw speed per second', () => {
  it('does not extrapolate a tiny final bucket into a spike', () => {
    // 10 keys/s for 3 s (= 120 raw), last key 50 ms into the 4th second.
    const s = new TypingSession(['x'.repeat(40)]);
    for (let i = 0; i <= 30; i++) s.typeChar('x', i * 100 + (i === 30 ? 50 : 0));
    const r = computeResult(s.words, s.typed, s.ks, 3050, true);
    expect(r.rawSeries).toHaveLength(3);
    expect(Math.max(...r.rawSeries)).toBeLessThan(150);
    expect(r.wpmSeries).toHaveLength(3);
  });
});
