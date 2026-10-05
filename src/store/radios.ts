/**
 * The radios on Home: their definitions, built once from the play counts
 * and kept on the device, plus the icon files made for them.
 *
 * They are deliberately NOT playlists - nothing here is written to the
 * server. A def is the seed artist, the similar artists mixed into it, the
 * colour its icon was tinted with, and the snapshot of tracks it opens with
 * - kept so the screen can paint its list the moment it is asked for, with
 * the server asked again in the background whenever it has gone stale. The
 * def itself is rebuilt when it goes old, so a radio stays current the way a
 * saved playlist does not. Everything is one JSON file under the app's
 * documents (`radios/index.json`), scoped to the active profile the same way
 * the settings are, with the icon PNGs beside it in the same folder.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import type { Song } from '@/api/subsonic';
import { hashKey } from '@/lib/localLibrary';
import type { RadioRefreshCadence } from './settings';
import { profileScopeId } from './auth';

/** An artist a radio is built from: id, display name and cover if known. */
export interface RadioArtist {
  id: string;
  name: string;
  coverArt?: string;
}

/** One Home radio. `seed` is the artist in its title ("The … Radio"). */
export interface RadioDef {
  seed: RadioArtist;
  /** Artists mixed in beside the seed's own top tracks. */
  similar: RadioArtist[];
  /** The icon's background colour, read from the seed's cover at build time. */
  color: string;
  createdAt: number;
  /** The tracks it opened with: a snapshot, so the first frame of the screen
   *  is already full while the fresh list is being asked for. */
  tracks?: Song[];
}

/** The folder the index and the icons live in (the app's own documents). */
export const RADIO_DIR = FileSystem.documentDirectory + 'radios/';
const INDEX_PATH = RADIO_DIR + 'index.json';

/** Where one radio's icon is written. The number goes up when the drawing
 *  changes, so icons from the old one are made again. */
export function radioIconPath(id: string): string {
  return `${RADIO_DIR}icon-2-${hashKey(id)}.png`;
}

/** Keeps the icons drawn at the current path and deletes the rest. */
function currentIcons(icons: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, uri] of Object.entries(icons)) {
    if (uri === radioIconPath(id)) out[id] = uri;
    else void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  return out;
}

/** A def older than this gets rebuilt when Home asks (new listening, new
 *  similar artists, a cover that changed on the server) - per cadence, which
 *  Settings › Appearance › Home › Radios lets whoever listens choose. `never`
 *  is manual refresh only: no age ever counts as old. */
const STALE_MS: Record<RadioRefreshCadence, number> = {
  day: 24 * 60 * 60 * 1000,
  '3days': 3 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  '2weeks': 14 * 24 * 60 * 60 * 1000,
  never: Number.POSITIVE_INFINITY,
};

/** The cadence in milliseconds, for whoever asks the server. */
export function radioStaleMs(cadence: RadioRefreshCadence): number {
  return STALE_MS[cadence] ?? STALE_MS.week;
}

/** True when the radios are missing, old enough to rebuild, or a def predates
 *  the snapshot of tracks (one rebuild after the app updates, then quiet). */
export function radiosStale(defs: RadioDef[], staleMs: number = STALE_MS.week): boolean {
  if (defs.length === 0) return true;
  if (defs.some((d) => !d.tracks)) return true;
  const newest = Math.max(...defs.map((d) => d.createdAt));
  return Date.now() - newest > staleMs;
}

interface PersistedShape {
  scope: string;
  defs: RadioDef[];
  icons: Record<string, string>;
  pastSeeds?: string[];
}

/** How many recent seed artists the next build avoids: three rebuilds back,
 *  so consecutive refreshes change the shelf instead of remaking it. */
const PAST_SEEDS_KEPT = 18;

interface RadiosState {
  defs: RadioDef[];
  /** Radio id (its seed's id) → uri of the generated icon file. */
  icons: Record<string, string>;
  /** Seed artists the last builds used: the next build picks around them,
   *  so a refresh brings new radios instead of the same six. */
  pastSeeds: string[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setDefs: (defs: RadioDef[]) => Promise<void>;
  setIcon: (id: string, uri: string) => void;
  rememberSeeds: (ids: string[]) => Promise<void>;
}

// One write at a time: the icons for six radios finish in parallel, and
// six overlapping read-modify-writes of the index would lose all but one.
let writing: Promise<void> = Promise.resolve();

async function persistNow(): Promise<void> {
  const { defs, icons, pastSeeds } = useRadios.getState();
  try {
    await FileSystem.makeDirectoryAsync(RADIO_DIR, { intermediates: true });
    const body: PersistedShape = { scope: hashKey(profileScopeId()), defs, icons, pastSeeds };
    await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(body));
  } catch (e) {
    // Radios are a suggestion, not a library: a failed write costs the next
    // start a rebuild, so it warns and carries on like storage.ts does.
    if (__DEV__) console.warn('[radios] could not save', e);
  }
}

function enqueue(): Promise<void> {
  writing = writing.then(() => persistNow());
  return writing;
}

export const useRadios = create<RadiosState>((set, get) => ({
  defs: [],
  icons: {},
  pastSeeds: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const info = await FileSystem.getInfoAsync(INDEX_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
        const parsed = JSON.parse(raw) as Partial<PersistedShape>;
        // Another profile's radios (another server) are not this one's: the
        // ids mean nothing here and the seeds are somebody else's listening.
        if (parsed && parsed.scope === hashKey(profileScopeId())) {
          set({
            defs: Array.isArray(parsed.defs) ? parsed.defs : [],
            icons:
              parsed.icons && typeof parsed.icons === 'object' ? currentIcons(parsed.icons) : {},
            pastSeeds: Array.isArray(parsed.pastSeeds)
              ? parsed.pastSeeds.filter((id): id is string => typeof id === 'string')
              : [],
            hydrated: true,
          });
          return;
        }
      }
    } catch {
      // Unreadable or half-written: starting empty is the same thing a first
      // run does, and the next successful build writes a clean index back.
    }
    set({ hydrated: true });
  },

  setDefs: async (defs) => {
    // Icons of radios that no longer exist would sit on the disk unread: the
    // ids are the seed artists, so anything not in the new set is stale.
    const keep = new Set(defs.map((d) => d.seed.id));
    const icons = { ...get().icons };
    for (const id of Object.keys(icons)) {
      if (keep.has(id)) continue;
      delete icons[id];
      void FileSystem.deleteAsync(radioIconPath(id), { idempotent: true }).catch(() => {});
    }
    set({ defs, icons });
    await enqueue();
  },

  setIcon: (id, uri) => {
    const icons = { ...get().icons, [id]: uri };
    set({ icons });
    void enqueue();
  },

  rememberSeeds: async (ids) => {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of [...ids, ...get().pastSeeds]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
      if (next.length >= PAST_SEEDS_KEPT) break;
    }
    set({ pastSeeds: next });
    await enqueue();
  },
}));
