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
 * Albums, playlists and artists, which is what the shelves are made of, plus
 * the album behind each song a playlist or the favourites keep. Never a song's
 * own cover id: on a server that gives every track one, that would be a file
 * per track, and offline the rows ask for their album's picture instead (see
 * `songCoverUrl`). That last part used to be assumed rather than done, which
 * is why a playlist offline was a column of grey squares.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { COVER, coverArtUrl, type SubsonicAuth } from '@/api/backend';
import { isOfflineMode } from '@/api/netGate';
import { whenIdle } from '@/lib/idle';
import { bump } from '@/lib/perfLog';
import { hashKey, localCoverUrl, registerCover } from '@/lib/localLibrary';

const DIR = FileSystem.documentDirectory + 'library-mirror/covers/';

/**
 * One size for everything, and it has to be the largest anything asks for
 * rather than the smallest: the same file is the 56 px thumbnail in a list and
 * the cover across the top of the album, and a picture saved for the list
 * looks soft where it matters most. The image loader scales down for free;
 * upwards it cannot. Around 50 KB each in practice.
 */
const SIZE = COVER.card;

/**
 * Ceiling on how many are kept. A library browsed end to end, and nobody
 * browses ten thousand albums in a sitting: what this really bounds is the
 * runaway case, which is the only reason to have a number at all.
 * There is a ceiling at all because this grows on its own, and something that
 * grows on its own should have an end somebody chose rather than one they
 * discover. What it takes is counted and shown in Settings › Downloads next to
 * the rest of the offline copy, and it goes when that goes.
 */
const MAX = 10000;

/**
 * What a cover is wanted for: the id to ask the server with, and the ids the
 * screens will look it up by.
 *
 * They are not always the same, and that is the whole reason this type exists.
 * Subsonic gives an album a cover id of its own (`al-123` against the album's
 * `123`), the album header asks by the first and a song row asks by the
 * second, and a picture saved under one was a grey square under the other. A
 * playlist row goes further: all it knows is the song, whose own cover id
 * (`mf-…`) the server does answer, and what it will ask by is the album.
 *
 * So one file, fetched by `from`, found under every one of `keys`.
 */
export interface CoverWant {
  from: string;
  keys: string[];
}

/** Cover ids already on disk for the loaded profile, and what they take. */
let known = new Set<string>();
/** Lookup id → the id whose file it is. Only for the ones that differ. */
let aliases = new Map<string, string>();
let bytes = 0;
let loaded = '';
let saving: Promise<unknown> = Promise.resolve();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
/** How many covers are fetched at the same time. */
const FETCH_AT_ONCE = 4;

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
    const payload = JSON.stringify({ ids: [...known], aliases: Object.fromEntries(aliases), bytes });
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
function parseIndex(raw: string): {
  ids: string[];
  aliases: Record<string, string>;
  bytes: number;
} {
  const data = JSON.parse(raw) as
    | string[]
    | { ids?: string[]; aliases?: Record<string, string>; bytes?: number };
  if (Array.isArray(data)) return { ids: data, aliases: {}, bytes: 0 };
  return { ids: data.ids ?? [], aliases: data.aliases ?? {}, bytes: data.bytes ?? 0 };
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
  aliases = new Map();
  bytes = 0;
  try {
    const index = parseIndex(await FileSystem.readAsStringAsync(indexFile(profile)));
    bytes = index.bytes;
    for (const id of index.ids) {
      known.add(id);
      registerCover(id, fileFor(profile, id));
    }
    // The other names the same file answers to. No second copy on disk: the
    // album's cover and the one its songs ask for are one picture.
    for (const [key, from] of Object.entries(index.aliases)) {
      if (!known.has(from)) continue;
      aliases.set(key, from);
      registerCover(key, fileFor(profile, from));
    }
  } catch {
    // No index yet, or unreadable: nothing is registered and the covers get
    // fetched again the next time their entry is written to the mirror.
  }
}

/**
 * Notes that one more id finds this file, and registers it now.
 *
 * The id a file is named after is not recorded as an alias of itself: the index
 * already has it, and writing it twice would be two ways of saying one thing.
 */
function alias(profile: string, key: string, from: string): void {
  if (key === from || aliases.get(key) === from) return;
  aliases.set(key, from);
  registerCover(key, fileFor(profile, from));
}

/**
 * Keeps the covers of what was just written to the mirror. Best-effort and in
 * the background: a cover that doesn't arrive is a placeholder, not an error.
 *
 * A bare string is the plain case, where the id asked of the server is also the
 * id the screens look it up by. Where those differ, see `CoverWant`.
 */
