import type { Lang, QuoteLength } from '../types';
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

export function pickQuote(lang: Lang, length: QuoteLength, rnd: Rng = Math.random): Quote {
  const all = QUOTES[lang];
  const fit = length === 'any' ? all : all.filter((q) => quoteLength(q) === length);
  return pick(fit.length ? fit : all, rnd);
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
