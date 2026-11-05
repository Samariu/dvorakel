import { K_BACK, K_CHAR, K_SPACE, K_WORD_BACK, type Keystroke } from '../types';

export interface SessionOptions {
  noBackspace?: boolean;
  /** Time limit in ms (time mode). */
  timeLimitMs?: number;
  /** Called to get more words when the typist approaches the end (time mode). */
  extendWords?: () => string[];
}

/** Max characters that may be typed beyond the end of a word. */
export const MAX_EXTRA = 8;

/**
 * Mutable, framework-free state machine for one typing test.
 * All timestamps are absolute (e.g. performance.now() / event.timeStamp);
 * keystrokes are stored relative to the first keystroke.
 */
export class TypingSession {
  readonly words: string[];
  readonly typed: string[] = [''];
  wordIndex = 0;
  readonly ks: Keystroke[] = [];
  startT: number | null = null;
  endT: number | null = null;
  private readonly opts: SessionOptions;

  constructor(words: string[], opts: SessionOptions = {}) {
    if (words.length === 0) throw new Error('A test needs at least one word');
    this.words = [...words];
    this.opts = opts;
  }

  get started(): boolean {
    return this.startT !== null;
  }

  get finished(): boolean {
    return this.endT !== null;
  }

  get noBackspace(): boolean {
    return !!this.opts.noBackspace;
  }

  get timeLimitMs(): number | undefined {
    return this.opts.timeLimitMs;
  }

  elapsedMs(now: number): number {
    if (this.startT === null) return 0;
    return (this.endT ?? now) - this.startT;
  }

  /** Type one character (space submits the current word). */
  typeChar(ch: string, t: number): void {
    if (this.finished) return;
    if (this.tick(t)) return;
    const w = this.wordIndex;
    const cur = this.typed[w];
    if (ch === ' ') {
      if (cur.length === 0) return; // no skipping words with space
      this.start(t);
      this.record(t, w, cur.length, K_SPACE, ' ');
      if (w === this.words.length - 1) {
        this.endT = t;
        return;
      }
      this.wordIndex++;
      this.typed.push('');
      this.maybeExtend();
      return;
    }
    if (cur.length >= this.words[w].length + MAX_EXTRA) return;
    this.start(t);
    this.record(t, w, cur.length, K_CHAR, ch);
    this.typed[w] = cur + ch;
    // Word / quote mode: the test ends as soon as the last word is correct.
    if (w === this.words.length - 1 && this.typed[w] === this.words[w] && !this.opts.timeLimitMs) {
      this.endT = t;
    }
  }

  backspace(t: number): void {
    if (this.finished || this.noBackspace || !this.started) return;
    if (this.tick(t)) return;
    const w = this.wordIndex;
    const cur = this.typed[w];
    if (cur.length > 0) {
      this.record(t, w, cur.length, K_BACK, '');
      this.typed[w] = cur.slice(0, -1);
    } else if (this.canGoBack()) {
      this.typed.pop();
      this.wordIndex--;
      this.record(t, this.wordIndex, this.typed[this.wordIndex].length, K_BACK, '');
    }
  }

  /** Ctrl+Backspace: clear the current word (or the previous incorrect one). */
  wordBackspace(t: number): void {
    if (this.finished || this.noBackspace || !this.started) return;
    if (this.tick(t)) return;
    let w = this.wordIndex;
    if (this.typed[w].length === 0) {
      if (!this.canGoBack()) return;
      this.typed.pop();
      this.wordIndex--;
      w = this.wordIndex;
    }
    this.record(t, w, this.typed[w].length, K_WORD_BACK, '');
    this.typed[w] = '';
  }

  /** Ends a timed test once the limit is reached. Returns true if finished. */
  tick(now: number): boolean {
    if (this.finished) return true;
    const limit = this.opts.timeLimitMs;
    if (limit && this.startT !== null && now - this.startT >= limit) {
      this.endT = this.startT + limit;
      return true;
    }
    return false;
  }

  /** Words that were reached (for storing). */
  reachedWords(): string[] {
    return this.words.slice(0, this.typed.length);
  }

  private canGoBack(): boolean {
    const p = this.wordIndex - 1;
    return p >= 0 && this.typed[p] !== this.words[p];
  }

  private start(t: number) {
    if (this.startT === null) this.startT = t;
  }

  private record(t: number, w: number, c: number, kind: number, ch: string) {
    this.ks.push([Math.round((t - (this.startT ?? t)) * 10) / 10, w, c, kind, ch]);
  }

  private maybeExtend() {
    const ext = this.opts.extendWords;
    if (ext && this.words.length - this.wordIndex < 40) this.words.push(...ext());
  }
}
