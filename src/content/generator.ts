import type { Lang, QuoteLength, SessionRecord } from '../types';
import enWords from './en/words.json';
import deWords from './de/words.json';
import enLit from './en/literature.json';
import deLit from './de/literature.json';
import enModern from './en/modern.json';
import deModern from './de/modern.json';

export type Rng = () => number;

const WORDS: Record<Lang, string[]> = { en: enWords as string[], de: deWords as string[] };

export interface Quote {
  text: string;
  source: string;
  kind: 'literature' | 'modern';
}

const QUOTES: Record<Lang, Quote[]> = {
  en: [...(enLit as Quote[]), ...(enModern as string[]).map((text) => ({ text, source: 'Everyday sentence', kind: 'modern' as const }))],
  de: [...(deLit as Quote[]), ...(deModern as string[]).map((text) => ({ text, source: 'Alltagssatz', kind: 'modern' as const }))],
};

export const POOL_SIZES = [200, 1000, 5000] as const;

/** Frequency-sorted dictionary (10k words). */
export function dictionary(lang: Lang): string[] {
  return WORDS[lang];
}

export function wordPool(lang: Lang, size: number): string[] {
  return WORDS[lang].slice(0, size);
}

export const pick = <T,>(arr: T[], rnd: Rng): T => arr[Math.floor(rnd() * arr.length)];

export interface WordOptions {
  punctuation: boolean;
  numbers: boolean;
  poolSize: number;
}

export function capitalise(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

function randomNumber(rnd: Rng): string {
  const r = rnd();
  if (r < 0.4) return String(Math.floor(rnd() * 10));
  if (r < 0.75) return String(10 + Math.floor(rnd() * 90));
  if (r < 0.9) return String(1900 + Math.floor(rnd() * 130));
  return String(100 + Math.floor(rnd() * 900));
}

/** Monkeytype-style random words. German keeps its natural noun capitals. */
export function generateWords(lang: Lang, count: number, opts: WordOptions, rnd: Rng = Math.random): string[] {
  const pool = wordPool(lang, opts.poolSize);
  const out: string[] = [];
  let sentenceLeft = 0;
  let prev = '';
  for (let i = 0; i < count; i++) {
    let w = pick(pool, rnd);
    for (let tries = 0; w === prev && tries < 5; tries++) w = pick(pool, rnd);
    prev = w;
    if (opts.numbers && rnd() < 0.1) w = randomNumber(rnd);
    if (opts.punctuation) {
      if (sentenceLeft === 0) {
        sentenceLeft = 4 + Math.floor(rnd() * 9);
        w = capitalise(w);
      }
      sentenceLeft--;
      if (sentenceLeft === 0 || i === count - 1) {
        const r = rnd();
        w += r < 0.7 ? '.' : r < 0.85 ? '?' : '!';
        sentenceLeft = 0;
      } else {
        const r = rnd();
        if (r < 0.1) w += ',';
        else if (r < 0.12) w += ':';
        else if (r < 0.13) w += ';';
        else if (r < 0.16) w = `"${w}"`;
        else if (r < 0.18) w = `(${w})`;
        else if (r < 0.2 && i < count - 2) w += '-' + pick(pool, rnd);
      }
    }
    out.push(w);
  }
  return out;
}

export function quoteLength(q: Quote): QuoteLength {
  const n = q.text.length;
  return n < 120 ? 'short' : n < 220 ? 'medium' : 'long';
}

export function quotes(lang: Lang): Quote[] {
  return QUOTES[lang];
}

/** Stable id of a text as it is typed (FNV-1a over the normalised words). */
export function quoteKey(words: string[]): string {
  let h = 0x811c9dc5;
  const s = words.join(' ');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const keyCache = new WeakMap<Quote, string>();
export function keyOf(q: Quote): string {
  let k = keyCache.get(q);
  if (k === undefined) keyCache.set(q, (k = quoteKey(splitText(q.text))));
  return k;
}

/** Quote key → when it was last used (started), from the session history. */
export function quoteUsage(sessions: SessionRecord[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const s of sessions) {
    // Sessions from before quote keys were stored: a completed quote test holds the whole text.
    const key = s.quoteKey ?? (s.mode.kind === 'quote' && !s.abandoned ? quoteKey(s.words) : undefined);
    if (key) used.set(key, Math.max(used.get(key) ?? 0, s.startedAt));
  }
  return used;
}

function fitting(lang: Lang, length: QuoteLength): Quote[] {
  const all = QUOTES[lang];
  const fit = length === 'any' ? all : all.filter((q) => quoteLength(q) === length);
  return fit.length ? fit : all;
}

/** How many quotes of this length there are and how many you haven't started yet. */
export function quotePoolInfo(lang: Lang, length: QuoteLength, used: ReadonlyMap<string, number>): { total: number; fresh: number } {
  const fit = fitting(lang, length);
  return { total: fit.length, fresh: fit.filter((q) => !used.has(keyOf(q))).length };
}

/**
 * A quote you haven't started yet. Once all of this length are used, one of
 * the quarter you used longest ago, so repeats are as far apart as possible.
 */
export function pickQuote(lang: Lang, length: QuoteLength, used: ReadonlyMap<string, number> = new Map(), rnd: Rng = Math.random): Quote {
  const fit = fitting(lang, length);
  const fresh = fit.filter((q) => !used.has(keyOf(q)));
  if (fresh.length) return pick(fresh, rnd);
  const oldest = [...fit].sort((a, b) => used.get(keyOf(a))! - used.get(keyOf(b))!);
  return pick(oldest.slice(0, Math.max(1, Math.floor(oldest.length / 4))), rnd);
}

/** Split text into words, normalising whitespace and typographic quotes. */
export function splitText(text: string): string[] {
  return text
    .replace(/[“”„»«]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .split(/\s+/)
    .filter(Boolean);
}
