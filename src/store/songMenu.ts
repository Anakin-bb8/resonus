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
}

interface SongMenuState {
  song: Song | null;
  context: SongMenuContext | null;
  showLyrics: boolean;
  sleep: boolean;
  open: (song: Song, context?: SongMenuContext, opts?: SongMenuOptions) => void;
  close: () => void;
}

export const useSongMenu = create<SongMenuState>((set) => ({
  song: null,
  context: null,
  showLyrics: false,
  sleep: false,
  open: (song, context, opts) =>
    set({ song, context: context ?? null, showLyrics: !!opts?.showLyrics, sleep: !!opts?.sleep }),
  close: () => set({ song: null, context: null, showLyrics: false, sleep: false }),
}));
