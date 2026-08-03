/** Recent searches, kept per profile, for the Search screen. */
import { create } from 'zustand';

import { primaryUrl } from '@/lib/serverUrls';
import { getItem, setItem } from '@/lib/storage';
import { useAuthStore } from './auth';

const MAX = 12;

export type RecentKind = 'artist' | 'album' | 'song';

/** A result that was tapped, kept with its cover so it can be shown again. */
export interface RecentItem {
  kind: RecentKind;
  id: string;
  title: string;
  /** The artist, for albums and songs; absent on an artist. */
  artist?: string;
  /** Cover id, for `coverArtUrl`. */
  coverArt?: string;
  /** Where tapping it goes. */
  href: string;
}

/**
 * Identity of an entry, for de-duplicating.
 *
 * By NAME, not by id: the same artist has one id on the server and another in
 * the local catalog, so searching them online and offline used to leave two
 * rows for the same person — one of which failed to open, because its id only
 * means something in the other mode (issue #51). The newest one wins, so
 * whichever mode you last used is the one that opens.
 */
function itemKey(i: RecentItem): string {
  return `${i.kind}:${i.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`;
}

// SecureStore only accepts keys with [A-Za-z0-9._-]; sanitize serverUrl/username
// (the URL contains ':' and '/') to avoid passing an invalid key.
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * One history per PROFILE, not per mode. A server account that goes offline is
 * the same account with the same history; keying it by mode meant the list in
 * memory (loaded for one mode) got written under the other one's key on the
 * next search, which is how entries from offline ended up in the online list.
 * The bare 'offline' key is for the local-files profile, which has no account.
 */
function storageKey(): string {
  const { auth, offline } = useAuthStore.getState();
  if (auth) return `resonus.recentSearches.server.${safe(primaryUrl(auth))}.${safe(auth.username)}`;
  if (offline) return 'resonus.recentSearches.offline';
  return 'resonus.recentSearches';
}

interface RecentSearchesState {
  items: RecentItem[];
  add: (item: RecentItem) => void;
  remove: (item: RecentItem) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}

let currentKey = '';

function persist(items: RecentItem[]) {
  const key = storageKey();
  if (key) void setItem(key, JSON.stringify(items));
}

function isRecentItem(x: unknown): x is RecentItem {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as RecentItem).kind === 'string' &&
    typeof (x as RecentItem).id === 'string' &&
    typeof (x as RecentItem).title === 'string' &&
    typeof (x as RecentItem).href === 'string'
  );
}

export const useRecentSearches = create<RecentSearchesState>((set, get) => ({
  items: [],

  add: (item) => {
    const rest = get().items.filter((x) => itemKey(x) !== itemKey(item));
    const items = [item, ...rest].slice(0, MAX);
    set({ items });
    persist(items);
  },

  remove: (item) => {
    const items = get().items.filter((x) => itemKey(x) !== itemKey(item));
    set({ items });
    persist(items);
  },

  clear: () => {
    set({ items: [] });
    persist([]);
  },

  hydrate: async () => {
    try {
      // Drop whatever belonged to a different key, which is another profile
      const key = storageKey();
      if (currentKey && currentKey !== key) {
        set({ items: [] });
      }
      currentKey = key;
      const raw = await getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Discard old format (list of strings).
        if (Array.isArray(parsed)) set({ items: parsed.filter(isRecentItem) });
      }
    } catch {
      // default values on failure
    }
  },
}));
