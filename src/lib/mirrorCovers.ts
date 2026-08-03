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

import { coverArtUrl } from '@/api/backend';
import { hashKey, localCoverUrl, registerCover } from '@/lib/localLibrary';
import { useAuthStore } from '@/store/auth';

const DIR = FileSystem.documentDirectory + 'library-mirror/covers/';

/**
 * One size for everything. The shelves ask for 100 to 300 px and the image
 * loader scales down what it is given, so the largest of those is enough to
 * serve them all from one file. Around 25 KB each in practice.
 */
const SIZE = 300;

/**
 * Ceiling on how many are kept. Two thousand covers is a library nobody
 * browses in one sitting, and about 50 MB. Past it nothing new is fetched:
 * better to stop than to grow without an end somebody has to discover.
 */
const MAX = 2000;

/** Cover ids already on disk for the loaded profile. */
let known = new Set<string>();
let loaded = '';
let saving: Promise<unknown> = Promise.resolve();
/** Ids being fetched right now, so two screens don't fetch the same one. */
const inFlight = new Set<string>();

function indexFile(profile: string): string {
  return `${DIR}${profile}.json`;
}

function fileFor(profile: string, coverId: string): string {
  return `${DIR}${profile}_${hashKey(coverId)}.jpg`;
}

function persist(profile: string): void {
  const ids = [...known];
  saving = saving.then(async () => {
    try {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      await FileSystem.writeAsStringAsync(indexFile(profile), JSON.stringify(ids));
    } catch {
      // Lost on exit: the covers are still on disk and will be fetched again.
    }
  });
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
  try {
    const raw = await FileSystem.readAsStringAsync(indexFile(profile));
    for (const id of JSON.parse(raw) as string[]) {
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
export function keepMirrorCovers(profile: string, ids: (string | undefined)[]): void {
  const { auth, offline } = useAuthStore.getState();
  // Online only: this is a download, and it goes through the file system rather
  // than the API, so the gate that refuses requests offline cannot see it.
  if (!auth || offline || !profile || loaded !== profile) return;
  const wanted = ids.filter(
    (id): id is string =>
      !!id && !known.has(id) && !inFlight.has(id) && !localCoverUrl(id),
  );
  if (wanted.length === 0 || known.size >= MAX) return;
  const taking = wanted.slice(0, MAX - known.size);
  for (const id of taking) inFlight.add(id);
  void (async () => {
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
    ids = JSON.parse(await FileSystem.readAsStringAsync(indexFile(profile))) as string[];
  } catch {
    // No index: the files, if any, cannot be told apart from another
    // profile's, and they are bounded and harmless.
  }
  if (loaded === profile) {
    known = new Set();
    loaded = '';
  }
  for (const id of ids) {
    await FileSystem.deleteAsync(fileFor(profile, id), { idempotent: true }).catch(() => {});
  }
  await FileSystem.deleteAsync(indexFile(profile), { idempotent: true }).catch(() => {});
}
