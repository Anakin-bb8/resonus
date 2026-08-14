/**
 * Sorting an artist's records into the kinds of thing they are (#138).
 *
 * A discography of forty entries where the albums, the singles and the live
 * records are one undivided row is a list you have to read rather than look
 * at. Servers do know the difference: MusicBrainz files carry a `RELEASETYPE`
 * tag and OpenSubsonic hands it over as `releaseTypes`, which arrives with the
 * albums the artist screen already asks for. Nothing extra is fetched here.
 *
 * What it is NOT is a guess about the records themselves. Splitting them by
 * track count, or by anything else we could measure here, would put them in
 * the wrong heap with nothing to explain it: a three track EP and a three
 * track single are the same shape and only the tag knows which is which. A
 * record that says nothing is taken for an album, which is not the same thing
 * — it is the value MusicBrainz itself defaults to, and it is what the client
 * this was compared against does.
 *
 * Every type MusicBrainz defines has a shelf here, primary and secondary
 * alike. It did not start that way: everything past live and compilation went
 * to Other, on the grounds that a row of one record repeated down the screen
 * is worse than a row called Other. What makes the whole set affordable is
 * that empty shelves are never drawn (see `groupArtistAlbums`), so nobody sees
 * a heading for a kind of record their library does not have — an artist with
 * one demo and one remix album gets those two rows and no others, and the tag
 * is the only thing that can put a record on either.
 */
import { type Album } from '@/api/subsonic';

/**
 * The shelves, in the order they are shown.
 *
 * Records first and in the order a discography is usually read, then the ones
 * that are a record of something else (a broadcast, a reading, an interview),
 * and Other last because it is where the unplaceable goes.
 */
export const RELEASE_GROUPS = [
  'album',
  'ep',
  'single',
  'live',
  'compilation',
  'soundtrack',
  'remix',
  'djmix',
  'mixtape',
  'demo',
  'broadcast',
  'spokenword',
  'interview',
  'audiobook',
  'audiodrama',
  'fieldrecording',
  'other',
] as const;

export type ReleaseGroup = (typeof RELEASE_GROUPS)[number];

/** Heading for each, as a translation key. */
export const RELEASE_GROUP_TITLE: Record<ReleaseGroup, string> = {
  album: 'Albums',
  ep: 'EPs',
  single: 'Singles',
  live: 'Live',
  compilation: 'Compilations',
  soundtrack: 'Soundtracks',
  remix: 'Remixes',
  djmix: 'DJ-mixes',
  mixtape: 'Mixtapes',
  demo: 'Demos',
  broadcast: 'Broadcasts',
  spokenword: 'Spoken word',
  interview: 'Interviews',
  audiobook: 'Audiobooks',
  audiodrama: 'Audio dramas',
  fieldrecording: 'Field recordings',
  other: 'Other',
};

/**
 * The tag as written, down to what can be compared.
 *
 * MusicBrainz spells four of these with something in the middle — `DJ-mix`,
 * `Mixtape/Street`, `Audio drama`, `Field recording` — and a tag travels
 * through a tagger, a file format and a server before it gets here, any of
 * which may have picked a different one. Dropping everything that is not a
 * letter or a digit makes the spelling stop mattering, and none of the types
 * collide once it is gone.
 */
