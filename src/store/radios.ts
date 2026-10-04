/**
 * The radios on Home: their definitions, built once from listening history
 * and kept on the device, plus the icon files made for them.
 *
 * They are deliberately NOT playlists — nothing here is written to the
 * server. A def is the seed artist, the similar artists mixed into it, and
 * the colour its icon was tinted with; the track list itself is rebuilt from
 * the server each time the radio opens, so a radio stays current the way a
 * saved playlist does not. Everything is one JSON file under the app's
 * documents (`radios/index.json`), scoped to the active profile the same way
 * the settings are, with the icon PNGs beside it in the same folder.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import { hashKey } from '@/lib/localLibrary';
import { profileScopeId } from './auth';

/** An artist a radio is built from: id, display name and cover if known. */
export interface RadioArtist {
  id: string;
  name: string;
  coverArt?: string;
}

/** One Home radio. `seed` is the artist in its title ("Radio di …"). */
export interface RadioDef {
  seed: RadioArtist;
  /** Artists mixed in beside the seed's own top tracks. */
  similar: RadioArtist[];
  /** The icon's background colour, read from the seed's cover at build time. */
  color: string;
  createdAt: number;
}

/** The folder the index and the icons live in (the app's own documents). */
export const RADIO_DIR = FileSystem.documentDirectory + 'radios/';
const INDEX_PATH = RADIO_DIR + 'index.json';

/** Where one radio's icon is written. */
export function radioIconPath(id: string): string {
  return `${RADIO_DIR}icon-${hashKey(id)}.png`;
}

/** A def older than this gets rebuilt when Home asks (new listening, new
 *  similar artists, a cover that changed on the server). */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the radios are missing or old enough to rebuild. */
export function radiosStale(defs: RadioDef[]): boolean {
  if (defs.length === 0) return true;
  const newest = Math.max(...defs.map((d) => d.createdAt));
  return Date.now() - newest > STALE_MS;
}

interface PersistedShape {
  scope: string;
  defs: RadioDef[];
  icons: Record<string, string>;
}

interface RadiosState {
  defs: RadioDef[];
  /** Radio id (its seed's id) → uri of the generated icon file. */
  icons: Record<string, string>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setDefs: (defs: RadioDef[]) => Promise<void>;
  setIcon: (id: string, uri: string) => void;
}

// One write at a time: the icons for six radios finish in parallel, and
// six overlapping read-modify-writes of the index would lose all but one.
let writing: Promise<void> = Promise.resolve();

async function persist(defs: RadioDef[], icons: Record<string, string>): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(RADIO_DIR, { intermediates: true });
    const body: PersistedShape = { scope: hashKey(profileScopeId()), defs, icons };
    await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(body));
  } catch (e) {
    // Radios are a suggestion, not a library: a failed write costs the next
    // start a rebuild, so it warns and carries on like storage.ts does.
    if (__DEV__) console.warn('[radios] could not save', e);
  }
}

function enqueue(defs: RadioDef[], icons: Record<string, string>): Promise<void> {
  writing = writing.then(() => persist(defs, icons));
  return writing;
}

export const useRadios = create<RadiosState>((set, get) => ({
  defs: [],
  icons: {},
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
            icons: parsed.icons && typeof parsed.icons === 'object' ? parsed.icons : {},
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
    await enqueue(defs, icons);
  },

  setIcon: (id, uri) => {
    const icons = { ...get().icons, [id]: uri };
    set({ icons });
    void enqueue(get().defs, icons);
  },
}));
