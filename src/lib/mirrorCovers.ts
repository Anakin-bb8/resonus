/**
 * Covers for what the library mirror keeps.
 *
 * The mirror is what makes the Library readable without a connection: what you
 * favourited, your playlists, the albums you opened. Their covers, though, were
 * only ever a URL to the server, so offline they either came out of the image
 * loader's cache or not at all. That cache is not ours: it has a size and it
 * evicts, so on a large library most of it was gone and the shelves came out as
 * grey squares.
 *
 * So the covers are saved on purpose, next to the mirror and by the same rule:
 * while online, whatever is written to the mirror gets its cover fetched once,
 * small, and from then on it is a file on disk like a download's. Nothing is
 * crawled ahead of time; this only follows what you were already looking at.
 *
 * Only albums, playlists and artists, which is what the shelves are made of. A
 * cover per song would be one file per track on a server that gives each song
 * its own cover id, and those rows are reading their album's picture anyway.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { coverArtUrl, type SubsonicAuth } from '@/api/backend';
import { isOfflineMode } from '@/api/netGate';
import { hashKey, localCoverUrl, registerCover } from '@/lib/localLibrary';

const DIR = FileSystem.documentDirectory + 'library-mirror/covers/';

/**
 * One size for everything. The shelves ask for 100 to 300 px and the image
 * loader scales down what it is given, so the largest of those is enough to
 * serve them all from one file. Around 25 KB each in practice.
 */
const SIZE = 300;

/**
 * Ceiling on how many are kept: about 250 MB at the size above, which is a
 * large library browsed end to end and a fair trade on a phone that has room.
 * There is a ceiling at all because this grows on its own, and something that
 * grows on its own should have an end somebody chose rather than one they
 * discover. What it takes is counted and shown in Settings › Downloads next to
 * the rest of the offline copy, and it goes when that goes.
 */
const MAX = 10000;

/** Cover ids already on disk for the loaded profile, and what they take. */
let known = new Set<string>();
let bytes = 0;
let loaded = '';
let saving: Promise<unknown> = Promise.resolve();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
/** Ids being fetched right now, so two screens don't fetch the same one. */
const inFlight = new Set<string>();

function indexFile(profile: string): string {
  return `${DIR}${profile}.json`;
}

function fileFor(profile: string, coverId: string): string {
  return `${DIR}${profile}_${hashKey(coverId)}.jpg`;
}

/**
 * Writes the index down, at most once every few seconds. It holds every id, so
 * it is rewritten whole each time: browsing a hundred albums should not be a
 * hundred writes of the same growing file.
 */
function persist(profile: string): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const payload = JSON.stringify({ ids: [...known], bytes });
    saving = saving.then(async () => {
      try {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
        await FileSystem.writeAsStringAsync(indexFile(profile), payload);
      } catch {
        // Lost on exit: the covers are still on disk and will be fetched again.
      }
    });
  }, 3000);
}

/** The index as it is stored, and as older versions stored it (a bare list). */
function parseIndex(raw: string): { ids: string[]; bytes: number } {
  const data = JSON.parse(raw) as string[] | { ids?: string[]; bytes?: number };
  if (Array.isArray(data)) return { ids: data, bytes: 0 };
  return { ids: data.ids ?? [], bytes: data.bytes ?? 0 };
}

/**
 * Registers the covers this profile already has, so an offline lookup finds
 * them. The file name is a hash, so which id each one belongs to has to be
 * written down: hence the index, which is a list of ids and nothing else.
 */
export async function loadMirrorCovers(profile: string): Promise<void> {
  if (!profile || loaded === profile) return;
  loaded = profile;
  known = new Set();
  bytes = 0;
  try {
    const index = parseIndex(await FileSystem.readAsStringAsync(indexFile(profile)));
    bytes = index.bytes;
    for (const id of index.ids) {
      known.add(id);
      registerCover(id, fileFor(profile, id));
    }
  } catch {
    // No index yet, or unreadable: nothing is registered and the covers get
    // fetched again the next time their entry is written to the mirror.
  }
}

/**
 * Keeps the covers of what was just written to the mirror. Best-effort and in
 * the background: a cover that doesn't arrive is a placeholder, not an error.
 *
 * `ids` are cover ids as the screens ask for them (`coverArt ?? id`), which is
 * what the offline lookup will be given.
 */
