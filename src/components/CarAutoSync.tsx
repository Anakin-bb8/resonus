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

import { COVER, songCoverUrl, type Song } from '@/api/data';
import {
  carAutoAvailable,
  onCarConnected,
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
import { useLastPlayed } from '@/store/lastPlayed';
import { usePlayerStore, type StreamInfo } from '@/store/player';

const REBUILD_DEBOUNCE_MS = 600;
/** How long after opening before the tree is filled in. Long enough that the
 *  app has finished starting; short enough to be ready for a drive. */
const DEEP_REBUILD_MS = 45_000;
/** How often a connecting car is allowed to set off a full rebuild. It asks
 *  for the root more than once per drive, and each one is dozens of requests. */
const DEEP_MIN_INTERVAL_MS = 5 * 60_000;
const POSITION_PUSH_MS = 1000;

/** `live` is what a radio says it is playing, which replaces the title and the
 *  artist and nothing else: the station is not an album. */
function toCarTrack(song: Song, live?: StreamInfo | null): CarTrack {
  return {
    id: song.id,
    title: live?.title ?? song.title ?? undefined,
    artist: live?.artist ?? song.artist ?? undefined,
    album: song.album || undefined,
    artworkUrl: songCoverUrl(song, COVER.card) || undefined,
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
    // The lists now, the songs once the app has settled. `scheduleDeep` is also
    // what any later change restarts: the session store emits several times
    // while hydrating, and each of those used to mean the full fetch again.
    let deepTimer: ReturnType<typeof setTimeout> | null = null;
    let lastDeepAt = 0;
    const scheduleDeep = (delay = DEEP_REBUILD_MS) => {
      if (deepTimer) clearTimeout(deepTimer);
      deepTimer = setTimeout(() => {
        lastDeepAt = Date.now();
        rebuild(true);
      }, delay);
    };
    rebuild(false);
    scheduleDeep();
    const unsubAuth = useAuthStore.subscribe(() => {
      rebuild(false);
      scheduleDeep();
    });
    // Starting an album or a playlist writes it down as recently played, and
    // the car's Recents tab is built out of exactly that. Without this the tab
    // only ever knew what had been played before the app opened. Deep on
    // purpose: what has just moved to the top of Recents is the likeliest
    // thing to be tapped next, and the lists alone would leave it with no
    // songs of its own.
    const unsubRecent = useLastPlayed.subscribe(() => scheduleDeep());
    // Plugging into a car is the one moment the tree is certain to be needed,
    // and the wait was being counted from the launch: forty five seconds of
    // app in the foreground is a thing that never happens to somebody who
    // opens Resonus, puts the phone in a pocket and drives off, so what the
    // car got were the lists with no songs inside them.
    const connectSub = onCarConnected(() => {
      if (Date.now() - lastDeepAt > DEEP_MIN_INTERVAL_MS) scheduleDeep(0);
    });

    // ── Mirror playback state ──
    const pushNowPlaying = () => {
      const { queue, index, streamInfo } = usePlayerStore.getState();
      const current = queue[index] ?? null;
      setNowPlaying(current ? toCarTrack(current, current.url ? streamInfo : null) : null);
    };
    const pushQueue = () => {
      const { queue, index } = usePlayerStore.getState();
      // The queue holds the station, not what it happens to be playing.
      setQueue(
        queue.map((s) => toCarTrack(s)),
        index,
      );
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
      // A radio changes track without the queue moving: it is one item for the
      // whole broadcast, and only the stream knows when a song ends.
      if (state.streamInfo !== prev.streamInfo) pushNowPlaying();
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
      // Something is playing from the car, so the wait no longer applies: fill
      // the tree in now rather than at the end of the delay.
      scheduleDeep(0);
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
      if (deepTimer) clearTimeout(deepTimer);
      clearInterval(interval);
      unsubAuth();
      unsubRecent();
      unsubPlayer();
      connectSub?.remove();
      playSub?.remove();
      transportSub?.remove();
    };
  }, []);

  return null;
}
