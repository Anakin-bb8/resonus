/**
 * Local play counter (offline mode). Since there's no server to record the
 * scrobble, we track counts here to offer a "Most played" section on the home
 * screen. Persisted on disk.
 *
 * PER PROFILE, like the pins, the recents and the play history. It used to be
 * one counter for the whole app, and a song id only means something to the
 * account that issued it: one account's plays were ranked among another's, so
 * "Most played", an artist's top songs and the frequent album order answered
 * with counts of songs this profile never played, and with songs it cannot
 * play at all. It was also the one persisted collection that grew without a
 * limit, one entry per song ever played, with the whole table serialized
 * again on every save. The counter of before is inherited by the profile that
 * opens first after the update and deleted, the way the shared history was.
 */
import { create } from 'zustand';

import { hashKey } from '@/lib/localLibrary';
import { profileScopeGuard } from '@/lib/profileScope';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { profileScopeId } from '@/store/auth';

const KEY = 'resonus.localPlayCounts';
/** The key of before: one counter the whole app shared. */
const LEGACY_KEY = KEY;
/**
 * How many songs are kept. Home asks for the 50 most played and an artist for
 * its top 10, so past this the counts reach nothing on a screen — and every
 * save writes the whole table, which is what an unbounded one pays for.
 */
const MAX = 300;

/** Where this profile's counts live. */
function storageKey(): string {
  return `${KEY}.${hashKey(profileScopeId())}`;
}

interface PlayCountsState {
  counts: Record<string, number>;
  hydrated: boolean;
  bump: (songId: string) => void;
  hydrate: () => Promise<void>;
}

/** The `MAX` most played: what is dropped can no longer reach a screen. */
function keepMostPlayed(counts: Record<string, number>): Record<string, number> {
  const entries = Object.entries(counts);
  if (entries.length <= MAX) return counts;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX));
}

const scope = profileScopeGuard();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(counts: Record<string, number>) {
  // The key is resolved here and not when the timer fires: a profile change
  // inside the debounced second would otherwise write these counts under the
  // new profile's key, which is the mixing this is here to stop. And if what
  // is in memory is not this key's, nothing is written (see `profileScopeGuard`).
  const key = storageKey();
  if (!scope.owns(key)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(key, JSON.stringify(counts));
  }, 1000);
}

export const usePlayCounts = create<PlayCountsState>((set, get) => ({
  counts: {},
  hydrated: false,

  bump: (songId) => {
    const counts = keepMostPlayed({ ...get().counts, [songId]: (get().counts[songId] ?? 0) + 1 });
    set({ counts });
    scheduleSave(counts);
  },

  hydrate: async () => {
    // Re-runs on a profile change, and has to reset when the new profile has
    // no counts of its own: what is in memory belongs to the one being left.
    const key = storageKey();
    const token = scope.start();
    try {
      const raw = await getItem(key);
      const counts = raw
        ? keepMostPlayed(JSON.parse(raw) as Record<string, number>)
        : await legacyCounts();
      // Overtaken by a newer hydration: that one owns the counts now.
      if (!scope.accept(token, key)) return;
      set({ counts, hydrated: true });
      if (!raw && Object.keys(counts).length > 0) {
        // Written under this profile's key before the shared one goes, so a
        // crash in between loses nothing. Only one profile can inherit it: the
        // key is deleted, and the next profile reads nothing.
        await setItem(key, JSON.stringify(counts));
        await deleteItem(LEGACY_KEY);
      }
    } catch {
      if (scope.accept(token, key)) set({ counts: {}, hydrated: true });
    }
  },
}));

/** The counter of before, read by the update that moves it and nobody else. */
async function legacyCounts(): Promise<Record<string, number>> {
  try {
    const raw = await getItem(LEGACY_KEY);
    return raw ? keepMostPlayed(JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}
