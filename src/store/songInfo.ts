/** Which song the information sheet is showing, if any (#59). */
import { create } from 'zustand';

import { type Song } from '@/api/subsonic';

interface SongInfoState {
  song: Song | null;
  open: (song: Song) => void;
  close: () => void;
}

export const useSongInfo = create<SongInfoState>((set) => ({
  song: null,
  open: (song) => set({ song }),
  close: () => set({ song: null }),
}));
