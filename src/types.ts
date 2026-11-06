export type Lang = 'en' | 'de';

export type DrillTarget = { kind: 'char' | 'bigram' | 'trigram' | 'word'; key: string };

export type ModeSpec =
  | { kind: 'time'; seconds: number }
  | { kind: 'words'; count: number }
  | { kind: 'quote'; length: QuoteLength }
  | { kind: 'custom' }
  | { kind: 'drill'; label: string; targets: DrillTarget[] };

export type QuoteLength = 'short' | 'medium' | 'long' | 'any';

/** Keystroke kinds stored compactly in session records. */
export const K_CHAR = 0;
export const K_SPACE = 1;
export const K_BACK = 2;
export const K_WORD_BACK = 3;
/**
 * No-backspace mode: a letter typed where the space belonged. Counts as one
 * wrong keystroke at the end of word `w`; the letter becomes the first
 * character of word `w + 1`.
 */
export const K_MISSED_SPACE = 4;

/**
 * One keystroke: [ms since test start, word index, char index (position in the
 * typed word *before* the key), kind, typed character ('' for deletions)].
 */
export type Keystroke = [number, number, number, number, string];

export interface CharCounts {
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
}

export interface SessionResult {
  wpm: number;
  raw: number;
  acc: number;
  consistency: number;
  durationMs: number;
  chars: CharCounts;
  /** Cumulative WPM per elapsed second. */
  wpmSeries: number[];
  /** Raw WPM within each second. */
  rawSeries: number[];
  /** Errors within each second. */
  errSeries: number[];
}

export interface SessionRecord extends SessionResult {
  id?: number;
  startedAt: number;
  dateKey: string;
  lang: Lang;
  mode: ModeSpec;
  punctuation: boolean;
  numbers: boolean;
  noBackspace: boolean;
  /** Target words of the test (only those reached are stored for time tests). */
  words: string[];
  /** What was typed for each word. */
  typed: string[];
  ks: Keystroke[];
  source?: string;
}
