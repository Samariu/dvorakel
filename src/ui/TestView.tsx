import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { ActiveDrill } from '../App';
import { drillWords } from '../analysis/drills';
import { generateWords, pickQuote, splitText } from '../content/generator';
import type { Settings } from '../data/settings';
import { keydownAction, shouldPreventKeydown, textActions, type Action } from '../engine/input';
import { computeResult, wpmChars } from '../engine/metrics';
import { TypingSession } from '../engine/session';
import { dateKey } from '../streak/streak';
import type { ModeSpec, QuoteLength, SessionRecord } from '../types';
import { ResultsView } from './ResultsView';

interface Props {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  sessions: SessionRecord[];
  drill: ActiveDrill | null;
  clearDrill: () => void;
  onSaved: (s: SessionRecord) => void;
}

interface Test {
  session: TypingSession;
  source?: string;
  id: number;
}

let testId = 0;

const CUSTOM_PLACEHOLDER = 'Paste your own text in the box above and press save.';

function buildTest(settings: Settings, drill: ActiveDrill | null): Test {
  const { lang, mode } = settings;
  const wordOpts = { punctuation: settings.punctuation, numbers: settings.numbers, poolSize: settings.poolSize };
  const base = { noBackspace: settings.noBackspace };
  let session: TypingSession;
  let source: string | undefined;
  if (drill) {
    const words = drillWords(lang, drill.targets, settings.drillLength);
    session = new TypingSession(words.length ? words : ['nothing', 'to', 'drill', 'yet'], base);
  } else if (mode.kind === 'time') {
    session = new TypingSession(generateWords(lang, 100, wordOpts), {
      ...base,
      timeLimitMs: mode.seconds * 1000,
      extendWords: () => generateWords(lang, 60, wordOpts),
    });
  } else if (mode.kind === 'words') {
    session = new TypingSession(generateWords(lang, mode.count, wordOpts), base);
  } else if (mode.kind === 'quote') {
    const q = pickQuote(lang, mode.length);
    source = q.source;
    session = new TypingSession(splitText(q.text), base);
  } else {
    const words = splitText(settings.customText);
    session = new TypingSession(words.length ? words : splitText(CUSTOM_PLACEHOLDER), base);
  }
  return { session, source, id: ++testId };
}

const TIMES = [15, 30, 60, 120];
const COUNTS = [10, 25, 50, 100];
const QUOTE_LENGTHS: QuoteLength[] = ['short', 'medium', 'long', 'any'];