export function keepMirrorCovers(
  profile: string,
  auth: SubsonicAuth | null,
  ids: (string | undefined)[],
): void {
  // Online only: this is a download, and it goes through the file system rather
  // than the API, so the gate that refuses requests offline cannot see it.
  if (!auth || !profile || isOfflineMode()) return;
  void (async () => {
    // What is already on disk has to be known before deciding what is missing.
    // Online the mirror is opened a few seconds after launch, and the first
    // favourites arrive before that: waiting here instead of giving up is the
    // difference between saving them on the first run and on some later one.
    await loadMirrorCovers(profile);
    if (known.size >= MAX) return;
    const wanted = ids.filter(
      (id): id is string =>
        !!id && !known.has(id) && !inFlight.has(id) && !localCoverUrl(id),
    );
    const taking = wanted.slice(0, MAX - known.size);
    if (taking.length === 0) return;
    for (const id of taking) inFlight.add(id);
    let added = false;
    for (const id of taking) {
      const url = coverArtUrl(auth, id, SIZE);
      if (!url) {
        inFlight.delete(id);
        continue;
      }
      const file = fileFor(profile, id);
      try {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
        const res = await FileSystem.downloadAsync(url, file);
        // A server that answers an error writes that error to the file, and a
        // broken file on disk would pass for a cover for good.
        if (res.status !== 200) {
          await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
        } else {
          known.add(id);
          registerCover(id, file);
          // Counted as it is written: walking thousands of files to add up
          // what they take is not something a settings screen should do.
          const info = await FileSystem.getInfoAsync(file).catch(() => null);
          bytes += info?.exists ? (info.size ?? 0) : 0;
          added = true;
        }
      } catch {
        // Network, disk, whatever: it stays unknown and can be tried again.
      } finally {
        inFlight.delete(id);
      }
    }
    if (added) persist(profile);
  })();
}

/**
 * Forgets one cover, so the next time its entry is written to the mirror it is
 * fetched again. For when the app itself changes it: a playlist's picture can
 * be replaced from here, and the copy on disk would otherwise be the old one
 * for good. A change made from another client is not seen, same as a
 * download's cover.
 */
export function forgetMirrorCover(profile: string, coverId: string | undefined): void {
  if (!profile || !coverId || !known.delete(coverId)) return;
  void FileSystem.deleteAsync(fileFor(profile, coverId), { idempotent: true }).catch(() => {});
  persist(profile);
}

/**
 * Throws away one profile's covers: the index and every file it named. They
 * share a folder with other profiles' (the name carries whose it is), so this
 * takes them one by one rather than deleting the folder.
 */
export async function removeMirrorCovers(profile: string): Promise<void> {
  let ids: string[] = [];
  try {
    ids = parseIndex(await FileSystem.readAsStringAsync(indexFile(profile))).ids;
  } catch {
    // No index: the files, if any, cannot be told apart from another
    // profile's, and they are bounded and harmless.
  }
  if (loaded === profile) {
    known = new Set();
    bytes = 0;
    loaded = '';
  }
  for (const id of ids) {
    await FileSystem.deleteAsync(fileFor(profile, id), { idempotent: true }).catch(() => {});
  }
  await FileSystem.deleteAsync(indexFile(profile), { idempotent: true }).catch(() => {});
}

/** How many of this profile's covers there are and what they take, for
 *  Settings › Downloads. */
export async function mirrorCoversInfo(
  profile: string,
): Promise<{ bytes: number; count: number }> {
  if (!profile) return { bytes: 0, count: 0 };
  await loadMirrorCovers(profile);
  if (bytes > 0 || known.size === 0) return { bytes, count: known.size };
  // Covers saved before the size was being counted, or an index that lost it.
  // Added up once, here: this is asked by a screen about sizes, which is the
  // one place where walking the files is worth what it costs, and the answer
  // is written down so it is not walked again.
  let total = 0;
  for (const id of known) {
    const info = await FileSystem.getInfoAsync(fileFor(profile, id)).catch(() => null);
    total += info?.exists ? (info.size ?? 0) : 0;
  }
  bytes = total;
  persist(profile);
  return { bytes, count: known.size };
}
