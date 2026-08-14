/**
 * Last time each source was played (album/playlist/artist), key = its
 * `sourceHref` ('/album/x', '/playlist/y'…). Feeds the "Recents" sort order in
 * the Library, Spotify style: what you last listened to, at the top, and the
 * tiles Home's grid puts up for what neither list mentions.
 *
 * PER PROFILE, like the pins and the play history. It used to be one map for
 * the whole app, and an href is only meaningful to the profile that wrote it:
 * a local `/album/<id>` means nothing on Navidrome and the other way round. So
 * the local profile's records turned up in a server account's grid, drawn from
 * the name written down here with a cover that could not resolve. Only
 * `switchProfile` wiped the names, and going out through the login screen —
 * signing out, or leaving the local profile — does not pass through it, so
 * they survived, and so did a restart.
 *
 * Nothing is wiped now: each profile reads and writes its own key and finds
 * its own recents where it left them.
 */
import { create } from 'zustand';

import { hashKey } from '@/lib/localLibrary';
import { profileScopeGuard } from '@/lib/profileScope';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { profileScopeId } from '@/store/auth';

const KEY = 'resonus.lastPlayed';
/**
 * The shared keys of before. Whichever profile opens first after updating
 * inherits what is in them and they are deleted: the records were made by
 * somebody, most likely by the account being used, and handing them to nobody
 * would empty a grid that has been filling up for months.
 *
 * They were two keys because the names arrived later than the times and
 * splitting them let an update keep its recents while the names filled in as
 * things played. Going forward one key holds both: the migration writes them
 * together, so there is nothing left to keep apart.
 */
const LEGACY_TIMES_KEY = KEY;
const LEGACY_NAMES_KEY = `${KEY}.names`;
const MAX = 300;

/** Where this profile's recents live. */
function storageKey(): string {
  return `${KEY}.${hashKey(profileScopeId())}`;
}

interface Saved {
  times: Record<string, number>;
  names: Record<string, string>;
}

interface LastPlayedState {
  /** sourceHref → timestamp (ms) of the last play. */
  times: Record<string, number>;
  /**
   * sourceHref → what it is called. Enough to draw something that was played
   * without waiting for a list from the server to mention it (see the Home
   * grid): the cover comes from the id inside the href.
   */
  names: Record<string, string>;
  touch: (href: string, name?: string) => void;
  hydrate: () => Promise<void>;
}

const scope = profileScopeGuard();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(times: Record<string, number>, names: Record<string, string>) {
  // The key is resolved NOW and not when the timer fires: a profile switch
  // within the second of debounce would otherwise write these recents under the
  // new profile's key, which is the mixing this is here to stop. And if what is
  // in memory is not this key's, nothing is written (see `profileScopeGuard`).
  const key = storageKey();
  if (!scope.owns(key)) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(key, JSON.stringify({ times, names } satisfies Saved));
  }, 1000);
}

export const useLastPlayed = create<LastPlayedState>((set, get) => ({
  times: {},
  names: {},

  touch: (href, name) => {
    let entries = Object.entries({ ...get().times, [href]: Date.now() });
    // Bounded: if it grows too large, drop the oldest ones.
    if (entries.length > MAX) {
      entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX);
    }
    const times = Object.fromEntries(entries);
    // The names follow the times: one dropped there is one nobody can draw.
    const kept = { ...get().names, ...(name ? { [href]: name } : {}) };
    const names = Object.fromEntries(
      Object.entries(kept).filter(([key]) => key in times),
    );
    set({ times, names });
    scheduleSave(times, names);
  },

  hydrate: async () => {
    // Re-runs on a profile switch, and has to RESET when the new profile has no
    // recents: what is in memory belongs to the one being left.
    const key = storageKey();
    const token = scope.start();
    try {
      const raw = await getItem(key);
      const saved: Saved = raw
        ? (JSON.parse(raw) as Saved)
        : { times: await legacyTimes(), names: await legacyNames() };
      // Overtaken by a newer hydration: that one owns the recents now.
      if (!scope.accept(token, key)) return;
      set({ times: saved.times ?? {}, names: saved.names ?? {} });
      if (!raw) {
        // Written under this profile's key before the shared ones go, so a
        // crash in between loses nothing.
        if (Object.keys(saved.times).length > 0) await setItem(key, JSON.stringify(saved));
        await deleteItem(LEGACY_TIMES_KEY);
        await deleteItem(LEGACY_NAMES_KEY);
      }
    } catch {
      if (scope.accept(token, key)) set({ times: {}, names: {} });
    }
  },
}));

async function legacyTimes(): Promise<Record<string, number>> {
  try {
    const raw = await getItem(LEGACY_TIMES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function legacyNames(): Promise<Record<string, string>> {
  try {
    const raw = await getItem(LEGACY_NAMES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
