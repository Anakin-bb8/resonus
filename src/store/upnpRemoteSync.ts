import { type Song } from '@/api/backend';

import { isUpnpConnected, upnpLoad, upnpSetPlayMode } from './upnp';

export type UpnpPlayMode =
  | 'NORMAL'
  | 'SHUFFLE_NOREPEAT'
  | 'SHUFFLE'
  | 'REPEAT_ALL'
  | 'REPEAT_ONE'
  | 'SHUFFLE_REPEAT_ONE';

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

function playModeForState(state: UpnpRemoteState): UpnpPlayMode {
  if (state.repeat === 'one') return state.shuffle ? 'SHUFFLE_REPEAT_ONE' : 'REPEAT_ONE';
  if (state.repeat === 'all') return state.shuffle ? 'SHUFFLE' : 'REPEAT_ALL';
  return state.shuffle ? 'SHUFFLE_NOREPEAT' : 'NORMAL';
}

function queueSignature(queue: Song[]): string {
  return queue.map((song) => song.id).join(',');
}

export function resetUpnpRemoteSyncState(): void {
  lastQueueSignature = null;
  lastPlayMode = null;
}

export async function loadUpnpRemoteTrack(state: UpnpRemoteState, autoplay: boolean): Promise<boolean> {
  if (!isUpnpConnected()) return false;
  const playMode = playModeForState(state);
  const ok = await upnpLoad(state.queue, state.index, autoplay, state.positionSec, playMode);
  if (ok) {
    lastQueueSignature = queueSignature(state.queue);
    lastPlayMode = playMode;
  }
  return ok;
}

export async function syncUpnpRemoteQueue(state: UpnpRemoteState, force = false): Promise<boolean> {
  if (!isUpnpConnected()) return false;
  const playMode = playModeForState(state);
  const signature = queueSignature(state.queue);
  if (force || signature !== lastQueueSignature) {
    lastQueueSignature = signature;
    lastPlayMode = playMode;
    return upnpLoad(state.queue, state.index, state.isPlaying, state.positionSec, playMode);
  }
  if (playMode !== lastPlayMode) {
    lastPlayMode = playMode;
    return upnpSetPlayMode(playMode);
  }
  return true;
}
