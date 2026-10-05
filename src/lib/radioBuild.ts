/**
 * The radios on Home: which artists get one, what goes in it, and when the
 * set is rebuilt.
 *
 * A radio is a seed artist (the one in its title, "Radio di …") plus similar
 * artists mixed beside it — never a saved playlist: nothing is written to
 * the server. The def carries a snapshot of the tracks it opened with, so
 * the screen is already full the first time it is drawn, and a fresh list is
 * asked for whenever it has gone stale — the mix still reflects the library
 * as it is now.
 *
 * The seeds come from the server's own play counts, which is where every
 * listen lands anyway: the player reports to the server, and the server
 * passes it on to Last.fm or ListenBrainz when it is set up for that. A
 * local profile has the same counts, so there is one path to read and
 * nothing to fill in.
 */
import {
  COVER,
  coverArtUrl,
  getArtists,
  getArtist,
  getArtistInfo,
  getMostPlayedSongs,
  getRandomSongs,
  getSimilarSongs,
  getTopSongs,
} from '@/api/data';
import type { Artist, Song } from '@/api/subsonic';
import { dominantColorOf } from '@/hooks/useDominantColor';
import { ensureRadioIcons } from '@/lib/radioArt';
import { useRadios, radiosStale, type RadioArtist, type RadioDef } from '@/store/radios';
import { themeMode } from '@/theme';

/** How many radios the section offers. */
export const RADIO_SEEDS = 6;

/** How many tracks a radio aims for. */
export const RADIO_TARGET = 30;

/** Similar artists kept per radio: the pool the track mix draws from. */
const SIMILAR_PER_RADIO = 8;

/** Fisher–Yates (Home's own `shuffled`, for the fallback tiers). */
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Seeds from this server's play counts: the artists behind the most played
 * songs, ordered by plays. The cover is the album's, not the artist's — what
 * `buildRadioDef` fetches upgrades it to the artist's own when there is one.
 */
async function serverSeeds(limit: number): Promise<RadioArtist[]> {
  const songs = await getMostPlayedSongs(100);
  const byArtist = new Map<string, { artist: RadioArtist; plays: number }>();
  for (const s of songs) {
    if (!s.artistId || !s.artist) continue;
    const plays = s.playCount ?? 1;
    const cur = byArtist.get(s.artistId);
    if (cur) cur.plays += plays;
    else byArtist.set(s.artistId, { artist: { id: s.artistId, name: s.artist, coverArt: s.coverArt }, plays });
  }
  return [...byArtist.values()]
    .sort((x, y) => y.plays - x.plays)
    .slice(0, limit)
    .map((x) => x.artist);
}

/**
 * The radio seeds: the artists behind the most played songs, and any
 * artists at all filling the rest. Six radios about artists you never
 * played beats no radios, and the section still hides itself when even
 * that comes back empty (a library with no artists).
 */
