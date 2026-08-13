/**
 * Last time each source was played (album/playlist/artist), key = its
 * `sourceHref` ('/album/x', '/playlist/y'…). Feeds the "Recents" sort order in
 * the Library, Spotify style: what you last listened to, at the top.
 */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';

const KEY = 'resonus.lastPlayed';
/**
 * What each of those sources is called, kept apart from the times on purpose:
 * the times have been saved under their own key since before this existed, and
 * splitting them means whoever updates keeps their recents and only fills the
 * names in as they play.
 */
const NAMES_KEY = 'resonus.lastPlayed.names';
const MAX = 300;

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
  /**
   * Forgets the names on the way out of an account. The ids in them belong to
   * the server that was open, so drawing them against the next one would put
   * up tiles leading nowhere. The times stay: sorting a list by an id that is
   * not in it costs nothing, and they are what the order is made of.
   */
  forgetNames: () => void;
  hydrate: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(times: Record<string, number>, names: Record<string, string>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setItem(KEY, JSON.stringify(times));
    void setItem(NAMES_KEY, JSON.stringify(names));
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

  forgetNames: () => {
    set({ names: {} });
    scheduleSave(get().times, {});
  },

  hydrate: async () => {
    try {
      const raw = await getItem(KEY);
      if (raw) set({ times: JSON.parse(raw) as Record<string, number> });
    } catch {
      // no previous data
    }
    try {
      const raw = await getItem(NAMES_KEY);
      if (raw) set({ names: JSON.parse(raw) as Record<string, string> });
    } catch {
      // no previous data
    }
  },
}));
