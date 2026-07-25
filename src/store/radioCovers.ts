/**
 * Custom covers for radio stations, stored ONLY on the device:
 * Subsonic/Navidrome has no cover art API for radio stations, so the chosen
 * image is copied to a dedicated directory and mapped by station id. It's PER
 * PROFILE (each account sees its own stations): same logic as pins. The copy
 * lives outside local-catalog/, which "Re-scan" wipes.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import { hashKey } from '@/lib/localLibrary';
import { profileScopeGuard } from '@/lib/profileScope';
import { getItem, setItem } from '@/lib/storage';
import { profileScopeId } from '@/store/auth';

const KEY = 'resonus.radioCovers';
/** Covers key for the active profile. */
function coversKey(): string {
  return `${KEY}.${hashKey(profileScopeId())}`;
}

const scope = profileScopeGuard();

const COVERS_DIR = FileSystem.documentDirectory + 'radio-covers/';

/** Saves the map, unless it belongs to another profile (see `profileScopeGuard`). */
async function saveCovers(covers: Record<string, string>) {
  const key = coversKey();
  if (!scope.owns(key)) return;
  await setItem(key, JSON.stringify(covers));
}

function deleteCoverFile(uri?: string) {
  if (uri) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

interface RadioCoversState {
  covers: Record<string, string>;
  hydrate: () => Promise<void>;
  setCover: (id: string, srcUri: string) => Promise<void>;
  removeCover: (id: string) => Promise<void>;
}

export const useRadioCovers = create<RadioCoversState>((set, get) => ({
  covers: {},

  hydrate: async () => {
    // Re-executes on profile switch: must RESET to {} if the new profile has no
    // covers, otherwise the previous profile's covers would linger.
    const key = coversKey();
    const token = scope.start();
    try {
      const raw = await getItem(key);
      // Overtaken by a newer hydration: that one owns the covers now.
      if (!scope.accept(token, key)) return;
      set({ covers: raw ? (JSON.parse(raw) as Record<string, string>) : {} });
    } catch {
      if (scope.accept(token, key)) set({ covers: {} });
    }
  },

  setCover: async (id, srcUri) => {
    await FileSystem.makeDirectoryAsync(COVERS_DIR, { intermediates: true }).catch(() => {});
    // New name on each change: reusing the same URI would leave expo-image
    // showing the previous cached image.
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dest = `${COVERS_DIR}${safe}-${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: srcUri, to: dest });
    const covers = { ...get().covers };
    deleteCoverFile(covers[id]);
    covers[id] = dest;
    set({ covers });
    await saveCovers(covers);
  },

  removeCover: async (id) => {
    const covers = { ...get().covers };
    if (!covers[id]) return;
    deleteCoverFile(covers[id]);
    delete covers[id];
    set({ covers });
    await saveCovers(covers);
  },
}));
