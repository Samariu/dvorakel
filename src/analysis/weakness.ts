import type { SessionRecord } from '../types';
import { extract, type Extracted, type Sample } from './extract';

export type StatKind = keyof Extracted; // 'chars' | 'bigrams' | 'trigrams' | 'words'

export interface KeyStat {
  key: string;
  /** Weighted number of observations. */
  n: number;
  /** Weighted number of errors. */
  err: number;
  msSum: number;
  /** Weighted number of timed observations. */
  msN: number;
}

export type Aggregate = Record<StatKind, Map<string, KeyStat>>;

export interface AggregateInfo {
  agg: Aggregate;
  sessions: number;
  keystrokes: number;
}

/** Sessions this many sessions ago count half as much as the newest one. */
export const HALF_LIFE_SESSIONS = 25;
export const MAX_SESSIONS = 150;

function add(map: Map<string, KeyStat>, s: Sample, weight: number) {
  let st = map.get(s.key);
  if (!st) {
    st = { key: s.key, n: 0, err: 0, msSum: 0, msN: 0 };
    map.set(s.key, st);
  }
  st.n += weight;
  if (s.err) st.err += weight;
  if (s.ms !== undefined) {
    st.msSum += s.ms * weight;
    st.msN += weight;
  }
}

/** Aggregate samples over sessions, newest weighted most. `sessions` in any order. */
export function aggregate(sessions: SessionRecord[]): AggregateInfo {
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_SESSIONS);
  const agg: Aggregate = { chars: new Map(), bigrams: new Map(), trigrams: new Map(), words: new Map() };
  let keystrokes = 0;
  sorted.forEach((s, age) => {
    const weight = Math.pow(0.5, age / HALF_LIFE_SESSIONS);
    const ex = extract(s.words, s.typed, s.ks);
    keystrokes += s.ks.length;
    for (const kind of Object.keys(agg) as StatKind[]) {
      for (const sample of ex[kind]) add(agg[kind], sample, weight);
    }
  });
  return { agg, sessions: sorted.length, keystrokes };
}

export interface Weakness {
  key: string;
  kind: StatKind;
  samples: number;
  /** Shrunk average latency (ms; per char for words). */
  ms: number;
  /** Relative to the typical item of this kind: 1.3 = 30 % slower. */
  slowness: number;
  errRate: number;
  /** Expected time cost per occurrence relative to typical (higher = weaker). */
  score: number;
}

export const MIN_SAMPLES: Record<StatKind, number> = { chars: 8, bigrams: 5, trigrams: 4, words: 2 };

/** Pseudo-observations pulling small samples towards the typical value. */
const PRIOR = 3;
/** One error costs about this many typical keystrokes (backspace, retype, hesitation). */
const ERROR_COST = 4;

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function weightedMedian(pairs: [value: number, weight: number][]): number {
  const total = pairs.reduce((a, p) => a + p[1], 0);
  if (total <= 0) return 0;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return sorted[sorted.length - 1][0];
}

/** Rank the weakest items of one kind (weakest first). */
export function rankWeaknesses(map: Map<string, KeyStat>, kind: StatKind, minSamples = MIN_SAMPLES[kind]): Weakness[] {
  // Typical latency: median over all timed samples (each key weighted by its sample count).
  const timed = [...map.values()].filter((s) => s.msN > 0);
  const baseline = weightedMedian(timed.map((s) => [s.msSum / s.msN, s.msN]));
  if (!baseline) return [];
  const res: Weakness[] = [];
  for (const s of map.values()) {
    if (s.n < minSamples) continue;
    const ms = (s.msSum + PRIOR * baseline) / (s.msN + PRIOR);
    const errRate = (s.err + 0.02 * PRIOR) / (s.n + PRIOR);
    const slowness = ms / baseline;
    const score = slowness + ERROR_COST * errRate;
    res.push({ key: s.key, kind, samples: s.n, ms, slowness, errRate, score });
  }
  // Only items that are actually worse than typical are weaknesses.
  return res.filter((w) => w.slowness > 1.05 || w.errRate > 0.05).sort((a, b) => b.score - a.score);
}

export interface WeaknessReport {
  sessions: number;
  keystrokes: number;
  chars: Weakness[];
  bigrams: Weakness[];
  trigrams: Weakness[];
  words: Weakness[];
}

export function weaknessReport(sessions: SessionRecord[]): WeaknessReport {
  const { agg, sessions: n, keystrokes } = aggregate(sessions);
  return {
    sessions: n,
    keystrokes,
    chars: rankWeaknesses(agg.chars, 'chars').filter((w) => w.key !== ' '),
    bigrams: rankWeaknesses(agg.bigrams, 'bigrams'),
    trigrams: rankWeaknesses(agg.trigrams, 'trigrams'),
    words: rankWeaknesses(agg.words, 'words'),
  };
}
