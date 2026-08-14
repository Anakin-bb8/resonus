/** Album/playlist context menu state (long-press on cards). */
import { create } from 'zustand';

import { type Album, type Playlist } from '@/api/subsonic';

export type MediaMenuExtraAction = {
  icon: 'play-skip-forward' | 'play-forward';
  label: string;
  onPress: () => void | Promise<void>;
};

export type MediaMenuItem =
  | { kind: 'album'; album: Album; extraActions?: MediaMenuExtraAction[] }
  | { kind: 'playlist'; playlist: Playlist };

interface MediaMenuState {
  item: MediaMenuItem | null;
  open: (item: MediaMenuItem) => void;
  close: () => void;
}

export const useMediaMenu = create<MediaMenuState>((set) => ({
  item: null,
  open: (item) => set({ item }),
  close: () => set({ item: null }),
}));
