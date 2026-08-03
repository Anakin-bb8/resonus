/**
 * Message for the download confirmation dialog. Besides how many songs there
 * are, it says how much space they will take: "8.3 GB" is far more informative
 * than "1,247 songs", and it's the difference between accepting blindly or not.
 * And if it doesn't fit on the device, it warns — better that than a download
 * that dies at 80 %.
 *
 * There is no threshold and no "are you sure?": the size is right there, and
 * scolding for large downloads is unnecessary when the app already has a
 * "Wi-Fi only" setting for expressing exactly that concern.
 */
import { Paths } from 'expo-file-system';
import { useMemo } from 'react';

import { type Song } from '@/api/subsonic';
import { songsLabel, useT } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { useSettings } from '@/store/settings';

/**
 * What these songs will take up, or null if it can't be known without guessing.
 *
 * With reduced quality the server transcodes to that exact bitrate, so duration
 * alone is enough and it comes out nearly exact. With original quality the
 * bitrate of each song is needed; for FLAC it's variable, so the figure bounces
 * a bit.
 */
function estimateDownloadBytes(songs: Song[], downloadBitRate: number): number | null {
  let bytes = 0;
  for (const s of songs) {
    // Radio songs and songs that are already local are not downloaded.
    if (s.url || s.localUri) continue;
    const kbps = downloadBitRate > 0 ? downloadBitRate : s.bitRate;
    if (!s.duration || !kbps) return null; // no reliable data, don't say anything
    bytes += (s.duration * kbps * 1000) / 8;
  }
  return bytes;
}

/** Free space on the device, or null if the system doesn't expose it. */
function freeBytes(): number | null {
  try {
    const free = Paths.availableDiskSpace;
    return free >= 0 ? free : null;
  } catch {
    return null; // e.g. unsupported platform
  }
}

export function useDownloadMessage(songs: Song[]): { message: string; tight: boolean } {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const downloadBitRate = useSettings((s) => s.downloadBitRate);

  return useMemo(() => {
    const label = songsLabel(songs.length, lang);
    const bytes = estimateDownloadBytes(songs, downloadBitRate);
    if (bytes == null) {
      return { message: t('{songs} will be saved to this device.', { songs: label }), tight: false };
    }
    const size = formatBytes(bytes);
    const free = freeBytes();
    if (free != null && bytes > free) {
      return {
        message: t('{songs} need about {size}, but only {free} is free. The download may stop partway.', {
          songs: label,
          size,
          free: formatBytes(free),
        }),
        tight: true,
      };
    }
    return {
      message: t('{songs} will be saved to this device (about {size}).', {
        songs: label,
        size,
      }),
      tight: false,
    };
  }, [songs, lang, downloadBitRate, t]);
}
