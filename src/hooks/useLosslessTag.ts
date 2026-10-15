/**
 * The lossless tag beside the output: what is actually arriving, not what the
 * file on the server claims. Same source rule as the quality badge (a
 * download plays from disk, the cache only when the player picked it), and
 * the same transcode rule: anything converted on the way shows nothing.
 */
import type { Song } from '@/api/subsonic';
import { playbackLossless, transcodeTarget } from '@/lib/audioQuality';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useNetworkType } from '@/store/networkType';
import { localSourceFor } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSongCache } from '@/store/songCache';

export function useLosslessTag(song: Song | null | undefined): 'lossless' | 'high-res' | null {
  // Streaming quality depends on the current network (Wi-Fi or mobile data).
  const cellular = useNetworkType((s) => s.cellular);
  const maxBitRate = useSettings((s) => (cellular ? s.maxBitRateCellular : s.maxBitRate));
  const streamFormat = useSettings((s) => (cellular ? s.streamFormatCellular : s.streamFormat));
  const losslessOnly = useSettings((s) => s.streamLosslessOnly);
  const dlUri = useDownloads((s) => (song ? s.files[song.id] : undefined));
  const cached = useSongCache((s) => (song ? s.entries[song.id] : undefined));
  // Subscribed so the tag follows them, like the badge does.
  useSettings((s) => s.preferDownloads);
  useAuthStore((s) => s.offline);
  if (!song) return null;
  const target = transcodeTarget(song, maxBitRate, streamFormat, losslessOnly);
  const source = localSourceFor(song);
  const fromDownload = !!dlUri && !!source;
  const fromCache = !fromDownload && !!cached && source === cached.uri;
  let transcoded: boolean;
  if (fromDownload && dlUri) {
    // From disk: the download's extension says what it was converted to, if
    // anything (older downloads lack the bitrate, the extension is enough).
    const ext = dlUri.split('.').pop()?.toLowerCase();
    transcoded = !!ext && ext !== song.suffix?.toLowerCase();
  } else if (fromCache) {
    // The cache holds the fetched stream: converted when it was fetched
    // converted. What the badge would have named with an arrow.
    transcoded = target.bitRate > 0 || !!target.format;
  } else if (!song.url && !song.localUri && maxBitRate > 0) {
    // The same rule the badge (and the player) judges a server stream by.
    const overCap = song.bitRate != null && song.bitRate > maxBitRate;
    transcoded = !!streamFormat || overCap;
  } else {
    transcoded = false;
  }
  return playbackLossless(song, transcoded);
}
