import { K_CHAR, K_MISSED_SPACE, K_SPACE, type CharCounts, type Keystroke, type SessionResult } from '../types';

/** Whether a keystroke typed the expected character at its position. */
export function keystrokeCorrect(k: Keystroke, words: string[]): boolean {
  const [, w, c, kind, ch] = k;
  const target = words[w] ?? '';
  if (kind === K_SPACE) return c === target.length;
  // K_MISSED_SPACE is always wrong: a letter where the space should be.
  if (kind === K_CHAR) return c < target.length && target[c] === ch;
  return false;
}

export function countChars(words: string[], typed: string[], finishedByTime: boolean): CharCounts {
  const r: CharCounts = { correct: 0, incorrect: 0, extra: 0, missed: 0 };
  const last = typed.length - 1;
  typed.forEach((s, i) => {
    const w = words[i] ?? '';
    const n = Math.min(s.length, w.length);
    for (let j = 0; j < n; j++) {
      if (s[j] === w[j]) r.correct++;
      else r.incorrect++;
    }
    r.extra += Math.max(0, s.length - w.length);
    const partial = i === last && finishedByTime;
    if (!partial && s.length < w.length) r.missed += w.length - s.length;
  });
  return r;
}

export const isTyping = (k: Keystroke) => k[3] === K_CHAR || k[3] === K_SPACE || k[3] === K_MISSED_SPACE;

/** Words whose space was replaced by a letter (no-backspace mode). */
export function missedSpaceWords(ks: Keystroke[]): Set<number> {
  return new Set(ks.filter((k) => k[3] === K_MISSED_SPACE).map((k) => k[1]));
}

/**
 * Characters that count for net WPM: fully correct words plus their spaces.
 * A space that was replaced by a letter is not credited.
 */
export function wpmChars(words: string[], typed: string[], finishedByTime: boolean, missedSpace = new Set<number>()): number {
  let n = 0;
  const last = typed.length - 1;
  typed.forEach((s, i) => {
    const w = words[i] ?? '';
    if (s === w) n += w.length + (i < last && !missedSpace.has(i) ? 1 : 0);
    else if (i === last && finishedByTime && w.startsWith(s)) n += s.length;
  });
  return n;
}

const perMinute = (chars: number, ms: number) => (ms > 0 ? (chars / 5) * (60000 / ms) : 0);

export function computeResult(
  words: string[],
  typed: string[],
  ks: Keystroke[],
  durationMs: number,
  finishedByTime: boolean,
): SessionResult {
  const typing = ks.filter(isTyping);
  const correctKs = typing.filter((k) => keystrokeCorrect(k, words)).length;
  // Round instead of ceil, so the last bucket is 0.5–1.5 s long. A bucket of a
  // few milliseconds would otherwise be extrapolated to a huge raw speed.
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const rawSeries = new Array<number>(seconds).fill(0);
  const errSeries = new Array<number>(seconds).fill(0);
  const correctPerSec = new Array<number>(seconds).fill(0);
  for (const k of typing) {
    const b = Math.min(seconds - 1, Math.floor(k[0] / 1000));
    rawSeries[b]++;
    if (keystrokeCorrect(k, words)) correctPerSec[b]++;
    else errSeries[b]++;
  }
  const wpmSeries: number[] = [];
  let cum = 0;
  for (let i = 0; i < seconds; i++) {
    cum += correctPerSec[i];
    const ms = i === seconds - 1 ? durationMs : (i + 1) * 1000;
    wpmSeries.push(round1(perMinute(cum, ms)));
  }
  // The last bucket is 0.5–1.5 s long: scale it to one second.
  const lastLen = durationMs - (seconds - 1) * 1000;
  const lastScale = seconds > 1 && lastLen > 0 ? 1000 / lastLen : durationMs > 0 ? 1000 / durationMs : 1;
  const rawPerSec = rawSeries.map((n, i) => n * 12 * (i === seconds - 1 ? lastScale : 1));
  const full = seconds > 2 ? rawPerSec.slice(0, -1) : rawPerSec;
  return {
    wpm: round1(perMinute(wpmChars(words, typed, finishedByTime, missedSpaceWords(ks)), durationMs)),
    raw: round1(perMinute(typing.length, durationMs)),
    acc: typing.length ? round1((100 * correctKs) / typing.length) : 0,
    consistency: round1(consistency(full)),
    durationMs: Math.round(durationMs),
    chars: countChars(words, typed, finishedByTime),
    wpmSeries,
    rawSeries: rawPerSec.map(round1),
    errSeries,
  };
}

/** 100 = perfectly even speed; based on the coefficient of variation. */
export function consistency(values: number[]): number {
  if (values.length < 2) return 100;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return Math.max(0, 100 * (1 - sd / mean));
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
