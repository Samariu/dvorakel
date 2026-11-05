/**
 * Keyboard input → typing actions.
 *
 * Characters are taken from `beforeinput` (inputType "insertText") on a hidden
 * textarea instead of from keydown. On Windows, AltGr is reported as
 * Ctrl+Alt, so filtering keydown events by modifiers would drop ä/ö/ü/ß from
 * the AltGr layer. `beforeinput` carries the final character the OS layout
 * produced, independent of modifiers.
 *
 * Deletions and control keys are handled on keydown.
 */
export type Action =
  | { type: 'char'; ch: string }
  | { type: 'back' }
  | { type: 'wordBack' }
  | { type: 'restart' }
  | { type: 'none' };

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function keydownAction(e: KeyLike): Action {
  if (e.key === 'Tab' || e.key === 'Escape') return { type: 'restart' };
  if (e.key === 'Backspace') {
    // AltGr = Ctrl+Alt on Windows; only a plain Ctrl (or ⌥ on macOS) means "delete word".
    const wordDelete = (e.ctrlKey && !e.altKey) || (e.altKey && !e.ctrlKey && !e.metaKey);
    return { type: wordDelete ? 'wordBack' : 'back' };
  }
  return { type: 'none' };
}

/** Whether keydown should be swallowed (so the browser does not act on it). */
export function shouldPreventKeydown(e: KeyLike): boolean {
  // Never prevent printable keys: that would suppress the beforeinput event.
  return e.key === 'Tab' || e.key === 'Backspace' || e.key === 'Enter';
}

const NORMALISE: Record<string, string> = {
  ' ': ' ', // no-break space (some layouts produce it with AltGr+Space)
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '„': '"',
};

/** Characters from an insertText / composition event, one action per char. */
export function textActions(inputType: string, data: string | null): Action[] {
  if (!data) return [];
  if (inputType !== 'insertText' && inputType !== 'insertCompositionText' && inputType !== 'insertReplacementText') {
    return [];
  }
  return [...data.normalize('NFC')]
    .map((c) => NORMALISE[c] ?? c)
    .filter((c) => c !== '\n' && c !== '\r' && c !== '\t')
    .map((ch) => ({ type: 'char', ch }) as Action);
}
