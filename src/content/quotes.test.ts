import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../types';
import { keyOf, pickQuote, quotePoolInfo, quotes, quoteUsage, splitText } from './generator';

const lengthOf = (t: string) => (t.length < 120 ? 'short' : t.length < 220 ? 'medium' : 'long');

describe('quote memory', () => {
  it('never repeats a quote until all of that length were used', () => {
    const used = new Map<string, number>();
    const total = quotePoolInfo('en', 'long', used).total;
    for (let i = 0; i < total; i++) {
      const q = pickQuote('en', 'long', used);
      expect(used.has(keyOf(q))).toBe(false);
      used.set(keyOf(q), i);
    }
    expect(quotePoolInfo('en', 'long', used).fresh).toBe(0);
    // Then it repeats from the quarter used longest ago.
    const again = pickQuote('en', 'long', used);
    expect(used.get(keyOf(again))!).toBeLessThan(Math.max(1, Math.floor(total / 4)));
  });

  it('learns used quotes from stored sessions, incl. old ones without a key', () => {
    const q = quotes('de').find((x) => lengthOf(x.text) === 'short')!;
    const old = { mode: { kind: 'quote', length: 'short' }, words: splitText(q.text), startedAt: 5 } as SessionRecord;
    const used = quoteUsage([old]);
    expect(used.get(keyOf(q))).toBe(5);
    // An abandoned session only holds the words reached, so it must carry its key.
    const partial = { ...old, abandoned: true, words: splitText(q.text).slice(0, 2) } as SessionRecord;
    expect(quoteUsage([partial]).size).toBe(0);
    expect(quoteUsage([{ ...partial, quoteKey: keyOf(q) }]).get(keyOf(q))).toBe(5);
  });

  it('has enough quotes of every length', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const len of ['short', 'medium', 'long'] as const) {
        expect(quotePoolInfo(lang, len, new Map()).total).toBeGreaterThan(150);
      }
    }
  });
});
