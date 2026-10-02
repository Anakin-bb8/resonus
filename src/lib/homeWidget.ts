/**
 * The app outside itself (native module `HomeWidget`): the home screen widget
 * and, on Android, the Quick Settings tile, fed from the player's store, and
 * the shortcuts on the launcher icon.
 *
 * On iOS the widget is the small "now playing" one: it shows the track the app
 * last wrote, and opens the album for it. On Android this also drives the
 * launcher shortcuts. On a build without the module, all of it does nothing.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { CACHED_COVER } from '@/api/data';
import { dominantColorOf } from '@/hooks/useDominantColor';
import { tg } from '@/i18n';
import { artworkUrlFor, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

interface NowPlayingState {
  title: string;
  artist: string;
  /** The album the widget opens on tap; empty when the track has none. */
  albumId: string;
  artworkUrl?: string;
  playing: boolean;
  active: boolean;
  /** Seconds into the track, and its length: the widget walks on from here. */
  position: number;
  duration: number;
  /** The cover's colour as the app reads it, for the widget's background. */
  accent?: string;
  /** The widget's own background when there is no cover to take one from. */
  fallback: string;
}

const native = requireOptionalNativeModule<{
  update: (state: NowPlayingState) => void;
  /** What the app can see of its own handover, for Settings › Diagnostics. */
  status?: () => string;
  setShortcuts?: (items: { id: string; label: string; icon: string; url: string }[]) => boolean;
}>('HomeWidget');

/** The launcher shortcuts, as routed by `+native-intent` to `/shortcut`. */
export type ShortcutAction = 'shuffle-favorites' | 'continue' | 'search' | 'playback-toggle';

/** A jump this big is a seek, not the clock: worth telling the widget about. */
const SEEK_JUMP_SEC = 4;

/**
 * The cover's colour for the widget's background, resolved out here because
 * the handover runs from the store, outside React. The dark band, whichever
 * theme the app is in: the widget's text is always white, and the band is
 * what keeps white readable on a cover's colour. Empty while a new cover is
 * being read — the widget falls back to the page's own colour for that one
 * write, and the colour's own write follows.
 */
let accent = '';
let accentOf = '';

async function refreshAccent(uri?: string) {
  const want = uri ?? '';
  if (want === accentOf) return;
  accentOf = want;
  accent = '';
  if (!want) return;
  // A failed read comes back as the plain tint: no colour to send, and the
  // fallback the widget already holds is the better of the two.
  const c = await dominantColorOf(want, 'dark');
  if (accentOf !== want || c === colors.surfaceHighlight) return;
  accent = c;
  push();
}

function nowPlaying(): NowPlayingState {
  const st = usePlayerStore.getState();
  const song = st.queue[st.index];
  if (!song) {
    return {
      title: '',
      artist: '',
      albumId: '',
      playing: false,
      active: false,
      position: 0,
      duration: 0,
      fallback: colors.background,
    };
  }
  // A station says what is on, like the notification does.
  const live = song.url ? st.streamInfo : null;
  const artwork = artworkUrlFor(song);
  const state: NowPlayingState = {
    title: live?.title ?? song.title,
    artist: live?.artist ?? song.artist ?? '',
    albumId: song.albumId ?? '',
    playing: st.isPlaying,
    active: true,
    position: st.positionSec,
    duration: st.durationSec || song.duration || 0,
    fallback: colors.background,
  };
  // Offline, a cover the app only has in its image cache is no address at
  // all. Left out of the object rather than put in as `undefined`: the key
  // would still be there, with nothing for the native side to read.
  if (artwork && !artwork.startsWith(CACHED_COVER)) state.artworkUrl = artwork;
  // Only the colour of *this* cover: between covers, or while the read is
  // still out, the key stays away rather than carrying the last one over.
  if (state.artworkUrl && accent && accentOf === state.artworkUrl) state.accent = accent;
  return state;
}

let last = '';

/**
 * The handover, read back from the shared group: whether the group is there
 * to write into, and what was written and when. English in every language,
 * like the diagnostics screen it is shown in.
 */
export function widgetStatus(): string {
  if (!native) {
    // How many native modules the registry holds, to tell "nothing
    // registered" from "this one missing" in a bug report's screenshot.
    const loaded = Object.keys(globalThis.expo?.modules ?? {}).length;
    return `module missing · ${loaded} loaded`;
  }
  try {
    return native.status?.() ?? 'no status';
  } catch {
    return 'status failed';
  }
}

function push() {
  if (!native) return;
  const state = nowPlaying();
  // Kicks the read for a new cover; when it lands, this runs again with the
  // colour in the state.
  refreshAccent(state.artworkUrl);
  const key = JSON.stringify(state);
  if (key === last) return;
  try {
    native.update(state);
    last = key;
  } catch {
    // A widget that misses one update catches the next — and this one is
    // not marked as sent, so the next write sends it again.
  }
}

function installShortcuts() {
  // Android only: the iOS module is the widget, and has no shortcuts to set.
  if (!native?.setShortcuts) return;
  try {
    native.setShortcuts([
      {
        id: 'shuffle-favorites',
        label: tg('Shuffle favorites'),
        icon: 'shuffle',
        url: 'resonus://shortcut/shuffle-favorites',
      },
      {
        id: 'continue',
        label: tg('Continue listening'),
        icon: 'play',
        url: 'resonus://shortcut/continue',
      },
      { id: 'search', label: tg('Search'), icon: 'search', url: 'resonus://shortcut/search' },
    ]);
  } catch {
    // The launcher keeps whatever it had.
  }
}

/** Once, at startup. */
export function initHomeWidget() {
  if (!native) return;
  push();
  usePlayerStore.subscribe((st, prev) => {
    if (
      st.queue !== prev.queue ||
      st.index !== prev.index ||
      st.isPlaying !== prev.isPlaying ||
      st.streamInfo !== prev.streamInfo ||
      Math.abs(st.positionSec - prev.positionSec) >= SEEK_JUMP_SEC
    ) {
      push();
    }
  });
  installShortcuts();
  // The labels are in the app's language, not the phone's.
  let lang = useSettings.getState().language;
  useSettings.subscribe((s) => {
    if (s.language === lang) return;
    lang = s.language;
    installShortcuts();
  });
}
