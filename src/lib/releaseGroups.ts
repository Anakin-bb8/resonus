/**
 * Sorting an artist's records into the kinds of thing they are (#138).
 *
 * A discography of forty entries where the albums, the singles and the live
 * records are one undivided row is a list you have to read rather than look
 * at. Servers do know the difference: MusicBrainz files carry a `RELEASETYPE`
 * tag and OpenSubsonic hands it over as `releaseTypes`, which arrives with the
 * albums the artist screen already asks for. Nothing extra is fetched here.
 *
 * What it is NOT is a guess. A library nobody tagged, and every server that
 * does not send the field, come back with no groups at all, and the screen
 * shows the one discography it always did. Splitting records by track count,
 * or by anything else we could measure ourselves, would put them in the wrong
 * heap with nothing to explain it: a three track EP and a three track single
 * are the same shape and only the tag knows which is which.
 */
import { type Album } from '@/api/subsonic';

/** The shelves, in the order they are shown. */
export const RELEASE_GROUPS = ['album', 'ep', 'single', 'live', 'compilation', 'other'] as const;

export type ReleaseGroup = (typeof RELEASE_GROUPS)[number];

/** Heading for each, as a translation key. */
export const RELEASE_GROUP_TITLE: Record<ReleaseGroup, string> = {
  album: 'Albums',
  ep: 'EPs',
  single: 'Singles',
  live: 'Live',
  compilation: 'Compilations',
  other: 'Other',
};

/**
 * Which shelf a record belongs on.
 *
 * Secondary types win over the primary one, and that is the one real decision
 * in here: a live album is tagged `["album", "live"]`, and somebody looking
 * through a discography wants the studio records under Albums, with the live
 * ones somewhere of their own. The same for a compilation.
 *
 * Everything past those two — remixes, soundtracks, demos, dj-mixes, radio
 * broadcasts — goes to Other rather than earning a shelf each. A row of one
 * record repeated eight times down the screen is not a better answer than a
 * row called Other, and these are rare enough that most artists would get
 * exactly that.
 */
export function releaseGroupOf(album: Album): ReleaseGroup | undefined {
  const types = (album.releaseTypes ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  // Says the same thing as a secondary type and does not need the tag, so a
  // server that only sends this still gets its compilations out of the way.
  if (album.isCompilation) return 'compilation';
  if (types.length === 0) return undefined;
  if (types.includes('live')) return 'live';
  if (types.includes('compilation')) return 'compilation';
  if (types.includes('ep')) return 'ep';
  if (types.includes('single')) return 'single';
  if (types.includes('album')) return 'album';
  return 'other';
}

/**
 * The artist's records by shelf, empty shelves left out and in the order
 * above.
 *
 * An empty answer means there is nothing to go on — no server field, or no
 * tags — and the caller shows its single discography instead. So does a split
 * that comes out as one shelf: dividing a discography into a heap called
 * "Albums" is a heading where there used to be none and nothing else.
 */
export function groupArtistAlbums(albums: Album[]): { key: ReleaseGroup; albums: Album[] }[] {
  const byGroup = new Map<ReleaseGroup, Album[]>();
  let untagged = false;
  for (const album of albums) {
    const group = releaseGroupOf(album);
    // A record nobody tagged does not go to Other, where it would look
    // deliberate. Its presence is enough to call the whole split off: a partly
    // tagged library would otherwise drop it out of every shelf, and losing
    // records is worse than not sorting them.
    if (!group) {
      untagged = true;
      break;
    }
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(album);
    else byGroup.set(group, [album]);
  }
  if (untagged || byGroup.size < 2) return [];
  return RELEASE_GROUPS.filter((key) => byGroup.has(key)).map((key) => ({
    key,
    albums: byGroup.get(key)!,
  }));
}
