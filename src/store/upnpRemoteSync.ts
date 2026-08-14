import { type Song } from '@/api/backend';

import { isUpnpConnected, upnpLoad, upnpSetPlayMode, upnpSyncQueue } from './upnp';

export type UpnpPlayMode =
  | 'NORMAL'
  | 'REPEAT_ALL'
  | 'REPEAT_ONE';

export interface UpnpRemoteState {
  queue: Song[];
  index: number;
  positionSec: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
}

let lastQueueSignature: string | null = null;
let lastPlayMode: UpnpPlayMode | null = null;
let inFlightSync: Promise<boolean> | null = null;

function playModeForState(state: UpnpRemoteState): UpnpPlayMode {
  // Keep shuffle local to Resonos, but still forward repeat modes to Sonos.
  if (state.repeat === 'one') return 'REPEAT_ONE';
  if (state.repeat === 'all') return 'REPEAT_ALL';
  return 'NORMAL';
}

function queueSignature(queue: Song[]): string {
  return queue.map((song) => song.id).join(',');
}

export function resetUpnpRemoteSyncState(): void {
  lastQueueSignature = null;
  lastPlayMode = null;
  inFlightSync = null;
}

export async function loadUpnpRemoteTrack(state: UpnpRemoteState, autoplay: boolean): Promise<boolean> {
  if (!isUpnpConnected()) return false;
  if (inFlightSync) return inFlightSync;
  const playMode = playModeForState(state);
  const run = (async () => {
    const ok = await upnpLoad(state.queue, state.index, autoplay, state.positionSec, playMode);
    if (ok) {
      lastQueueSignature = queueSignature(state.queue);
      lastPlayMode = playMode;
    }
    return ok;
  })();
  inFlightSync = run;
  try {
    return await run;
  } finally {
    if (inFlightSync === run) inFlightSync = null;
  }
}

export async function syncUpnpRemoteQueue(state: UpnpRemoteState, force = false): Promise<boolean> {
  if (!isUpnpConnected()) return false;
  if (inFlightSync) return inFlightSync;
  const playMode = playModeForState(state);
  const signature = queueSignature(state.queue);
  if (force || signature !== lastQueueSignature) {
    const run = (async () => {
      const ok = await upnpSyncQueue(state.queue, state.index, state.positionSec, playMode);
      if (ok) {
        lastQueueSignature = signature;
        lastPlayMode = playMode;
      }
      return ok;
    })();
    inFlightSync = run;
    try {
      return await run;
    } finally {
      if (inFlightSync === run) inFlightSync = null;
    }
  }
  if (playMode !== lastPlayMode) {
    lastPlayMode = playMode;
    return upnpSetPlayMode(playMode);
  }
  return true;
}
