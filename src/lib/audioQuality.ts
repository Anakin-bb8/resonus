/**
 * What is actually going to be heard, in one line.
 *
 * This used to live inside `AudioQualityBadge`, which is where it is drawn on
 * the player. The song information sheet (#59) needs the very same sentence,
 * and the arrow notation for a transcode is the part that must not drift: two
 * screens describing the same file differently is worse than either wording.
 */
import type { Song } from '@/api/subsonic';

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

/** Extensions that only ever hold lossless audio. */
const LOSSLESS = new Set([
  'flac', 'wav', 'wave', 'aif', 'aiff', 'aifc', 'alac', 'ape', 'wv',
  'dsf', 'dff', 'tak', 'tta', 'shn', 'ofr',
]);
/** Containers that hold either: ALAC and AAC are both `.m4a`. */
const EITHER = new Set(['m4a', 'mp4', 'm4b', 'caf', 'mka', 'mkv', 'webm']);
/** Extensions that only ever hold lossy audio. */
const LOSSY = new Set(['mp3', 'mp2', 'aac', 'ogg', 'oga', 'opus', 'wma', 'mpc', 'spx', 'amr']);

/**
 * Is the file on the server lossless? Unknown files count as lossless when
 * their bitrate is past anything a lossy codec is used at.
 */
export function isLossless(song: Pick<Song, 'suffix' | 'bitDepth' | 'bitRate'>): boolean {
  const ext = song.suffix?.toLowerCase() ?? '';
  if (LOSSLESS.has(ext)) return true;
  if (LOSSY.has(ext)) return false;
  // Servers report a bit depth only for PCM-based codecs.
  if (EITHER.has(ext) && song.bitDepth) return true;
  return (song.bitRate ?? 0) > 500;
}

/**
 * What to ask the server for, given the quality settings: `bitRate` 0 means
 * the original file. With `losslessOnly`, a lossy file is never re-encoded
 * (#216).
 */
export function transcodeTarget(
  song: Pick<Song, 'suffix' | 'bitDepth' | 'bitRate'>,
  bitRate: number,
  format: string,
  losslessOnly: boolean,
): { bitRate: number; format: string } {
  if (bitRate <= 0 || (losslessOnly && !isLossless(song))) return { bitRate: 0, format: '' };
  return { bitRate, format };
}

export function qualityLabel(
  song: Song,
  maxBitRate: number,
  dlUri: string | undefined,
  dlBitRate: number | undefined,
  /**
   * Codec the stream is being asked for, empty for the server's own. It has to
   * be here because a forced one transcodes a file that was already under the
   * limit, and the label read from the bitrate alone would then describe the
   * file on the server while something else entirely was arriving.
   */
  streamFormat = '',
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
  } else if (!song.url && !song.localUri && maxBitRate > 0) {
    // The same rule the player uses to decide a stream is being made on the
    // fly (`isTranscoded`), and it has to stay the same rule: the server
    // re-encodes either because the original is over the cap, or because a
    // codec was asked for, which it does even to a file that already fitted.
    // Reading the bitrate alone missed that second case entirely and left the
    // badge describing the file on the server while Opus was arriving.
    //
    // Only with a cap, since the codec rides on the same request and a stream
    // with no limit is the original file, whatever the setting says.
    const overCap = song.bitRate != null && song.bitRate > maxBitRate;
    if (streamFormat || overCap) {
      // What was asked for, which is all that can honestly be said: a server
      // may hand back something else, and with no codec named it picks its own.
      // Naming one that matches the original would only produce "MP3 → MP3":
      // the arrow already says it is being re-encoded, and to what is the part
      // that has not changed.
      const named = streamFormat && streamFormat.toLowerCase() !== song.suffix.toLowerCase();
      const codec = named ? `${streamFormat.toUpperCase()} ` : '';
      return `${fmt} → ${codec}${maxBitRate} kbps`;
    }
  }
  const parts: string[] = [fmt];

  if (song.bitRate && song.bitRate > 0) {
    parts.push(`${song.bitRate} kbps`);
  }

  const sample = sampleLabel(song);
  if (sample) parts.push(sample);

  return parts.join(' · ');
}
