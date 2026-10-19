/**
 * Whether one podcast episode is out of reach offline: offline mode is on
 * (asked for or fallen out) and no downloaded file exists for it. The
 * episode's `url` is the publisher's address, which offline mode says no to,
 * so only a file on the phone plays it — the same rule `TrackRow` works out
 * for songs.
 *
 * Subscribed rather than read off the stores: a finished download or a flip
 * of the mode re-lights the rows.
 */
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';

export function useEpisodeUnavailable(episodeId?: string): boolean {
  const offline = useAuthStore((s) => s.offline);
  const hasFile = useDownloads((s) => !!s.files[episodeId ?? '']);
  return offline && !!episodeId && !hasFile;
}
