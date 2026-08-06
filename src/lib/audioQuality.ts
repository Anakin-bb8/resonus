/**
 * What is actually going to be heard, in one line.
 *
 * This used to live inside `AudioQualityBadge`, which is where it is drawn on
 * the player. The song information sheet (#59) needs the very same sentence,
 * and the arrow notation for a transcode is the part that must not drift: two
 * screens describing the same file differently is worse than either wording.
 */
import { type Song } from '@/api/subsonic';

/** "24-bit / 96 kHz", or nothing if the file says neither. */
export function sampleLabel(song: Song): string | null {
  const depth = song.bitDepth ? `${song.bitDepth}-bit` : '';
  const rate = song.samplingRate
    ? song.samplingRate >= 1000
      ? `${song.samplingRate / 1000} kHz`
      : `${song.samplingRate} Hz`
    : '';
  const sample = [depth, rate].filter(Boolean).join(' / ');
  return sample || null;
}

export function qualityLabel(
  song: Song,
  maxBitRate: number,
  dlUri: string | undefined,
  dlBitRate: number | undefined,
): string | null {
  // Without format there's nothing to show. Previously it was also hidden with
  // `localUri` (local/offline), but a downloaded song does have specs to
  // display: the real file format on disk (by its extension, via `dlUri`)
  // plus the server data. Offline is precisely when it matters most.
  if (!song.suffix) return null;
  const fmt = song.suffix.toUpperCase();
  if (dlUri) {
    // Downloaded → plays from disk: the streaming limit doesn't apply. If it was
    // downloaded transcoded (the extension no longer matches the original), the
    // original file specs no longer apply either.
    const ext = dlUri.split('.').pop()?.toLowerCase();
    if (ext && ext !== song.suffix.toLowerCase()) {
      // `dlBitRate` = bitrate requested when transcoding the download (only
      // carried by newer downloads; older ones lack the number).
      return dlBitRate
        ? `${fmt} → ${ext.toUpperCase()} ${dlBitRate} kbps`
        : `${fmt} → ${ext.toUpperCase()}`;
    }
  } else if (
    !song.url &&
    !song.localUri &&
    maxBitRate > 0 &&
    song.bitRate != null &&
    song.bitRate > maxBitRate
  ) {
    // With a quality cap active and an original that exceeds it, the server
    // transcodes: the label reflects what actually plays, not the file, so it
    // says the bitrate that is really arriving.
    return `${fmt} → ${maxBitRate} kbps`;
  }
  const parts: string[] = [fmt];

  if (song.bitRate && song.bitRate > 0) {
    parts.push(`${song.bitRate} kbps`);
  }

  const sample = sampleLabel(song);
  if (sample) parts.push(sample);

  return parts.join(' · ');
}
