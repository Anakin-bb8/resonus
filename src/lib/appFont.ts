/**
 * Global text defaults. React Native doesn't inherit `fontFamily` at the app
 * level and its `Text` (RN 0.83) is a function component without `render` or
 * `defaultProps` (React 19 removed them), so the component can't be patched.
 * Instead we wrap the JSX runtime (`jsx`/`jsxs` and its development variant
 * `jsxDEV`): every time a `<Text>` or `<TextInput>` is created, a base style is
 * injected below its own style (own style wins).
 *
 * Two things go in that base style:
 *
 *  - The UI font, when one is chosen in Settings. Nothing in the app sets
 *    `fontFamily`, so the injected family applies. With the default option
 *    (`undefined`) the system font is left as it is.
 *
 *  - A weight, on Android, which is not a preference but a fix. See below.
 *
 * Both are read from module variables on every element creation, so changing
 * the setting applies to everything that gets re-painted.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { Platform, Text, TextInput, type TextStyle } from 'react-native';

/**
 * Why every piece of text is given an explicit weight on Android.
 *
 * Android's "Bold text" (Accessibility › Display size and text) sets
 * `Configuration.fontWeightAdjustment` to 300, and the platform adds that to
 * the weight of anything a `TextView` draws. React Native never learned about
 * it: there is not one mention of `fontWeightAdjustment` in its Android
 * sources. `TextLayoutManager` measures with a `TextPaint` of its own, built
 * from `Typeface.create` with no `Configuration` in sight, and then hands the
 * text to a real `TextView` whose paint the platform has already made heavier.
 * The box is measured for the normal font and filled with the bold one, so
 * whatever no longer fits is dropped: the tab said "Inic...", a track's artist
 * said "Sum ...", and the track menu lost the end of every line ("Add to a"
 * for "Add to a playlist"), with two identical "Go to" entries left in it.
 *
 * A `fontWeight` in the style is measured correctly, because RN puts it in a
 * `CustomStyleSpan`, which is metric-affecting and so applies to the measuring
 * paint as well as to the drawing one. Setting one also takes the decision
 * away from the platform: the span re-derives the typeface from the weight it
 * was given, and the adjustment is gone. That is why the app's headings, which
 * name a weight, were the only text that came out right.
 *
 * So the app names a weight everywhere, and what the system asks for is lost.
 * That is the trade we can make today: reading `fontWeightAdjustment` needs
 * native code, and until something reads it there is no honest way to be
 * bolder, because RN would measure that boldness as if it were not there.
 */
const NEUTRALIZE_BOLD_TEXT = Platform.OS === 'android';

let currentFamily: string | undefined;
let injected: TextStyle | null = null;
let installed = false;

/** Rebuilds the base style. Null when there is nothing to inject. */
function rebuildInjected(): void {
  const base: TextStyle = {};
  if (currentFamily) base.fontFamily = currentFamily;
  if (NEUTRALIZE_BOLD_TEXT) base.fontWeight = 'normal';
  injected = Object.keys(base).length > 0 ? base : null;
}

rebuildInjected();

/**
 * Sets the global font. `undefined` = system default font.
 *
 * Called on every render of the root layout, so it returns early when nothing
 * changed: the injected object has to keep its identity, or every `Text` in the
 * app is handed a new style on every repaint.
 */
export function setAppFont(family: string | undefined): void {
  const next = family || undefined;
  if (next === currentFamily) return;
  currentFamily = next;
  rebuildInjected();
}

/** Wraps a `jsx(type, props, ...rest)` function to inject the base style. */
function wrapJsx(orig: (...args: any[]) => any) {
  return function wrapped(type: unknown, props: any, ...rest: any[]) {
    if (injected && (type === Text || type === TextInput) && props) {
      props = { ...props, style: [injected, props.style] };
    }
    return orig(type, props, ...rest);
  };
}

/** Applies the wrapper to an already-required JSX runtime module. */
function patchRuntime(rt: any): void {
  if (!rt) return;
  if (typeof rt.jsx === 'function') rt.jsx = wrapJsx(rt.jsx);
  if (typeof rt.jsxs === 'function') rt.jsxs = wrapJsx(rt.jsxs);
  if (typeof rt.jsxDEV === 'function') rt.jsxDEV = wrapJsx(rt.jsxDEV);
}

/** Installs the wrapper once, over both possible runtimes.
 * Requires literals: Metro can't resolve `require` with a variable. */
export function installAppFont(): void {
  if (installed) return;
  installed = true;
  try {
    patchRuntime(require('react/jsx-runtime'));
  } catch {
      // No production runtime (e.g. in dev): ignored.
  }
  try {
    patchRuntime(require('react/jsx-dev-runtime'));
  } catch {
      // No development runtime (e.g. in production): ignored.
  }
}
