/**
 * Getting a downloaded song out of the app (#57).
 *
 * Downloads live in app-private storage under hashed names, so a file that is
 * already on the phone is effectively locked in: no file manager sees it, and
 * what it is called says nothing about what it is. Both ways out here start
 * from that file and never from the server, which is what keeps this instant,
 * free and available with no connection.
 *
 * Two destinations, one copy:
 *
 * - A folder the user picks. It goes through the Storage Access Framework, and
 *   SAF is a document provider rather than a path: the destination cannot be
 *   opened as a plain file, so the bytes go through JS in chunks. That is the
 *   price of writing somewhere the app was granted rather than owns.
 * - Another app, through the share sheet. That one copies inside the app's own
 *   cache, where a native copy works, and hands over the copy rather than the
 *   original: what the receiving app sees is the name we chose, and a cache
 *   file is Android's to reclaim.
 *
 * A whole album or playlist is the same copy in a loop, into a folder named
 * after it, and only over the songs that are downloaded.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { Song } from '@/api/subsonic';

/** Read at a time when the destination cannot take a native copy. */
const CHUNK = 4 * 1024 * 1024;

/**
 * Longest base name we build. The limit is 255 bytes on every filesystem worth
 * naming, and accented characters spend two of them, so this leaves room for
 * the extension and for the " (1)" a document provider adds by itself when the
 * name is taken.
 */
const MAX_NAME = 100;

/**
 * Extension to MIME type, for the formats a server can hand over. Anything
 * unlisted goes out as generic audio, which is honest: the share sheet uses it
 * to decide who can receive the file, and claiming the wrong format there is
 * worse than claiming nothing.
 */
const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  ape: 'audio/x-ape',
  wv: 'audio/x-wavpack',
};

/**
 * Strips what a filesystem cannot take.
 *
 * The set is Android's plus FAT32's, because a phone's SD card is usually
 * FAT32 or exFAT and rejects characters a Linux server is happy to store. The
 * separators become a dash rather than nothing: "AC/DC" reads as "AC-DC" and
 * not as "ACDC". Trailing dots and spaces go too, which Windows drops silently
 * on its own, turning a name into one it did not agree to.
 */
