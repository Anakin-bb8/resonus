/** Song context menu state (the bottom sheet with actions). */
import { create } from 'zustand';

import { type Song } from '@/api/subsonic';

/** Optional context: if the song is opened from an editable playlist. */
export interface SongMenuContext {
  playlistId: string;
  /** Position of the song within the playlist (for removing it). */
  index: number;
}

/** Extra options when opening the menu (e.g. from the player). */
export interface SongMenuOptions {
  /** Shows the «Lyrics» action. Only from the player: /lyrics opens the
   *  current song, not an arbitrary row's song. */
  showLyrics?: boolean;
  /** Opens straight on the sleep timer's choices (the player's button). */
  sleep?: boolean;
  /**
   * The player's own buttons, for when they are hidden from the row under the
   * controls: hiding all of them left the queue out of reach (#248).
   */
  queue?: boolean;
  devices?: () => void;
  speed?: () => void;
}

/** What the player hands over of its own buttons; empty from anywhere else. */
export interface PlayerExtras {
  queue: boolean;
  devices?: () => void;
  speed?: () => void;
}

const NO_EXTRAS: PlayerExtras = { queue: false };

interface SongMenuState {
  song: Song | null;
  context: SongMenuContext | null;
  showLyrics: boolean;
  sleep: boolean;
  extras: PlayerExtras;
  open: (song: Song, context?: SongMenuContext, opts?: SongMenuOptions) => void;
  close: () => void;
}

export const useSongMenu = create<SongMenuState>((set) => ({
  song: null,
  context: null,
  showLyrics: false,
  sleep: false,
  extras: NO_EXTRAS,
  open: (song, context, opts) =>
    set({
      song,
      context: context ?? null,
      showLyrics: !!opts?.showLyrics,
      sleep: !!opts?.sleep,
      extras: { queue: !!opts?.queue, devices: opts?.devices, speed: opts?.speed },
    }),
  close: () => set({ song: null, context: null, showLyrics: false, sleep: false, extras: NO_EXTRAS }),
}));
