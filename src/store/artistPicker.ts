/** State of the artist picker, the bottom sheet for collaborations. */
import { create } from 'zustand';

import { type ArtistTarget } from '@/lib/artistNav';

interface ArtistPickerState {
  artists: ArtistTarget[] | null;
  open: (artists: ArtistTarget[]) => void;
  close: () => void;
}

export const useArtistPicker = create<ArtistPickerState>((set) => ({
  artists: null,
  open: (artists) => set({ artists }),
  close: () => set({ artists: null }),
}));
