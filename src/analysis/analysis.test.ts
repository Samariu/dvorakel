import { describe, expect, it } from 'vitest';
import { TypingSession } from '../engine/session';
import { computeResult } from '../engine/metrics';
import type { SessionRecord } from '../types';
import { extract, wordCore } from './extract';
import { rankWeaknesses, weaknessReport, aggregate, weightedMedian } from './weakness';
import { candidatesFor, drillWords } from './drills';

/** Type `text` against `words`; `slow` maps a char to an extra delay before it. */
function play(words: string[], text: string, slow: Record<string, number> = {}, dt = 150) {
  const s = new TypingSession(words);
  let t = 1000;
  for (const ch of text) {
    t += dt + (slow[ch] ?? 0);
    if (ch === '\b') s.backspace(t);
    else s.typeChar(ch, t);
  }
  return s;
}

function record(s: TypingSession, startedAt = 0): SessionRecord {
  return {
    ...computeResult(s.words, s.typed, s.ks, s.elapsedMs(0), false),
    startedAt,
    dateKey: '2026-01-01',
    lang: 'de',
    mode: { kind: 'words', count: s.words.length },
    punctuation: false,
    numbers: false,
    noBackspace: false,
    words: s.reachedWords(),
    typed: s.typed,
    ks: s.ks,
  };
}

describe('extract', () => {
  it('collects bigram/trigram latencies only in flow', () => {
    const s = play(['schön', 'aber'], 'schön aber', { 'ö': 400 });
    const ex = extract(s.words, s.typed, s.ks);
    const oe = ex.bigrams.find((b) => b.key === 'hö');
    expect(oe?.ms).toBe(550);
    expect(ex.bigrams.find((b) => b.key === 'sc')?.ms).toBe(150);
    expect(ex.trigrams.map((t) => t.key)).toContain('chö');
    // First char of the first word has no previous keystroke → untimed.
    expect(ex.chars[0]).toEqual({ key: 's', ms: undefined, err: false });
    expect(ex.words.map((w) => w.key)).toEqual(['schön', 'aber']);
  });

  it('attributes errors to the expected character, first attempt only', () => {
    const s = play(['groß'], 'grox\bß');
    const ex = extract(s.words, s.typed, s.ks);
    const sz = ex.chars.filter((c) => c.key === 'ß');
    expect(sz).toEqual([{ key: 'ß', ms: undefined, err: true }]);
    expect(ex.bigrams.find((b) => b.key === 'oß')?.err).toBe(true);
    expect(ex.words[0].err).toBe(true);
  });

  it('strips punctuation from word keys', () => {
    expect(wordCore('"Haus,"')).toBe('Haus');
    expect(wordCore('42')).toBe('');
  });
});

describe('weakness ranking', () => {
  it('ranks a consistently slow character first', () => {
    const sessions: SessionRecord[] = [];
    for (let i = 0; i < 6; i++) {
      const words = ['müde', 'früh', 'grün', 'ruhe', 'brauchen'];
      const s = play(words, words.join(' '), { 'ü': 600 });
      sessions.push(record(s, i));
    }
    const r = weaknessReport(sessions);
    expect(r.chars[0].key).toBe('ü');
    expect(r.chars[0].slowness).toBeGreaterThan(2);
  });

  it('respects minimum sample counts', () => {
    const s = play(['ab'], 'ab');
    const { agg } = aggregate([record(s)]);
    expect(rankWeaknesses(agg.bigrams, 'bigrams')).toEqual([]);
  });

  it('weighs recent sessions more', () => {
    const old = play(['ab', 'ab'], 'ab ab', { b: 800 });
    const recent = play(['ab', 'ab'], 'ab ab');
    const { agg } = aggregate([record(old, 1), record(recent, 2)]);
    const st = agg.bigrams.get('ab')!;
    const mean = st.msSum / st.msN;
    expect(mean).toBeLessThan((150 + 950) / 2);
  });
});

describe('drills', () => {
  it('finds real words containing a weak n-gram', () => {
    const c = candidatesFor('de', { kind: 'trigram', key: 'sch' });
    expect(c.length).toBeGreaterThan(10);
    expect(c.every((w) => w.toLowerCase().includes('sch'))).toBe(true);
  });

  it('finds words for umlauts and capitals', () => {
    expect(candidatesFor('de', { kind: 'char', key: 'ü' }).every((w) => w.includes('ü'))).toBe(true);
    expect(candidatesFor('de', { kind: 'char', key: 'Ä' }).every((w) => w.startsWith('Ä'))).toBe(true);
    expect(candidatesFor('en', { kind: 'char', key: ',' })[0]).toMatch(/,$/);
  });

  it('cycles through all targets', () => {
    const words = drillWords('en', [
      { kind: 'word', key: 'because' },
      { kind: 'bigram', key: 'th' },
    ], 20, () => 0.3);
    expect(words).toHaveLength(20);
    expect(words.filter((w) => w === 'because')).toHaveLength(10);
    expect(words.filter((w) => w.includes('th')).length).toBeGreaterThanOrEqual(10);
  });
});

describe('weightedMedian', () => {
  it('uses sample weights so rare keys do not shift the baseline', () => {
    expect(weightedMedian([[10, 1], [10, 1], [10, 1], [100, 50]])).toBe(100);
    expect(weightedMedian([])).toBe(0);
  });
});
