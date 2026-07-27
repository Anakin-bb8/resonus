/**
 * Builds the Android Auto browse tree from the data layer (online Subsonic
 * or offline local, interchangeably) and resolves what to play when the car
 * taps an item.
 *
 * The tree is a flat parentId → children map pushed in full to the native
 * module (`setNodes`), because the native service doesn't fetch: it reads
 * from the cached tree. That's why we prefetch each album/playlist's tracks.
 *
 * Adapted from the wavio pattern (github.com/Joel-Mercier/wavio, MIT).
 */
import * as data from '@/api/data';
import { type Album, type Artist, type Song } from '@/api/subsonic';
import { tg } from '@/i18n';
import { queryClient } from '@/lib/query';
import { usePlayerStore } from '@/store/player';
import { type CarNode, type CarTree } from './carAuto';

const ROOT = 'root';
const HOME_SIZE = 15;

/** An album's tracklist, shared with the album screen's own query rather than
 *  fetched a second time for the car. */
function albumDetail(id: string): Promise<{ songs: Song[] }> {
  return queryClient.fetchQuery({ queryKey: ['album', id], queryFn: () => data.getAlbum(id) });
}
const CONCURRENCY = 4;
/**
 * Ceilings for what gets fetched ahead of a car that may never be plugged in.
 * Everything above them still appears in the browse tree; what it doesn't have
 * yet is the list of songs inside, which arrives on the next rebuild.
 */
const MAX_PREFETCH_ALBUMS = 40;
const MAX_PREFETCH_ARTISTS = 15;
const MAX_ARTIST_ALBUMS = 5;

// ── Snapshot to resolve taps without refetching data ─────────────────────────
const songById = new Map<string, Song>();
/** parentId → track mediaIds (in order) to queue the collection on tap. */
const parentTracks = new Map<string, string[]>();

/** Runs `fn` over `items` with at most `n` in parallel (avoids 429). */
async function mapConcurrent<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// Track mediaId embeds its parent to know which collection to queue.
function trackMediaId(parentId: string, songId: string): string {
  return `track|${parentId}|${songId}`;
}

function art(id: string | undefined): string | undefined {
  return data.coverArtUrl(id, 300);
}

function songNode(s: Song, parentId: string): CarNode {
  songById.set(s.id, s);
  return {
    id: trackMediaId(parentId, s.id),
    title: s.title || tg('Unknown title'),
    subtitle: s.artist,
    artworkUrl: art(s.coverArt ?? s.albumId),
    playable: true,
  };
}

function albumNode(a: Album): CarNode {
  return {
    id: `album:${a.id}`,
    title: a.name,
    subtitle: a.artist,
    artworkUrl: art(a.coverArt ?? a.id),
    playable: false,
    contentStyle: 'list',
  };
}

function artistNode(a: Artist): CarNode {
  return {
    id: `artist:${a.id}`,
    title: a.name,
    artworkUrl: art(a.coverArt ?? a.id),
    playable: false,
    contentStyle: 'list',
  };
}

// Title is resolved inside buildBrowseTree (i18n already loaded), not here.
const HOME_SECTIONS: { id: string; titleKey: string; type: 'newest' | 'frequent' | 'random' }[] = [
  { id: 'home:newest', titleKey: 'Recently added', type: 'newest' },
  { id: 'home:frequent', titleKey: 'Most played', type: 'frequent' },
  { id: 'home:random', titleKey: 'Shuffle', type: 'random' },
];

/**
 * The whole browse tree, or only its lists.
 *
 * Filling it in means asking the server for the songs of every album on the
 * shelves and every favourite, plus each favourite artist's albums and their
 * songs. That was happening within a second of every launch, whether or not a
 * car was ever going to be plugged in, and it is dozens of requests before the
 * app has finished opening (#50). The lists themselves are nearly free: they
 * come from the same queries the app has already made.
 *
 * So the lists go up straight away and the songs follow later, once the app is
 * done starting. Browsing in the car reads whatever the last push left.
 */