function sanitize(part: string): string {
  return part
    .replace(/[/\\]/g, '-')
    .replace(/[:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_NAME);
}

/** The extension of what is on disk, which is the container it really is. */
function extensionOf(uri: string): string {
  return Paths.extname(uri).replace(/^\./, '').toLowerCase() || 'mp3';
}

/**
 * `Artist - Title.ext`, or just the title when there is no artist.
 *
 * From the song's metadata rather than from the server's layout, as settled in
 * #49: the file lands somewhere the user opens, and a hash is not a name.
 */
export function exportFileName(song: Song, uri: string): string {
  const ext = extensionOf(uri);
  const title = sanitize(song.title) || 'track';
  const artist = sanitize(song.artist ?? '');
  return `${artist ? `${artist} - ${title}` : title}.${ext}`;
}

/** What the file claims to be, for the picker and for the receiving app. */
export function mimeOf(uri: string): string {
  return MIME[extensionOf(uri)] ?? 'audio/*';
}

/** Hands the event loop back, so a long copy does not freeze the interface. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Writes `src` into `dest` a chunk at a time.
 *
 * Each chunk after the first appends, which is the only way to write a large
 * file into a document provider without holding all of it in memory at once.
 */
async function copyInChunks(src: File, dest: File): Promise<void> {
  const handle = src.open();
  try {
    let first = true;
    for (;;) {
      const chunk = handle.readBytes(CHUNK);
      if (chunk.length === 0) break;
      dest.write(chunk, { append: !first });
      first = false;
      await breathe();
    }
  } finally {
    handle.close();
  }
}

/**
 * Copies one downloaded song into an open folder, and returns the name it was
 * saved under.
 *
 * The name is not forced: a document provider that already has one appends
 * " (1)" rather than overwriting, and an export that silently replaces what
 * was there is the kind of surprise this feature exists to avoid.
 */
async function copyOne(song: Song, srcUri: string, folder: Directory): Promise<string> {
  const name = exportFileName(song, srcUri);
  const mime = mimeOf(srcUri);
  const src = new File(srcUri);
  // Checked before anything is opened. A file handle is a `RandomAccessFile`
  // in "rw", which CREATES what it does not find: on a catalog that has drifted
  // from the disk, reading a missing download would leave an empty file sitting
  // in the downloads folder as if it were the song, and export a silent empty
  // copy on top of that. Failing here is the honest end of both.
  if (!src.exists) throw new Error(`missing download: ${srcUri}`);
  let dest = folder.createFile(name, mime);
  try {
    await copyInChunks(src, dest);
  } catch {
    // Not every document provider reopens a file for appending. Where that is
    // refused the copy has to go in one piece, and the half-written file has
    // to go with it: writing over it depends on the provider truncating, and
    // some do not.
    dest.delete();
    dest = folder.createFile(name, mime);
    dest.write(await src.bytes());
  }
  return savedName(dest, name);
}

/** Copies a downloaded song into a folder the user picked. */
export function exportToFolder(song: Song, srcUri: string, folderUri: string): Promise<string> {
  return copyOne(song, srcUri, new Directory(folderUri));
}

/**
 * Copies a whole album or playlist, one file per song, into a folder of its
 * own inside the one that was picked.
 *
 * The subfolder is not decoration: twenty files landing loose in the middle of
 * somebody's music folder is a mess to undo, and an album is a folder
 * everywhere else on a phone. If a song fails the rest still go, and the count
 * that comes back is what the message reports, because "exported" over an
 * album that half arrived is the lie worth avoiding here.
 */
export async function exportManyToFolder(
  items: { song: Song; uri: string }[],
  folderUri: string,
  subfolder: string,
): Promise<{ saved: number; failed: number }> {
  const parent = new Directory(folderUri);
  const name = sanitize(subfolder);
  const dir = name ? parent.createDirectory(name) : parent;
  let saved = 0;
  let failed = 0;
  for (const { song, uri } of items) {
    try {
      await copyOne(song, uri, dir);
      saved++;
    } catch {
      failed++;
    }
  }
  return { saved, failed };
}

/** What an export will actually write, for the question asked before it. */
export function totalBytes(uris: string[]): number {
  let total = 0;
  for (const uri of uris) {
    try {
      total += new File(uri).size ?? 0;
    } catch {
      // A file the catalog knows about and the disk does not: it adds nothing
      // to the total, and the copy will report it as the failure it is.
    }
  }
  return total;
}

/**
 * The name the file ended up with, for the message that says where it went.
 *
 * `File.name` is the last segment of the URI, and a document provider's URI is
 * an encoded document id rather than a path, so it comes back as
 * `primary%3AMusic%2FArtist%20-%20Title.mp3`. Decoding it and keeping the last
 * segment recovers the real name, including the " (1)" a provider adds when
 * the name was taken. Anything that does not come out looking like a file name
 * falls back to what we asked for, which is what it will be in almost every
 * case anyway.
 */
function savedName(dest: File, requested: string): string {
  try {
    const last = decodeURIComponent(dest.uri).split(/[/:]/).pop() ?? '';
    return /\.[a-z0-9]{1,5}$/i.test(last) ? last : requested;
  } catch {
    return requested;
  }
}

/**
 * Hands a downloaded song to another app, and says whether the share sheet
 * could be opened at all.
 *
 * The copy in the cache is what carries the readable name: sharing the
 * download itself would send `3f2a…mp3`, since the name is all the receiving
 * app gets to see.
 */
export async function shareSongFile(song: Song, srcUri: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const dir = new Directory(Paths.cache, 'export');
  // Emptied first: these copies exist for one share sheet each, and Android
  // clears the cache on its own schedule, not on ours.
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  const dest = new File(dir, exportFileName(song, srcUri));
  new File(srcUri).copy(dest);
  await Sharing.shareAsync(dest.uri, {
    mimeType: mimeOf(srcUri),
    UTI: 'public.audio',
  });
  return true;
}
