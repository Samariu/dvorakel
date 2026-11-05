import { capitalise, dictionary, pick, type Rng } from '../content/generator';
import type { DrillTarget, Lang } from '../types';
import type { Weakness, WeaknessReport } from './weakness';

const LETTER = /\p{L}/u;
const MAX_CANDIDATES = 40;

/** Real words that exercise a target (frequent words first). */
export function candidatesFor(lang: Lang, target: DrillTarget): string[] {
  const dict = dictionary(lang);
  const key = target.key;
  switch (target.kind) {
    case 'word':
      return [key];
    case 'bigram':
    case 'trigram': {
      const k = key.toLowerCase();
      return firstN(dict.filter((w) => w.toLowerCase().includes(k) && w.length > k.length), MAX_CANDIDATES);
    }
    case 'char':
      return charCandidates(dict, key);
  }
}

function firstN<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function charCandidates(dict: string[], ch: string): string[] {
  if (/\d/.test(ch)) {
    return Array.from({ length: 20 }, (_, i) => String(i * 7 + Number(ch) * 11).replace(/^/, ch));
  }
  if (!LETTER.test(ch)) {
    const base = dict.slice(0, 300);
    const wrap = (w: string) => {
      switch (ch) {
        case '"':
          return `"${w}"`;
        case '(':
        case ')':
          return `(${w})`;
        case "'":
          return `${w}'s`;
        case '-':
          return `${w}-${base[(w.length * 31) % base.length]}`;
        default:
          return w + ch;
      }
    };
    return firstN(base, MAX_CANDIDATES).map(wrap);
  }
  const lower = ch.toLowerCase();
  if (ch !== lower) {
    // Capital letter: words starting with it.
    const caps = dict.filter((w) => w.startsWith(ch));
    if (caps.length >= 5) return firstN(caps, MAX_CANDIDATES);
    return firstN(dict.filter((w) => w.toLowerCase().startsWith(lower)), MAX_CANDIDATES).map(capitalise);
  }
  // Prefer words where the letter occurs more than once, then any.
  const hits = dict.filter((w) => w.includes(ch));
  const multi = hits.filter((w) => w.split(ch).length > 2);
  return firstN([...multi.slice(0, 15), ...hits.filter((w) => !multi.slice(0, 15).includes(w))], MAX_CANDIDATES);
}

/** Generate drill text that cycles through the targets. */
export function drillWords(lang: Lang, targets: DrillTarget[], length = 50, rnd: Rng = Math.random): string[] {
  const groups = targets.map((t) => candidatesFor(lang, t)).filter((g) => g.length > 0);
  if (groups.length === 0) return [];
  const out: string[] = [];
  let prev = '';
  for (let i = 0; i < length; i++) {
    const g = groups[i % groups.length];
    let w = pick(g, rnd);
    for (let tries = 0; w === prev && g.length > 1 && tries < 5; tries++) w = pick(g, rnd);
    out.push(w);
    prev = w;
  }
  // Shuffle in blocks so the same target does not appear in a rigid rhythm.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function toTarget(w: Weakness): DrillTarget {
  const kind = w.kind === 'chars' ? 'char' : w.kind === 'bigrams' ? 'bigram' : w.kind === 'trigrams' ? 'trigram' : 'word';
  return { kind, key: w.key };
}

/** A mixed drill from the strongest signals in the report. */
export function smartTargets(r: WeaknessReport): DrillTarget[] {
  return [
    ...r.bigrams.slice(0, 3),
    ...r.trigrams.slice(0, 2),
    ...r.words.slice(0, 3),
    ...r.chars.slice(0, 2),
  ].map(toTarget);
}

export function targetLabel(t: DrillTarget): string {
  return t.kind === 'word' ? t.key : t.kind === 'char' ? `“${t.key}”` : `-${t.key}-`;
}