export function TestView({ settings, update, sessions, drill, clearDrill, onSaved }: Props) {
  const [test, setTest] = useState<Test>(() => buildTest(settings, drill));
  const [result, setResult] = useState<SessionRecord | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const testRef = useRef(test);
  testRef.current = test;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const drillRef = useRef(drill);
  drillRef.current = drill;
  const resultRef = useRef(result);
  resultRef.current = result;

  const focusInput = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);

  const restart = useCallback(() => {
    setResult(null);
    setTest(buildTest(settingsRef.current, drillRef.current));
    setTimeout(focusInput, 0);
  }, [focusInput]);

  // Rebuild when anything that changes the text changes.
  const configKey = JSON.stringify([
    settings.lang,
    settings.mode,
    settings.punctuation,
    settings.numbers,
    settings.noBackspace,
    settings.poolSize,
    settings.customText,
    settings.drillLength,
    drill,
  ]);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    restart();
  }, [configKey, restart]);

  const finish = useCallback(() => {
    const { session, source } = testRef.current;
    const s = settingsRef.current;
    const d = drillRef.current;
    const durationMs = session.elapsedMs(0);
    const mode: ModeSpec = d ? { kind: 'drill', label: d.label, targets: d.targets } : s.mode;
    const res = computeResult(session.words, session.typed, session.ks, durationMs, mode.kind === 'time');
    const now = new Date();
    const rec: SessionRecord = {
      ...res,
      startedAt: now.getTime() - durationMs,
      dateKey: dateKey(now),
      lang: s.lang,
      mode,
      punctuation: s.punctuation,
      numbers: s.numbers,
      noBackspace: s.noBackspace,
      words: session.reachedWords(),
      typed: [...session.typed],
      ks: session.ks,
      source,
    };
    setResult(rec);
    const typedKeys = session.ks.filter((k) => k[3] <= 1).length;
    if (durationMs >= 2000 && typedKeys >= 5) onSaved(rec);
  }, [onSaved]);

  const apply = useCallback(
    (a: Action, t: number) => {
      const { session } = testRef.current;
      if (resultRef.current) return;
      if (a.type === 'restart') return restart();
      if (a.type === 'char') session.typeChar(a.ch, t);
      else if (a.type === 'back') session.backspace(t);
      else if (a.type === 'wordBack') session.wordBackspace(t);
      else return;
      if (session.finished) finish();
      else force();
    },
    [finish, restart],
  );

  // Native listeners: React's onBeforeInput does not expose inputType.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.isComposing || e.inputType === 'insertCompositionText') return;
      e.preventDefault();
      const t = e.timeStamp || performance.now();
      for (const a of textActions(e.inputType, e.data)) apply(a, t);
    };
    const onCompositionEnd = (e: CompositionEvent) => {
      const t = e.timeStamp || performance.now();
      for (const a of textActions('insertText', e.data)) apply(a, t);
      el.value = '';
    };
    const onInput = () => {
      el.value = '';
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Dead') return;
      if (shouldPreventKeydown(e)) e.preventDefault();
      const a = keydownAction(e);
      if (a.type !== 'none') apply(a, e.timeStamp || performance.now());
    };
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('compositionend', onCompositionEnd);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('compositionend', onCompositionEnd);
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [apply, result]);

  // Timer for timed tests and the live display.
  const running = test.session.started && !test.session.finished && !result;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const { session } = testRef.current;
      if (session.tick(performance.now())) finish();
      else force();
    }, 100);
    return () => clearInterval(id);
  }, [running, finish, test.id]);

  // Typing anywhere focuses the test; Tab/Enter on the results starts the next one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target.closest('input, textarea, select, [contenteditable]') && target !== inputRef.current;
      if (inField) return;
      if (resultRef.current) {
        if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          restart();
        }
        return;
      }
      if (target === inputRef.current) return;
      if (e.key === 'Tab' || e.key === 'Escape') {
        e.preventDefault();
        restart();
      } else if (e.key.length === 1 && !e.metaKey && !(e.ctrlKey && !e.altKey)) {
        focusInput();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [restart, focusInput]);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  const { session } = test;
  const elapsed = session.started ? session.elapsedMs(performance.now()) : 0;
  const mode = settings.mode;

  if (result) {
    return (
      <ResultsView
        result={result}
        sessions={sessions}
        onNext={restart}
        drill={drill}
        onExitDrill={() => {
          clearDrill();
        }}
      />
    );
  }

  const liveWpm =
    elapsed > 1000 ? Math.round((wpmChars(session.words, session.typed, true) / 5) * (60000 / elapsed)) : 0;
  const progress =
    mode.kind === 'time' && !drill
      ? String(Math.max(0, Math.ceil((mode.seconds * 1000 - elapsed) / 1000)))
      : `${session.wordIndex}/${session.words.length}`;

  return (
    <div>
      {drill ? (
        <div className="config">
          <span className="drill-banner" style={{ margin: 0 }}>
            Drill: <b>{drill.label}</b>
          </span>
          <span className="sep" />
          <div className="group">
            {[25, 50, 100].map((n) => (
              <button key={n} className={`opt ${settings.drillLength === n ? 'on' : ''}`} onClick={() => update({ drillLength: n })}>
                {n}
              </button>
            ))}
          </div>
          <span className="sep" />
          <Toggle label="no backspace" on={settings.noBackspace} onClick={() => update({ noBackspace: !settings.noBackspace })} />
          <span className="sep" />
          <button className="opt" onClick={clearDrill}>
            ✕ exit drill
          </button>
        </div>
      ) : (
        <ConfigBar settings={settings} update={update} />
      )}

      {!drill && mode.kind === 'custom' && !session.started && <CustomEditor settings={settings} update={update} />}

      <div className="typing-wrap">
        <div className="live" aria-live="off">
          {session.started ? (
            <>
              <span>{progress}</span>
              {settings.liveWpm && <span className="dim">{liveWpm} wpm</span>}
            </>
          ) : (
            <span className="dim" style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
              {settings.lang === 'de' ? 'Deutsch' : 'English'} · {drill ? 'drill' : modeText(mode)}
              {settings.noBackspace ? ' · no backspace' : ''}
            </span>
          )}
        </div>
        <Words session={session} focused={focused} onClick={focusInput} />
        <textarea
          ref={inputRef}
          className="hidden-input"
          aria-label="Typing input"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      <button className="restart" onClick={restart} aria-label="Restart test" title="Restart (Tab)">
        ↻ restart
      </button>
      <div className="hints">
        <kbd>tab</kbd> or <kbd>esc</kbd> restart · <kbd>ctrl</kbd>+<kbd>backspace</kbd> delete word
      </div>
    </div>
  );
}

