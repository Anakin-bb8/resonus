/**
 * The app's language kept in step with Android's per-app language setting
 * (Android 13+, native module `AppLocale`; the list of languages the system
 * offers comes from `plugins/withAppLocales.js`).
 *
 * Either side can change it: the picker in Settings, or the system's. What the
 * system holds is read when the app comes back to the foreground and wins if
 * it differs, since the only way it can differ is someone changing it there.
 * Everything chosen in the app is written back, so the two never disagree for
 * longer than that.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppState } from 'react-native';

import { LANGUAGES, type Language } from '@/i18n/languages';
import { useSettings } from '@/store/settings';

const native = requireOptionalNativeModule<{
  get: () => string | null;
  set: (tag: string) => boolean;
}>('AppLocale');

/** A system tag (`es-ES`, `zh-Hans-CN`) as one of ours, or null. */
export function matchLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === lower);
  if (exact) return exact.code;
  const base = lower.split('-')[0];
  return LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base)?.code ?? null;
}

function systemLanguage(): Language | null {
  try {
    return matchLanguage(native?.get());
  } catch {
    return null;
  }
}

function writeSystem(language: Language) {
  try {
    native?.set(language);
  } catch {
    // The system keeps what it had; the app still speaks the right language.
  }
}

/** Takes the system's choice if it has one, and gives it ours otherwise. */
function reconcile() {
  const { language, setLanguage } = useSettings.getState();
  const system = systemLanguage();
  if (system && system !== language) setLanguage(system);
  else if (!system) writeSystem(language);
}

let started = false;

/** Once, at startup. Waits for the saved language before comparing. */
export function initAppLocale() {
  if (!native || started) return;
  started = true;
  const begin = () => {
    reconcile();
    let last = useSettings.getState().language;
    useSettings.subscribe((s) => {
      if (s.language === last) return;
      last = s.language;
      if (systemLanguage() !== s.language) writeSystem(s.language);
    });
    AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });
  };
  if (useSettings.getState().hydrated) begin();
  else {
    const stop = useSettings.subscribe((s) => {
      if (!s.hydrated) return;
      stop();
      begin();
    });
  }
}