export function keepMirrorCovers(
  profile: string,
  auth: SubsonicAuth | null,
  ids: (string | CoverWant | undefined)[],
): void {
  // Online only: this is a download, and it goes through the file system rather
  // than the API, so the gate that refuses requests offline cannot see it.
  if (!auth || !profile || isOfflineMode()) return;
  // When the thread is free. This is called from the middle of opening an album
  // or a playlist, and downloading a few hundred covers is not something to
  // start while a transition is still running: nothing here is urgent, and a
  // screen that arrives late is what the user actually notices.
  whenIdle(() => {
    void (async () => {
      // What is already on disk has to be known before deciding what is missing.
      // Online the mirror is opened a few seconds after launch, and the first
      // favourites arrive before that: waiting here instead of giving up is the
      // difference between saving them on the first run and on some later one.
      await loadMirrorCovers(profile);
      if (known.size >= MAX) return;
      // Deduplicated by what is being LOOKED UP, not by what is fetched. Twenty
      // favourites off one record ask for twenty different pictures as far as
      // the server is concerned, since each song has a cover id of its own, and
      // all twenty are the album's one file. Keeping the first want that claims
      // a key is what turns eight hundred downloads into two hundred.
      const claimed = new Set<string>();
      const byFrom = new Map<string, CoverWant>();
      for (const want of ids) {
        if (!want) continue;
        const w = typeof want === 'string' ? { from: want, keys: [want] } : want;
        if (!w.from || w.keys.length === 0) continue;
        const seen = byFrom.get(w.from);
        if (seen) {
          for (const k of w.keys) {
            if (claimed.has(k)) continue;
            claimed.add(k);
            seen.keys.push(k);
          }
          continue;
        }
        if (w.keys.every((k) => claimed.has(k))) continue;
        for (const k of w.keys) claimed.add(k);
        byFrom.set(w.from, { from: w.from, keys: [...w.keys] });
      }
      // A want whose keys can all be found already is nothing to do. That is
      // what makes running this over a whole library cheap after the first time.
      const wanted = [...byFrom.values()].filter(
        (w) =>
          !inFlight.has(w.from) &&
          w.keys.some((k) => !localCoverUrl(k)) &&
          !(known.has(w.from) && w.keys.every((k) => localCoverUrl(k))),
      );
      const taking = wanted.slice(0, MAX - known.size);
      if (taking.length === 0) return;
      for (const w of taking) inFlight.add(w.from);
      let added = false;

      /** One want: the file if it is missing, the names for it either way. */
      const fetchOne = async (w: CoverWant): Promise<void> => {
        const id = w.from;
        try {
          // Already on disk, and only the other names for it were missing: the
          // picture does not need fetching twice.
          if (known.has(id)) {
            for (const key of w.keys) alias(profile, key, id);
            added = true;
            return;
          }
          const url = coverArtUrl(auth, id, SIZE);
          if (!url) return;
          const file = fileFor(profile, id);
          await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
          const res = await FileSystem.downloadAsync(url, file);
          // A server that answers an error writes that error to the file, and a
          // broken file on disk would pass for a cover for good.
          if (res.status !== 200) {
            await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
            bump('cover refused by server');
            return;
          }
          known.add(id);
          registerCover(id, file);
          for (const key of w.keys) alias(profile, key, id);
          bump('cover saved');
          // Counted as it is written: walking thousands of files to add up
          // what they take is not something a settings screen should do.
          const info = await FileSystem.getInfoAsync(file).catch(() => null);
          bytes += info?.exists ? (info.size ?? 0) : 0;
          added = true;
        } catch {
          // Network, disk, whatever: it stays unknown and can be tried again.
          bump('cover fetch failed');
        } finally {
          inFlight.delete(id);
        }
      };

      // A few at a time. One after another meant a library's worth of covers
      // took as many round trips as there were albums, and somebody looking at
      // their favourites five minutes in still saw grey. Four, which is what
      // the playlist prefetch settled on: enough to keep the link busy, few
      // enough not to be a burst at somebody's server.
      for (let i = 0; i < taking.length; i += FETCH_AT_ONCE) {
        await Promise.all(taking.slice(i, i + FETCH_AT_ONCE).map(fetchOne));
      }
      if (added) persist(profile);
    })();
  });
}

/**
 * What is on disk for the loaded profile, for the diagnostics screen. A cover
 * that is missing is either not saved (`saved` low against a big library) or
 * saved under a name nothing asks by (`saved` high and the lookups still
 * missing), and those are two different bugs.
 */
export function mirrorCoverState(): { saved: number; aliases: number } {
  return { saved: known.size, aliases: aliases.size };
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
  // The other names for it go too, or the index would keep pointing them at a
  // file that is no longer there.
  for (const [key, from] of aliases) if (from === coverId) aliases.delete(key);
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
    aliases = new Map();
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
