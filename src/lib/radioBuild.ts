/**
 * The radios on Home: which artists get one, what goes in it, and when the
 * set is rebuilt.
 *
 * A radio is a seed artist (the one in its title, "Radio di …") plus similar
 * artists mixed beside it — never a saved playlist: nothing is written to
 * the server, and the tracks are fetched again when the radio opens so the
 * list reflects the library as it is now.
 *
 * The seeds come from listening history where there is any (Last.fm and
 * ListenBrainz, Settings › Scrobbling) and from the server's own play counts
 * where there isn't, which covers a local profile and any server without
 * scrobbling. Both paths end in the same shape, so the Home section and the
 * screen below it never know which one they got.
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

import { recentArtistWeights } from './listeningHistory';

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
 * Seeds from what the scrobble services heard: the artists in the recent
 * window, most played first, matched into the library by name (both services
 * key on names, and the artist index is where the ids live).
 */
async function historySeeds(limit: number): Promise<RadioArtist[]> {
  const weights = await recentArtistWeights();
  if (weights.size === 0) return [];
  const artists = await getArtists();
  const scored = artists
    .map((a) => ({ a, w: weights.get(a.name.trim().toLowerCase()) ?? 0 }))
    .filter((x) => x.w > 0)
    .sort((x, y) => y.w - x.w);
  return scored.slice(0, limit).map(({ a }) => ({ id: a.id, name: a.name, coverArt: a.coverArt }));
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
 * The radio seeds, history first and the server's own listening filling the
 * rest. The last tier is any artists at all: six radios about artists you
 * never played beats no radios, and the section still hides itself when even
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
    take(await historySeeds(limit));
  } catch {
    // The scrobble services or the artist index didn't answer; the tiers
    // below still can.
  }
  if (out.length < limit) {
    try {
      take(await serverSeeds(limit));
    } catch {
      // Same, one tier down.
    }
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
 * The tracks of one radio, aiming at `RADIO_TARGET`: the seed's top songs
 * first, then the similar artists a song at a time in rounds, then whatever
 * the server suggests as similar to the seed's own top track, and last the
 * library's random songs.
 *
 * The per-artist caps are what keep it a radio rather than an album run —
 * two or three from each artist and on to the next, the same rule the
 * player's own radio extension works by (see `radioCandidates` in player.ts).
 */
export async function radioTracks(def: RadioDef): Promise<Song[]> {
  const picked: Song[] = [];
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  const push = (s: Song | undefined, cap: number) => {
    if (!s || picked.length >= RADIO_TARGET) return;
    if (!s.id || seen.has(s.id) || s.url) return;
    const artist = s.artistId ?? s.artist ?? '';
    const n = perArtist.get(artist) ?? 0;
    if (n >= cap) return;
    perArtist.set(artist, n + 1);
    seen.add(s.id);
    picked.push(s);
  };

  const [seedTop, similarLists] = await Promise.all([
    getTopSongs(def.seed.name, 15, def.seed.id).catch(() => [] as Song[]),
    Promise.all(
      def.similar
        .slice(0, 6)
        .map((a) => getTopSongs(a.name, 6, a.id).catch(() => [] as Song[])),
    ),
  ]);

  // The seed's own first — a radio never opens on a similar artist's track
  // before its own — then the similar artists one song at a time in rounds,
  // so the mix walks across them instead of playing each list as a block.
  for (const s of seedTop) push(s, 6);
  let round = 0;
  let added = true;
  while (picked.length < RADIO_TARGET && added && round < 8) {
    added = false;
    for (const list of similarLists) {
      if (picked.length >= RADIO_TARGET) break;
      const before = picked.length;
      push(list[round], 3);
      if (picked.length > before) added = true;
    }
    round++;
  }

  if (picked.length < RADIO_TARGET) {
    const extra = seedTop[0]
      ? await getSimilarSongs(seedTop[0].id, 30).catch(() => [] as Song[])
      : [];
    for (const s of shuffled(extra)) push(s, 2);
  }
  if (picked.length < RADIO_TARGET) {
    const random = await getRandomSongs(50).catch(() => [] as Song[]);
    for (const s of shuffled(random)) push(s, 2);
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
    await useRadios.getState().setDefs(defs);
    void ensureRadioIcons(defs);
    return useRadios.getState().defs;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