function modeText(m: ModeSpec): string {
  if (m.kind === 'time') return `${m.seconds} s`;
  if (m.kind === 'words') return `${m.count} words`;
  if (m.kind === 'quote') return `${m.length} quote`;
  return 'custom text';
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`opt ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      {label}
    </button>
  );
}

function ConfigBar({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const m = settings.mode;
  const wordsLike = m.kind === 'time' || m.kind === 'words';
  return (
    <div className="config">
      {wordsLike && (
        <>
          <div className="group">
            <Toggle label="punctuation" on={settings.punctuation} onClick={() => update({ punctuation: !settings.punctuation })} />
            <Toggle label="numbers" on={settings.numbers} onClick={() => update({ numbers: !settings.numbers })} />
          </div>
          <span className="sep" />
        </>
      )}
      <div className="group">
        <Toggle label="time" on={m.kind === 'time'} onClick={() => update({ mode: { kind: 'time', seconds: 30 } })} />
        <Toggle label="words" on={m.kind === 'words'} onClick={() => update({ mode: { kind: 'words', count: 25 } })} />
        <Toggle label="quote" on={m.kind === 'quote'} onClick={() => update({ mode: { kind: 'quote', length: 'medium' } })} />
        <Toggle label="custom" on={m.kind === 'custom'} onClick={() => update({ mode: { kind: 'custom' } })} />
      </div>
      <span className="sep" />
      <div className="group">
        {m.kind === 'time' &&
          TIMES.map((s) => <Toggle key={s} label={String(s)} on={m.seconds === s} onClick={() => update({ mode: { kind: 'time', seconds: s } })} />)}
        {m.kind === 'words' &&
          COUNTS.map((c) => <Toggle key={c} label={String(c)} on={m.count === c} onClick={() => update({ mode: { kind: 'words', count: c } })} />)}
        {m.kind === 'quote' &&
          QUOTE_LENGTHS.map((l) => <Toggle key={l} label={l} on={m.length === l} onClick={() => update({ mode: { kind: 'quote', length: l } })} />)}
        {m.kind === 'custom' && <span style={{ color: 'var(--muted)', padding: '0 8px' }}>your text</span>}
      </div>
      <span className="sep" />
      <Toggle label="no backspace" on={settings.noBackspace} onClick={() => update({ noBackspace: !settings.noBackspace })} />
    </div>
  );
}

function CustomEditor({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [text, setText] = useState(settings.customText);
  return (
    <div className="custom-editor" style={{ marginBottom: 24 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste or write the text you want to practise…" aria-label="Custom text" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn primary" onClick={() => update({ customText: text.trim() })} disabled={text.trim() === settings.customText}>
          Save text
        </button>
        <span className="notice" style={{ margin: 0, alignSelf: 'center' }}>
          {splitText(text).length} words
        </span>
      </div>
    </div>
  );
}

function Words({ session, focused, onClick }: { session: TypingSession; focused: boolean; onClick: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const wi = session.wordIndex;
  const typedLen = session.typed[wi]?.length ?? 0;

  useLayoutEffect(() => {
    const inner = innerRef.current;
    const caret = caretRef.current;
    const box = boxRef.current;
    if (!inner || !caret || !box) return;
    const wordEl = inner.children[wi] as HTMLElement | undefined;
    if (!wordEl) return;
    const letters = wordEl.children;
    // Letter spans share the positioned .words-inner as offsetParent with the words.
    let left: number;
    if (typedLen < letters.length) {
      left = (letters[typedLen] as HTMLElement).offsetLeft;
    } else {
      const last = letters[letters.length - 1] as HTMLElement | undefined;
      left = last ? last.offsetLeft + last.offsetWidth : wordEl.offsetLeft;
    }
    const lineH = wordEl.offsetHeight;
    caret.style.left = `${left}px`;
    caret.style.top = `${wordEl.offsetTop + (lineH - caret.offsetHeight) / 2}px`;
    // Keep the current word on the second line.
    const next = Math.max(0, wordEl.offsetTop - lineH);
    if (next !== shift) setShift(next);
  });

  // Only render a window around the current word so long timed tests stay fast.
  const words = session.words;
  return (
    <div ref={boxRef} className={`words-box ${focused ? '' : 'blurred'}`} onClick={onClick} data-testid="words">
      <div ref={innerRef} className="words-inner" style={{ transform: `translateY(${-shift}px)` }}>
        {words.slice(0, Math.max(wi + 80, 60)).map((w, i) => {
          const typed = i < session.typed.length ? session.typed[i] : '';
          const wrong = i < wi && typed !== w;
          return (
            <span key={i} className={`word ${wrong ? 'err' : ''}`}>
              {[...w].map((ch, j) => (
                <span key={j} className={j < typed.length ? (typed[j] === ch ? 'c' : 'i') : ''}>
                  {ch}
                </span>
              ))}
              {typed.length > w.length &&
                [...typed.slice(w.length)].map((ch, j) => (
                  <span key={'x' + j} className="x">
                    {ch}
                  </span>
                ))}
            </span>
          );
        })}
        <div ref={caretRef} className={`caret ${session.started ? 'typing' : ''}`} />
      </div>
      {!focused && <div className="focus-hint">Click here or start typing to focus</div>}
    </div>
  );
}