function token(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Which shelf wins, tried in this order.
 *
 * A record carries one primary type and as many secondary ones as apply —
 * MusicBrainz asks for every one that does — so a live compilation is
 * `["album", "compilation", "live"]` and something has to break the tie. The
 * rule is that the secondary types come first, because they are the ones that
 * say what the record IS to somebody reading a discography: the studio albums
 * belong under Albums without a live record among them.
 *
 * Among the secondary ones, the more particular claim wins. The spoken ones
 * lead because a book read aloud is not filed with music at all whatever else
 * it says. Then `mixtape` over `djmix` and `djmix` over `compilation`, which
 * is MusicBrainz's own reading: it separates mixtapes from commercial DJ mixes
 * and says those are usually compilations too. `live` stays directly above
 * `compilation`, where it has always been, so nothing that used to be on one
 * of those two moves unless it carries a more particular tag than both.
 */
const SHELF_ORDER: { key: ReleaseGroup; tags: string[] }[] = [
  { key: 'audiobook', tags: ['audiobook'] },
  { key: 'audiodrama', tags: ['audiodrama'] },
  { key: 'interview', tags: ['interview'] },
  { key: 'spokenword', tags: ['spokenword'] },
  { key: 'fieldrecording', tags: ['fieldrecording'] },
  { key: 'soundtrack', tags: ['soundtrack'] },
  { key: 'mixtape', tags: ['mixtapestreet', 'mixtape'] },
  { key: 'djmix', tags: ['djmix'] },
  { key: 'remix', tags: ['remix'] },
  { key: 'demo', tags: ['demo'] },
  { key: 'live', tags: ['live'] },
  { key: 'compilation', tags: ['compilation'] },
  // The primary types, which only get a look in once nothing above has
  // claimed the record.
  { key: 'ep', tags: ['ep'] },
  { key: 'single', tags: ['single'] },
  { key: 'broadcast', tags: ['broadcast'] },
  { key: 'album', tags: ['album'] },
];

/**
 * Whether the library says anything at all about what this record is.
 *
 * The difference between a record tagged `album` and one tagged nothing, which
 * `releaseGroupOf` deliberately loses: both are albums to it. It matters once,
 * in `groupArtistAlbums`, to tell a one-shelf discography the tags asked for
 * from a one-shelf discography that is only the default answer repeated.
 */
function isTyped(album: Album): boolean {
  return album.isCompilation === true || (album.releaseTypes ?? []).some((t) => token(t) !== '');
}

/**
 * Which shelf a record belongs on. Every record lands on one.
 *
 * A record that says nothing is an album. This started out refusing to sort a
 * discography where anything was untagged, so as not to drop it out of every
 * shelf — but one untagged record in forty then undid the whole split, which
 * is what half-tagged libraries actually look like. Calling it an album loses
 * nothing, is the type MusicBrainz defaults to, and is right far more often
 * than not.
 */
export function releaseGroupOf(album: Album): ReleaseGroup {
  const types = new Set((album.releaseTypes ?? []).map(token).filter(Boolean));
  // OpenSubsonic's own flag says exactly what the secondary type says and does
  // not need the tag, so a server that only sends this still gets its
  // compilations out of the way. Read as the tag rather than ahead of it: it
  // used to be answered first, which meant a live compilation went to Live when
  // it was tagged and to Compilations when it was flagged, for the same record.
  if (album.isCompilation) types.add('compilation');
  for (const shelf of SHELF_ORDER) {
    if (shelf.tags.some((tag) => types.has(tag))) return shelf.key;
  }
  return types.size > 0 ? 'other' : 'album';
}

/**
 * The artist's records by shelf, empty shelves left out and in the order
 * above.
 *
 * One shelf is still a shelf, and it says something the count of records does
 * not: an artist who only ever released soundtracks has a discography of
 * soundtracks, and that is worth reading off the heading rather than having to
 * open the records to find out. So a single shelf keeps its name, as long as
 * the tags are what put every record on it.
 *
 * An empty answer means there was nothing to divide, and it now takes all of
 * the records saying nothing about themselves. That is what a library with no
 * tags comes to, and what every server that does not send the field comes to:
 * they all land under `album` by default, and naming that heap "Albums" would
 * be a heading that claims something nothing in the library said. Half-tagged
 * comes here too, because the untagged records are in that same heap and the
 * heading would be speaking for them as well. The caller shows its single
 * undivided discography instead.
 */
export function groupArtistAlbums(albums: Album[]): { key: ReleaseGroup; albums: Album[] }[] {
  const byGroup = new Map<ReleaseGroup, Album[]>();
  let typed = 0;
  for (const album of albums) {
    if (isTyped(album)) typed++;
    const group = releaseGroupOf(album);
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(album);
    else byGroup.set(group, [album]);
  }
  if (byGroup.size === 0) return [];
  if (byGroup.size === 1 && typed < albums.length) return [];
  return RELEASE_GROUPS.filter((key) => byGroup.has(key)).map((key) => ({
    key,
    albums: byGroup.get(key)!,
  }));
}
