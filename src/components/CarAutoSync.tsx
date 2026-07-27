/**
 * Keeps Android Auto in sync with playback:
 *  - Pushes the browse tree (on mount and when the profile changes).
 *  - Mirrors the current track / queue / state to the native module.
 *  - Receives touch (play) and car transport buttons and applies them
 *    to the player store (which drives expo-audio).
 *
 * Renders nothing. On platforms without the native module it is a no-op.
 */
import { useEffect } from 'react';

import { coverArtUrl, type Song } from '@/api/data';
import {
  carAutoAvailable,
  onPlay,
  onTransport,
  setNodes,
  setNowPlaying,
  setPlaybackState,
  setQueue,
  type CarTrack,
} from '@/lib/carAuto';
import { buildBrowseTree, handleBrowsePlay } from '@/lib/carAutoTree';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';

const REBUILD_DEBOUNCE_MS = 600;
/** How long after opening before the tree is filled in. Long enough that the
 *  app has finished starting; short enough to be ready for a drive. */
const DEEP_REBUILD_MS = 45_000;
const POSITION_PUSH_MS = 1000;

function toCarTrack(song: Song): CarTrack {
  return {
    id: song.id,
    title: song.title || undefined,
    artist: song.artist || undefined,
    album: song.album || undefined,
    artworkUrl: coverArtUrl(song.coverArt ?? song.albumId, 300) || undefined,
    durationMs: Math.round((song.duration ?? 0) * 1000),
  };
}

export function CarAutoSync() {
  useEffect(() => {
    if (!carAutoAvailable) return;
    let cancelled = false;
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Browse tree ──
    // Twice: the lists as soon as there is a session, and the songs of every
    // album in them once the app is done opening. Filling it in is dozens of
    // requests, and doing that within a second of launch competed with the
    // start itself for anyone who was never going to plug in a car (#50).
    const rebuild = (deep: boolean) => {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(async () => {
        const { auth, offline } = useAuthStore.getState();
        if (!auth && !offline) return;
        const tree = await buildBrowseTree(deep).catch(() => null);
        if (!cancelled && tree) setNodes(tree);
      }, REBUILD_DEBOUNCE_MS);
    };
    rebuild(false);
    const deepTimer = setTimeout(() => rebuild(true), DEEP_REBUILD_MS);
    const unsubAuth = useAuthStore.subscribe(() => rebuild(true));

    // ── Mirror playback state ──
    const pushNowPlaying = () => {
      const { queue, index } = usePlayerStore.getState();
      const current = queue[index] ?? null;
      setNowPlaying(current ? toCarTrack(current) : null);
    };
    const pushQueue = () => {
      const { queue, index } = usePlayerStore.getState();
      setQueue(queue.map(toCarTrack), index);
    };
    const pushState = () => {
      const { isPlaying, positionSec, shuffle, repeat } = usePlayerStore.getState();
      setPlaybackState({
        isPlaying,
        positionMs: Math.round(positionSec * 1000),
        shuffle,
        repeatMode: repeat,
      });
    };
    pushNowPlaying();
    pushQueue();
    pushState();

    const unsubPlayer = usePlayerStore.subscribe((state, prev) => {
      if (state.queue !== prev.queue || state.index !== prev.index) {
        pushNowPlaying();
        pushQueue();
      }
      if (
        state.isPlaying !== prev.isPlaying ||
        state.shuffle !== prev.shuffle ||
        state.repeat !== prev.repeat
      ) {
        pushState();
      }
    });
    const interval = setInterval(pushState, POSITION_PUSH_MS);

    // ── Events from the car ──
    const playSub = onPlay((e) => {
      void handleBrowsePlay(e.mediaId, e.parentId);
    });
    const transportSub = onTransport((e) => {
      const store = usePlayerStore.getState();
      switch (e.action) {
        case 'play':
          if (!store.isPlaying) store.toggle();
          break;
        case 'pause':
          if (store.isPlaying) store.toggle();
          break;
        case 'next':
          store.next();
          break;
        case 'previous':
          store.previous();
          break;
        case 'seek':
          store.seekTo((e.value ?? 0) / 1000);
          break;
        case 'seekToIndex':
          store.jumpTo(Math.round(e.value ?? 0));
          break;
        case 'shuffle':
          if (Boolean(e.value) !== store.shuffle) store.toggleShuffle();
          break;
        case 'repeat': {
          // The store cycles off→all→one; advance until the target is reached.
          for (let i = 0; i < 3 && usePlayerStore.getState().repeat !== e.value; i++) {
            usePlayerStore.getState().cycleRepeat();
          }
          break;
        }
      }
    });

    return () => {
      cancelled = true;
      if (rebuildTimer) clearTimeout(rebuildTimer);
      clearTimeout(deepTimer);
      clearInterval(interval);
      unsubAuth();
      unsubPlayer();
      playSub?.remove();
      transportSub?.remove();
    };
  }, []);

  return null;
}
