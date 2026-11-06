import { K_CHAR, K_SPACE, type CharCounts, type Keystroke, type SessionResult } from '../types';

/** Whether a keystroke typed the expected character at its position. */
export function keystrokeCorrect(k: Keystroke, words: string[]): boolean {
  const [, w, c, kind, ch] = k;
  const target = words[w] ?? '';
  if (kind === K_SPACE) return c === target.length;
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

/** Characters that count for net WPM: fully correct words plus their spaces. */
export function wpmChars(words: string[], typed: string[], finishedByTime: boolean): number {
  let n = 0;
  const last = typed.length - 1;
  typed.forEach((s, i) => {
    const w = words[i] ?? '';
    if (s === w) n += w.length + (i < last ? 1 : 0);
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
  const typing = ks.filter((k) => k[3] === K_CHAR || k[3] === K_SPACE);
  const correctKs = typing.filter((k) => keystrokeCorrect(k, words)).length;
  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
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
    const ms = Math.min(durationMs, (i + 1) * 1000);
    wpmSeries.push(round1(perMinute(cum, ms)));
  }
  // The last bucket may be partial: scale it to a full second.
  const lastLen = durationMs - (seconds - 1) * 1000;
  const rawPerSec = rawSeries.map((n, i) => n * 12 * (i === seconds - 1 && lastLen > 0 ? 1000 / lastLen : 1));
  const full = seconds > 2 ? rawPerSec.slice(0, -1) : rawPerSec;
  return {
    wpm: round1(perMinute(wpmChars(words, typed, finishedByTime), durationMs)),
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
