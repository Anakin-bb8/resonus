/**
 * Whether one podcast episode is out of reach offline: offline mode is on
 * (asked for or fallen out) and no downloaded file exists for it. The
 * episode's `url` is the publisher's address, which offline mode says no to,
 * so only a file on the phone plays it — the same rule `TrackRow` works out
 * for songs and `markUnplayableOffline` marks for the queues.
 *
 * The rule is exported twice: the hook subscribes (a finished download or a
 * flip of the mode re-lights the rows), while `episodeUnavailable` is the
 * plain function for lists that already hold `offline` and the `files` map
 * under their own subscriptions — one rule, no drift.
 */
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';

/** The rule itself, for callers holding `offline` and the downloads' `files`. */
export function episodeUnavailable(offline: boolean, files: Record<string, string>, id?: string): boolean {
  return offline && !!id && !files[id];
}

/** Subscribed: a row re-lights when a download lands or the mode flips. */
export function useEpisodeUnavailable(episodeId?: string): boolean {
  const offline = useAuthStore((s) => s.offline);
  const files = useDownloads((s) => s.files);
  return episodeUnavailable(offline, files, episodeId);
}
