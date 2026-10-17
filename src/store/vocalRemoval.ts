/**
 * Karaoke / vocal removal: the user's choice (on, which model, how much of the
 * voice) and the download of the model behind it.
 *
 * The processing is native and iOS-only, so this store is inert everywhere the
 * `VocalSeparator` module is missing: `supported` stays false, the settings row
 * says so, and no model is ever asked for. The user's choices are still kept, so
 * they survive an app update that adds the module or a switch to a device that
 * can do it.
 */
import { create } from 'zustand';

import { getItem, setItem } from '@/lib/storage';
import {
  clearStaging,
  downloadModel,
  installedModelPath,
  isModelInstalled,
  removeModel,
  type SingModelKind,
} from '@/lib/singModel';
import { singModelTotalBytes } from '@/lib/singModels';
import { isVocalRemovalSupported, vocalSeparator } from '@/lib/vocalSeparator';

const KEY = 'resonus.vocalRemoval';

/** Default 0.5: the original track, neither half pulled away. The slider is
 *  0 (background) to 1 (vocals), matching the Taurus tweak. */
export const VOCAL_MIX_DEFAULT = 0.5;

export type VocalRemovalStatus = 'unsupported' | 'missing' | 'downloading' | 'ready' | 'error';

interface Stored {
  kind: SingModelKind;
  enabled: boolean;
  mix: number;
}

interface VocalRemovalState {
  /** The native module is present and `isSupported()` said yes. */
  supported: boolean;
  /** Which published model is selected. */
  kind: SingModelKind;
  /** Whether vocal removal is applied to playback. */
  enabled: boolean;
  /** The mix, 0 (background only) to 1 (vocals only). */
  mix: number;
  /** Whether the selected model is installed and loadable. */
  modelReady: boolean;
  status: VocalRemovalStatus;
  /** 0–1 while downloading. */
  progress: number;
  /** Why the last download failed, if it did. */
  error: string | null;
  hydrate: () => Promise<void>;
  setKind: (kind: SingModelKind) => void;
  setEnabled: (on: boolean) => void;
  setMix: (mix: number) => void;
  download: () => Promise<void>;
  cancel: () => void;
  remove: () => void;
}

/** The live download, so `cancel` and a second `download` can reach it. */
let inFlight: AbortController | null = null;

function persist(s: Pick<VocalRemovalState, 'kind' | 'enabled' | 'mix'>) {
  const data: Stored = { kind: s.kind, enabled: s.enabled, mix: s.mix };
  void setItem(KEY, JSON.stringify(data)).catch(() => {});
}

/**
 * Pushes the current choice into the native module: loads the model when the
 * separation is on and the model is installed, and unloads it otherwise. Safe
 * to call on every change; the native side keeps the model warm across songs.
 */
function applyNative(get: () => VocalRemovalState) {
  if (!vocalSeparator) return;
  const { enabled, mix, kind, modelReady, supported } = get();
  if (!supported) return;
  try {
    if (enabled && modelReady) {
      const path = installedModelPath(kind);
      if (path) {
        vocalSeparator.loadModel(path, kind);
        vocalSeparator.setMix(mix);
        vocalSeparator.setEnabled(true);
        return;
      }
    }
    vocalSeparator.setEnabled(false);
    vocalSeparator.unloadModel();
  } catch {
    // The native side failed: leave the feature off rather than half-applied.
    get().setEnabled(false);
  }
}

export const useVocalRemoval = create<VocalRemovalState>((set, get) => ({
  supported: false,
  kind: 'full',
  enabled: false,
  mix: VOCAL_MIX_DEFAULT,
  modelReady: false,
  status: 'unsupported',
  progress: 0,
  error: null,

  hydrate: async () => {
    const supported = isVocalRemovalSupported();
    let stored: Stored | null = null;
    try {
      const raw = await getItem(KEY);
      if (raw) stored = JSON.parse(raw) as Stored;
    } catch {
      // No previous choice: the defaults stand.
    }
    const kind: SingModelKind = stored?.kind === 'light' ? 'light' : 'full';
    const mix =
      typeof stored?.mix === 'number' && stored.mix >= 0 && stored.mix <= 1
        ? stored.mix
        : VOCAL_MIX_DEFAULT;
    const modelReady = supported && isModelInstalled(kind);
    set({
      supported,
      kind,
      mix,
      enabled: supported && !!stored?.enabled && modelReady,
      modelReady,
      status: !supported ? 'unsupported' : modelReady ? 'ready' : 'missing',
      error: null,
    });
    applyNative(get);
  },

  setKind: (kind) => {
    const modelReady = get().supported && isModelInstalled(kind);
    set({
      kind,
      modelReady,
      status: !get().supported ? 'unsupported' : modelReady ? 'ready' : 'missing',
      error: null,
    });
    persist(get());
    applyNative(get);
  },

  setEnabled: (on) => {
    // Without the model there is nothing to apply: turning it on is refused
    // rather than silently ignored, so the settings row can point at the model.
    const enabled = on && get().modelReady && get().supported;
    set({ enabled });
    persist(get());
    applyNative(get);
  },

  setMix: (mix) => {
    const clamped = Math.min(1, Math.max(0, mix));
    set({ mix: clamped });
    persist(get());
    if (vocalSeparator && get().supported) {
      try {
        vocalSeparator.setMix(clamped);
      } catch {
        // Nothing to apply.
      }
    }
  },

  download: async () => {
    if (!get().supported || inFlight) return;
    const kind = get().kind;
    const controller = new AbortController();
    inFlight = controller;
    set({ status: 'downloading', progress: 0, error: null });
    try {
      await downloadModel(kind, {
        signal: controller.signal,
        onProgress: (fraction) => set({ progress: fraction }),
      });
      // Only the model still selected at the end counts: switching mid-download
      // installs the other one and this attempt's result is not what is shown.
      if (get().kind === kind) {
        set({ modelReady: true, status: 'ready', progress: 1 });
      }
      persist(get());
      applyNative(get);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        set({ status: isModelInstalled(kind) ? 'ready' : 'missing', progress: 0 });
      } else {
        set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      inFlight = null;
    }
  },

  cancel: () => {
    inFlight?.abort();
    inFlight = null;
    const kind = get().kind;
    // Keep what arrived (a resume picks it up) but drop the partial state.
    clearStaging(kind);
    set({ status: isModelInstalled(kind) ? 'ready' : 'missing', progress: 0 });
  },

  remove: () => {
    const kind = get().kind;
    // The model goes and the separation with it: leaving it enabled with no
    // model would just fail on the next song.
    set({ enabled: false, modelReady: false, status: 'missing', progress: 0, error: null });
    try {
      vocalSeparator?.setEnabled(false);
      vocalSeparator?.unloadModel();
    } catch {
      // Nothing loaded.
    }
    persist(get());
    removeModel(kind);
  },
}));

/** Bytes the selected model occupies once installed (for the settings row). */
export function vocalModelBytes(kind: SingModelKind): number {
  return singModelTotalBytes(kind);
}
