import { keystrokeCorrect } from '../engine/metrics';
import { K_CHAR, K_MISSED_SPACE, K_SPACE, type Keystroke } from '../types';

/** One observation of a char / n-gram / word. `ms` only when timing is clean. */
export interface Sample {
  key: string;
  ms?: number;
  err: boolean;
}

export interface Extracted {
  chars: Sample[];
  bigrams: Sample[];
  trigrams: Sample[];
  /** For words, `ms` is milliseconds per character. */
  words: Sample[];
}

/** Gaps longer than this are pauses, not typing speed. */
export const MAX_GAP_MS = 2000;

const LETTER = /[\p{L}]/u;

/** Strip surrounding punctuation from a target word: `"Haus,"` → `Haus`. */
export function wordCore(w: string): string {
  return w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
}

/**
 * Turn a session's keystrokes into per-char, bigram, trigram and word samples.
 * Only the first attempt at each position counts; retypes after backspace do not.
 */
export function extract(words: string[], typed: string[], ks: Keystroke[]): Extracted {
  const out: Extracted = { chars: [], bigrams: [], trigrams: [], words: [] };
  const visited = new Set<string>();
  const ok = ks.map((k) => keystrokeCorrect(k, words));

  /** Is keystroke j a correct char at (w, c)? */
  const correctCharAt = (j: number, w: number, c: number) =>
    j >= 0 && ks[j][3] === K_CHAR && ks[j][1] === w && ks[j][2] === c && ok[j];

  for (let i = 0; i < ks.length; i++) {
    const [t, w, c, kind, ch] = ks[i];
    if (kind === K_MISSED_SPACE) {
      // The letter typed instead of the space is the first attempt at the next word.
      const next = words[w + 1];
      const pos = `${w + 1}:0`;
      if (next && !visited.has(pos)) {
        visited.add(pos);
        out.chars.push({ key: next[0], ms: undefined, err: ch !== next[0] });
      }
      continue;
    }
    const target = words[w] ?? '';
    if ((kind !== K_CHAR && kind !== K_SPACE) || c >= target.length) continue;
    const pos = `${w}:${c}`;
    if (visited.has(pos)) continue;
    visited.add(pos);

    // A premature space is an error on the character that was expected.
    const correct = kind === K_CHAR && ok[i];
    const expected = target[c];
    const gap = i > 0 ? t - ks[i - 1][0] : Infinity;
    const prevOk =
      i > 0 &&
      (correctCharAt(i - 1, w, c - 1) || (c === 0 && ks[i - 1][3] === K_SPACE && ks[i - 1][1] === w - 1 && ok[i - 1]));
    const timed = correct && prevOk && gap < MAX_GAP_MS;

    out.chars.push({ key: expected, ms: timed ? gap : undefined, err: !correct });

    if (c >= 1 && correctCharAt(i - 1, w, c - 1)) {
      const bi = (target[c - 1] + expected).toLowerCase();
      if (LETTER.test(bi[0]) && LETTER.test(bi[1])) {
        out.bigrams.push({ key: bi, ms: correct && gap < MAX_GAP_MS ? gap : undefined, err: !correct });
      }
      if (c >= 2 && correctCharAt(i - 2, w, c - 2)) {
        const tri = target.slice(c - 2, c + 1).toLowerCase();
        const span = t - ks[i - 2][0];
        if ([...tri].every((x) => LETTER.test(x))) {
          out.trigrams.push({ key: tri, ms: correct && span < 2 * MAX_GAP_MS ? span : undefined, err: !correct });
        }
      }
    }
  }

  out.words = extractWords(words, typed, ks, ok);
  return out;
}

function extractWords(words: string[], typed: string[], ks: Keystroke[], ok: boolean[]): Sample[] {
  const res: Sample[] = [];
  const byWord = new Map<number, number[]>();
  ks.forEach((k, i) => {
    const arr = byWord.get(k[1]);
    if (arr) arr.push(i);
    else byWord.set(k[1], [i]);
  });
  const lastIdx = typed.length - 1;
  for (let w = 0; w < typed.length; w++) {
    const target = words[w] ?? '';
    const key = wordCore(target);
    if (!key) continue;
    // Only completed words: submitted, or the final word typed correctly.
    const completed = w < lastIdx || typed[w] === target;
    if (!completed) continue;
    const idx = byWord.get(w);
    if (!idx) continue;
    const chars = idx.filter((i) => ks[i][3] !== K_SPACE);
    if (chars.length === 0) continue;
    const err = idx.some((i) => !ok[i]) || typed[w] !== target;
    const first = chars[0];
    const last = chars[chars.length - 1];
    let start = ks[first][0];
    let intervals = target.length - 1;
    const before = first - 1;
    if (before >= 0 && ks[before][3] === K_SPACE && ok[before] && ks[first][0] - ks[before][0] < MAX_GAP_MS) {
      start = ks[before][0];
      intervals = target.length;
    }
    const total = ks[last][0] - start;
    const timed = intervals > 0 && total < intervals * MAX_GAP_MS;
    res.push({ key, ms: timed ? total / intervals : undefined, err });
  }
  return res;
}
