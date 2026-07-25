/**
 * Pinned Library items (Spotify style): up to 4, always at the very top
 * regardless of the chosen sort order. Key = 'playlist:<id>' or
 * 'album:<id>'; the value is when it was pinned (pins keep that order).
 */
import { create } from 'zustand';

import { hashKey } from '@/lib/localLibrary';
import { profileScopeGuard } from '@/lib/profileScope';
import { getItem, setItem } from '@/lib/storage';
import { profileScopeId } from '@/store/auth';

// Pins are PER PROFILE (each account/profile has its own): a pinned local
// playlist should not appear on a server account's Home and vice versa. They
// are stored under `resonus.pins.<profile hash>`; the bare base key is the old
// (shared) version, only inherited by the local profile (migration).
const KEY = 'resonus.pins';
/** Pins key for the active profile. */
function pinsKey(): string {
  return `${KEY}.${hashKey(profileScopeId())}`;
}
export const MAX_PINS = 4;

interface PinsState {
  pins: Record<string, number>;
  /** Toggles pin. Returns false if it doesn't fit (already at MAX_PINS). */
  toggle: (key: string) => boolean;
  hydrate: () => Promise<void>;
}

const scope = profileScopeGuard();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(pins: Record<string, number>) {
  // The key is resolved NOW, not when the timer fires: switching profile within
  // the second of debounce used to save these pins under the new profile's key,
  // wiping its own. And if what's in memory isn't this key's, don't save at all
  // (see `profileScopeGuard`).
  const key = pinsKey();
  if (!scope.owns(key)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(key, JSON.stringify(pins));
  }, 1000);
}

export const usePins = create<PinsState>((set, get) => ({
  pins: {},

  toggle: (key) => {
    const pins = { ...get().pins };
    if (pins[key]) {
      delete pins[key];
    } else {
      if (Object.keys(pins).length >= MAX_PINS) return false;
      pins[key] = Date.now();
    }
    set({ pins });
    scheduleSave(pins);
    return true;
  },

  hydrate: async () => {
    // Re-executes on profile switch: must RESET to {} if the new profile has no
    // pins, otherwise the previous profile's pins would linger in memory.
    const key = pinsKey();
    const token = scope.start();
    try {
      const raw =
        (await getItem(key)) ?? (profileScopeId() === 'local' ? await getItem(KEY) : null);
      // Overtaken by a newer hydration: that one owns the pins now.
      if (!scope.accept(token, key)) return;
      set({ pins: raw ? (JSON.parse(raw) as Record<string, number>) : {} });
    } catch {
      if (scope.accept(token, key)) set({ pins: {} });
    }
  },
}));