export async function buildBrowseTree(deep = true): Promise<CarTree> {
  songById.clear();
  parentTracks.clear();
  const tree: Record<string, CarNode[]> = {};

  // Root: Home / Library tabs.
  tree[ROOT] = [
    { id: 'tab:home', title: tg('Home'), playable: false, contentStyle: 'list' },
    { id: 'tab:library', title: tg('Library'), playable: false, contentStyle: 'list' },
  ];

  const albumIds = new Set<string>();

  // Home → album sections.
  tree['tab:home'] = HOME_SECTIONS.map((s) => ({
    id: s.id,
    title: tg(s.titleKey),
    playable: false,
    contentStyle: 'grid',
  }));
  // Through the query cache, with the keys the screens use: Home asks for these
  // very lists, and the car was asking again for its own copy on every launch.
  // Whoever gets there first pays; the other reads it.
  await Promise.all(
    HOME_SECTIONS.map(async (s) => {
      const albums = await queryClient
        .fetchQuery({
          queryKey: ['albumList', s.type],
          queryFn: () => data.getAlbumList(s.type, HOME_SIZE),
        })
        .catch(() => [] as Album[]);
      tree[s.id] = albums.map(albumNode);
      albums.forEach((a) => albumIds.add(a.id));
    }),
  );

  // Library → Favorites (songs) + Starred albums + Starred artists.
  const starred = await queryClient
    .fetchQuery({ queryKey: ['starred'], queryFn: () => data.getStarred() })
    .catch(() => ({ songs: [] as Song[], albums: [] as Album[], artists: [] as Artist[] }));

  tree['tab:library'] = [
    { id: 'favorites', title: tg('Favorites'), playable: false, contentStyle: 'list' },
    { id: 'lib:albums', title: tg('Albums'), playable: false, contentStyle: 'grid' },
    { id: 'lib:artists', title: tg('Artists'), playable: false, contentStyle: 'list' },
  ];

  tree['favorites'] = starred.songs.map((s) => songNode(s, 'favorites'));
  parentTracks.set('favorites', tree['favorites'].map((n) => n.id));

  tree['lib:albums'] = starred.albums.map(albumNode);
  starred.albums.forEach((a) => albumIds.add(a.id));

  tree['lib:artists'] = starred.artists.map(artistNode);

  if (!deep) return { nodes: tree };

  // Prefetch songs for each album (to browse them in the car), up to a point.
  // Measured on a real account: fifty eight favourite artists meant six
  // hundred and forty four album requests in a single minute, plus their top
  // songs, every time the app opened. What a car needs at hand is the top of
  // each list; the rest can be empty until someone asks for it (#50).
  await mapConcurrent(Array.from(albumIds).slice(0, MAX_PREFETCH_ALBUMS), CONCURRENCY, async (id) => {
    try {
      const { songs } = await albumDetail(id);
      const parent = `album:${id}`;
      tree[parent] = songs.map((s) => songNode(s, parent));
      parentTracks.set(parent, tree[parent].map((n) => n.id));
    } catch {
      tree[`album:${id}`] = [];
    }
  });

  // Prefetch for starred artists: top songs + albums (and their tracks).
  await mapConcurrent(starred.artists.slice(0, MAX_PREFETCH_ARTISTS).map((a) => a.id), CONCURRENCY, async (id) => {
    try {
      const { artist, albums } = await data.getArtist(id);
      const top = artist.name ? await data.getTopSongs(artist.name, 10).catch(() => [] as Song[]) : [];
      const parent = `artist:${id}`;
      const children: CarNode[] = [...top.map((s) => songNode(s, parent)), ...albums.map(albumNode)];
      tree[parent] = children;
      parentTracks.set(parent, children.filter((n) => n.playable).map((n) => n.id));
      for (const a of albums.slice(0, MAX_ARTIST_ALBUMS)) {
        const ap = `album:${a.id}`;
        if (!tree[ap]) {
          try {
            const { songs } = await albumDetail(a.id);
            tree[ap] = songs.map((s) => songNode(s, ap));
            parentTracks.set(ap, tree[ap].map((n) => n.id));
          } catch {
            tree[ap] = [];
          }
        }
      }
    } catch {
      tree[`artist:${id}`] = [];
    }
  });

  return { nodes: tree };
}

// ── Playback resolution on car tap ───────────────────────────────────────────

function songIdFromTrackMediaId(mediaId: string): string {
  // format: track|<parentId>|<songId>
  return mediaId.split('|').slice(2).join('|');
}

/**
 * Handles a car tap: if it's a track within a collection, queues the whole
 * collection starting from the tapped one; if it's an album/playlist/artist/favorites,
 * plays everything.
 */
export async function handleBrowsePlay(mediaId: string, parentId?: string): Promise<void> {
  const store = usePlayerStore.getState();

  if (mediaId.startsWith('track|')) {
    const parts = mediaId.split('|');
    const parent = parts[1] || parentId;
    const songId = parts.slice(2).join('|');
    const ids = parent ? parentTracks.get(parent) : undefined;
    if (ids && ids.length > 0) {
      const songs = ids
        .map((id) => songById.get(songIdFromTrackMediaId(id)))
        .filter((s): s is Song => !!s);
      const startIndex = Math.max(0, ids.indexOf(mediaId));
      if (songs.length > 0) {
        await store.playQueue(songs, Math.min(startIndex, songs.length - 1));
        return;
      }
    }
    const single = songById.get(songId);
    if (single) await store.playQueue([single], 0);
    return;
  }

  const [prefix, ...rest] = mediaId.split(':');
  const id = rest.join(':');
  let songs: Song[] = [];
  try {
    if (prefix === 'album') songs = (await albumDetail(id)).songs;
    else if (prefix === 'playlist') songs = (await data.getPlaylist(id)).songs;
    else if (prefix === 'favorites') songs = (await data.getStarred()).songs;
    else if (prefix === 'artist') {
      const { artist } = await data.getArtist(id);
      songs = artist.name ? await data.getTopSongs(artist.name, 20) : [];
    }
  } catch {
    songs = [];
  }
  if (songs.length > 0) await store.playQueue(songs, 0);
}