export async function pickSeeds(limit: number): Promise<RadioArtist[]> {
  const out: RadioArtist[] = [];
  const seen = new Set<string>();
  const take = (list: RadioArtist[]) => {
    for (const a of list) {
      if (out.length >= limit || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  };

  try {
    take(await serverSeeds(limit));
  } catch {
    // The play counts didn't answer; the tier below still can.
  }
  if (out.length < limit) {
    try {
      take(shuffled(await getArtists()).map((a: Artist) => ({ id: a.id, name: a.name, coverArt: a.coverArt })));
    } catch {
      // Nothing left to try.
    }
  }
  return out.slice(0, limit);
}

/**
 * One radio definition: the seed confirmed against the server (its current
 * name and cover), its similar artists, and the colour its icon will use.
 *
 * Every fetch has its own catch so a server without the Last.fm agent — or
 * with `getArtistInfo` off — still produces a radio of the seed's own top
 * tracks, which is what an empty `similar` means for the mix below.
 */
export async function buildRadioDef(seed: RadioArtist): Promise<RadioDef | null> {
  let base = seed;
  try {
    const { artist } = await getArtist(seed.id);
    base = { id: seed.id, name: artist.name || seed.name, coverArt: artist.coverArt ?? seed.coverArt };
  } catch {
    if (!seed.name) return null; // nothing to title it with
  }

  let similar: RadioArtist[] = [];
  try {
    const info = await getArtistInfo(base.id);
    similar = info.similarArtists
      .filter((a) => a.id !== base.id)
      .slice(0, SIMILAR_PER_RADIO)
      .map((a) => ({ id: a.id, name: a.name, coverArt: a.coverArt }));
  } catch {
    // No similables: the radio is the seed's own.
  }

  const color = await dominantColorOf(
    coverArtUrl(base.coverArt ?? base.id, COVER.thumb),
    themeMode(),
    true,
  );
  return { seed: base, similar, color, createdAt: Date.now() };
}

/**
 * The tracks of one radio, aiming at `RADIO_TARGET`.
 *
 * Four pools are gathered — the seed's own top songs, the similar artists'
 * top songs, whatever the server suggests as similar to the seed's first
 * track, and the library's random songs — each shuffled, so the order is
 * not the same twice the way a server's ranking always is. The pools are
 * then dealt out round by round, one song from each per pass: every source
 * keeps feeding the mix instead of playing as a block.
 *
 * Three rules make it a radio rather than shuffled bins. It opens on the
 * seed's own most played — a radio never starts anywhere else. No two tracks
 * in a row are ever the same artist. And each artist is capped by the pool
 * it came from (six from the seed, three from a similar, two from the
 * filler) so nobody takes the list over, the same rule the player's own
 * radio extension works by (see `radioCandidates` in player.ts).
 */
export async function radioTracks(def: RadioDef): Promise<Song[]> {
  const [seedTop, similarLists] = await Promise.all([
    getTopSongs(def.seed.name, 15, def.seed.id).catch(() => [] as Song[]),
    Promise.all(
      def.similar
        .slice(0, 6)
        .map((a) => getTopSongs(a.name, 6, a.id).catch(() => [] as Song[])),
    ),
  ]);
  const extras = seedTop[0]
    ? await getSimilarSongs(seedTop[0].id, 30).catch(() => [] as Song[])
    : [];
  const random = await getRandomSongs(50).catch(() => [] as Song[]);

  const artistOf = (s: Song): string => s.artistId ?? s.artist ?? '';
  // The opener: the seed's own most played, taken before the shuffle that
  // scrambles the rest — the first frame of the list is always the same.
  const opener = seedTop.find((s) => s.id && !s.url);
  const pools = [
    { songs: shuffled(seedTop.filter((s) => s !== opener)), cap: 6 },
    ...similarLists.map((list) => ({ songs: shuffled(list), cap: 3 })),
    { songs: shuffled(extras), cap: 2 },
    { songs: shuffled(random), cap: 2 },
  ].filter((p) => p.songs.length > 0);

  // Per pool, filter once: playable, not a repeat of a song already handed
  // out (the pools overlap — an artist's track can sit in three of them),
  // and within its artist's cap. The opener counts against the seed pool's
  // cap: six of the seed's own songs in all, opener included.
  const seen = new Set<string>();
  if (opener?.id) seen.add(opener.id);
  const lists = pools.map((p, i) => {
    const perArtist = new Map<string, number>();
    if (i === 0 && opener) perArtist.set(artistOf(opener), 1);
    const out: Song[] = [];
    for (const s of p.songs) {
      if (!s.id || s.url || seen.has(s.id)) continue;
      const artist = artistOf(s);
      const n = (perArtist.get(artist) ?? 0) + 1;
      if (n > p.cap) continue;
      perArtist.set(artist, n);
      seen.add(s.id);
      out.push(s);
    }
    return out;
  });

  const picked: Song[] = [];
  if (opener) picked.push(opener);

  // Deal: each pass takes the next song from every pool in turn. A pool
  // whose head repeats the artist just played holds it back for a later
  // slot; when every remaining head repeats it, the mix has said what it
  // has to say and the list stops where it is — the rule does not bend.
  const ptr = lists.map(() => 0);
  let cursor = 0;
  let guard = 0;
  while (picked.length < RADIO_TARGET && guard++ < RADIO_TARGET * 4) {
    const live = lists.map((_, i) => i).filter((i) => ptr[i] < lists[i].length);
    if (live.length === 0) break;
    const i = live[cursor++ % live.length];
    const head = lists[i][ptr[i]];
    const last = picked.length > 0 ? artistOf(picked[picked.length - 1]) : null;
    if (artistOf(head) === last) {
      const free = live.some((j) => artistOf(lists[j][ptr[j]]) !== last);
      if (!free) break;
      continue; // the head waits; another pool gets this slot
    }
    picked.push(head);
    ptr[i]++;
  }
  return picked;
}

let inflight: Promise<RadioDef[]> | null = null;

/**
 * Rebuilds the Home radios when they are missing or stale, and otherwise
 * hands back what is saved (the cheap path: Home asks on every focus).
 *
 * Concurrent callers share one build, and the icons are generated after the
 * index is written so the section can paint the collages immediately and
 * swap in the files as they land.
 */
export function refreshRadios(opts: { force?: boolean } = {}): Promise<RadioDef[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    const store = useRadios.getState();
    await store.hydrate();
    if (!opts.force && !radiosStale(useRadios.getState().defs)) {
      return useRadios.getState().defs;
    }
    const seeds = await pickSeeds(RADIO_SEEDS);
    const defs = (await Promise.all(seeds.map(buildRadioDef))).filter(
      (d): d is RadioDef => d !== null,
    );
    // Each def gets its snapshot of tracks before the index is written: the
    // screen can then be full on the very first frame, with the fresh list
    // asked for in the background when the snapshot has gone stale.
    await Promise.all(
      defs.map(async (d) => {
        d.tracks = await radioTracks(d).catch(() => [] as Song[]);
      }),
    );
    await useRadios.getState().setDefs(defs);
    void ensureRadioIcons(defs);
    return useRadios.getState().defs;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
