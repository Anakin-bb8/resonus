/** Album/playlist context menu state (long-press on cards). */
import { type Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';

import { type Album, type Playlist } from '@/api/subsonic';

/** An entry a screen adds to the album sheet, above the stock ones. */
export type MediaMenuExtraAction = {
  icon: keyof typeof Ionicons.glyphMap;
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
