/**
 * Server libraries (Navidrome multi-library) and which folders to show.
 *
 * Navidrome exposes each "library" as a music folder from the Subsonic API
 * (`getMusicFolders`). Here we store, per profile, the list of folders and the
 * ones the user has DISABLED (we store the disabled ones so that a new
 * library on the server appears enabled by default).
 *
 * The filter is applied in `data.ts`: without disabled or with a single library
 * no filtering is done; with one active its `musicFolderId` is passed; with a subset
 * they are requested separately and merged (the API only filters by one at a time).
 */
import { create } from 'zustand';

import { getMusicFolders, type MusicFolder, type SubsonicAuth } from '@/api/backend';
import { queryClient } from '@/lib/query';
import { primaryUrl } from '@/lib/serverUrls';
import { getItem, setItem } from '@/lib/storage';

const STORAGE_KEY = 'resonus.libraries';

/** Identifies a server profile (library ids are per server). */
export function profileKeyOf(auth: SubsonicAuth | null | undefined): string | null {
  if (!auth || auth.serverType === 'jellyfin') return null;
  // Primary URL, not the active one: when switching networks it should not appear as another profile.
  return `${primaryUrl(auth)}|${auth.username}`;
}

interface LibrariesState {
  /** Known folders per profile (persisted to filter after restart). */
  folders: Record<string, MusicFolder[]>;
  /** Disabled folder ids per profile. */
  disabled: Record<string, string[]>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Refreshes the library list from the server for the profile. */
  load: (auth: SubsonicAuth) => Promise<void>;
  /** Enables/disables a library for the active profile. */
  setEnabled: (auth: SubsonicAuth, id: string, enabled: boolean) => void;
}

function persist(get: () => LibrariesState) {
  const { folders, disabled } = get();
  void setItem(STORAGE_KEY, JSON.stringify({ folders, disabled }));
}

export const useLibraries = create<LibrariesState>((set, get) => ({
  folders: {},
  disabled: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          folders: Record<string, MusicFolder[]>;
          disabled: Record<string, string[]>;
        }>;
        set({
          folders: parsed.folders ?? {},
          disabled: parsed.disabled ?? {},
        });
        // Reading from disk is async, so the screens are already up and their
        // queries went out with no filter at all — showing libraries the user
        // had disabled, and keeping them for the whole session because nothing
        // asked again. If the restored filter hides anything, that data is
        // wrong: drop it. Checked across profiles because `hydrate` doesn't
        // know which one is active, and paying one refetch at startup only
        // affects users who actually disabled a library.
        if (Object.values(parsed.disabled ?? {}).some((ids) => ids.length > 0)) {
          clearAlbumCache();
          void queryClient.invalidateQueries();
        }
      }
    } catch {
      // will stay with default values (everything visible)
    } finally {
      set({ hydrated: true });
    }
  },

  load: async (auth) => {
    const key = profileKeyOf(auth);
    if (!key) return;
    try {
      // Through the query cache, under the key the Library screen uses. Both
      // ask for the folders as the app opens, and being a store on one side
      // and a query on the other they shared nothing: two identical requests,
      // a second each on a distant server. Nothing is held any staler by this
      // — a request already in flight is simply joined rather than repeated.
      const list = await queryClient.fetchQuery({
        queryKey: ['musicFolders'],
        queryFn: () => getMusicFolders(auth),
      });
      set((s) => ({ folders: { ...s.folders, [key]: list } }));
      // Purge disabled ones that no longer exist on the server.
      const ids = new Set(list.map((f) => f.id));
      const cur = get().disabled[key] ?? [];
      const cleaned = cur.filter((id) => ids.has(id));
      if (cleaned.length !== cur.length) {
        set((s) => ({ disabled: { ...s.disabled, [key]: cleaned } }));
        // The filter just changed (a disabled library is gone from the server),
        // so whatever is on screen was filtered by the old one.
        clearAlbumCache();
        void queryClient.invalidateQueries();
      }
      persist(get);
    } catch {
      // offline / server without support: keep whatever was there
    }
  },

  setEnabled: (auth, id, enabled) => {
    const key = profileKeyOf(auth);
    if (!key) return;
    const cur = get().disabled[key] ?? [];
    const next = enabled ? cur.filter((x) => x !== id) : [...cur, id];
    set((s) => ({ disabled: { ...s.disabled, [key]: next } }));
    persist(get);
    // Filter changed: drop cached lists so they are re-fetched.
    clearAlbumCache();
    void queryClient.invalidateQueries();
  },
}));

// ── Helpers for the data layer (no React) ──

/**
 * Library ids to query, or `undefined` when no filtering is needed
 * (Jellyfin/offline, single library, or all active).
 */
export function enabledFolderIds(auth: SubsonicAuth | null | undefined): string[] | undefined {
  if (!auth || auth.serverType === 'jellyfin') return undefined;
  const key = profileKeyOf(auth);
  if (!key) return undefined;
  const folders = useLibraries.getState().folders[key] ?? [];
  if (folders.length < 2) return undefined;
  const disabled = new Set(useLibraries.getState().disabled[key] ?? []);
  if (disabled.size === 0) return undefined;
  const enabled = folders.map((f) => f.id).filter((id) => !disabled.has(id));
  // If all would be active (no valid disabled) → no filter.
  if (enabled.length === 0 || enabled.length === folders.length) return undefined;
  return enabled;
}

// ── Merged album list cache (subset mode only) ──
//
// The API paginates per folder, so for multiple mixed libraries the full list
// is fetched from each, merged and served in chunks. It's cached in memory for
// a while to avoid repeating the work on each infinite scroll page.

const CACHE_TTL_MS = 5 * 60 * 1000;
const albumCache = new Map<string, { at: number; albums: unknown[] }>();

export function readAlbumCache<T>(cacheKey: string): T[] | null {
  const hit = albumCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    albumCache.delete(cacheKey);
    return null;
  }
  return hit.albums as T[];
}

export function writeAlbumCache<T>(cacheKey: string, albums: T[]): void {
  albumCache.set(cacheKey, { at: Date.now(), albums: albums as unknown[] });
}

function clearAlbumCache(): void {
  albumCache.clear();
}
