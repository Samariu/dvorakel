# Dvorakel

**Dvorak + Orakel**: a typing trainer that tells you what to practise.

Dvorakel runs Monkeytype-style tests in English and German. It records the timing of every keystroke and works out
which **letter pairs, letter triples, characters and words** slow you down or trip you up. Then it builds drills from
real words that contain exactly those weak spots.

It does not depend on a particular layout. The app compares the characters your OS produces, so it works with any
Dvorak variant, including custom layouts with ä/ö/ü/ß on an AltGr layer.

## Features

- **Tests**: time (15/30/60/120 s), word count (10/25/50/100), quotes (public-domain literature plus everyday
  sentences), and your own pasted text. Optional punctuation and numbers.
- **Error handling**: Monkeytype-style by default (errors shown in red, backspace allowed, Ctrl+Backspace deletes a
  word). There is also a *no-backspace* mode where mistakes can't be corrected.
- **EN / DE toggle** in the header. German is strict: only `ä ö ü ß` count, `ae/oe/ue/ss` are errors. German nouns
  keep their capital letters.
- **Practice tab**: your weakest letter pairs, triples, characters and words, ranked by how much slower they are than
  your typical item, plus a penalty for mistakes. Recent sessions count more (half-life of 25 sessions). You can drill
  any single item, the top 5 of a category, or a *smart drill* that mixes them.
- **Stats tab**: WPM and accuracy per session with your 60/100 WPM target lines, a 10-session average, personal
  bests per mode, a practice calendar and the full session history (each session can be deleted).
- **Streak** (can be turned off): a daily goal in minutes or tests. Every 7 goal days in a row earns a freeze (max 2),
  which is used automatically when you miss a day. Changing the goal only applies from that day on.
- **Your data stays in your browser** (IndexedDB). Settings has export/import to JSON for backups or moving to another
  machine.

Keys: <kbd>Tab</kbd> / <kbd>Esc</kbd> restart, <kbd>Tab</kbd> / <kbd>Enter</kbd> on the results screen starts the next
test.

## How the analysis works

For each keystroke the app stores the time, the position in the text and the typed character. From that:

- **Character latency** is the time since the previous keystroke. It is only counted when the previous key was correct
  and the gap was under 2 s, so pauses aren't counted as slowness.
- **Bigram / trigram latency** is the time from the first to the last letter of the pair/triple within a word. Only first
  attempts count; retypes after Backspace are ignored.
- **Errors** are attributed to the character that *should* have been typed (a premature space counts as a miss on the
  expected letter).
- Small samples are pulled towards your typical value so that a single slow keystroke does not top the list. Items
  need a minimum number of samples (chars 8, pairs 5, triples 4, words 2).

## Windows + AltGr note

On Windows, AltGr is sent as Ctrl+Alt. Dvorakel reads characters from the browser's `beforeinput` event, not from
keydown, so AltGr letters work no matter which modifiers are reported. Only plain Ctrl+Backspace (without Alt) counts
as "delete word".

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run build    # production build into dist/
```

Stack: TypeScript, React, Vite, Dexie (IndexedDB), Vitest. Charts are plain SVG.

### Deployment

`.github/workflows/pages.yml` tests, builds and deploys to GitHub Pages on every push to `main`. Enable it once under
*Settings → Pages → Build and deployment → Source: GitHub Actions*.

### Content

`scripts/build_content.py` regenerates the bundled word lists and literature quotes in `src/content/`:

```bash
python -m venv .venv && .venv/bin/pip install spylls
.venv/bin/python scripts/build_content.py .content-cache
```

- **Word lists** (`src/content/*/words.json`, 10,000 words each, frequency-sorted) come from
  [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018), licensed
  **CC BY-SA 4.0**. They are filtered with the LibreOffice Hunspell dictionaries (proper names and non-words removed,
  German noun capitalisation restored). Because the source is subtitles, the lists lean conversational.
- **Literature quotes** come from public-domain books via Project Gutenberg: Kafka, Fontane and Goethe in German
  (pre-1996 spellings such as *daß* are modernised), and Austen, Twain and Wilde in English.
- **Everyday sentences** (`src/content/*/modern.json`) were written for this project.
