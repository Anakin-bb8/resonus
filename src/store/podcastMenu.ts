/** Podcast show context menu state (long-press on a show's card/row). */
import { create } from 'zustand';

import { type PodcastChannel } from '@/api/podcasts';

interface PodcastMenuState {
  channel: PodcastChannel | null;
  open: (channel: PodcastChannel) => void;
  close: () => void;
}

export const usePodcastMenu = create<PodcastMenuState>((set) => ({
  channel: null,
  open: (channel) => set({ channel }),
  close: () => set({ channel: null }),
}));
