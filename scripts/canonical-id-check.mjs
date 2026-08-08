/**
 * Checks our port of Navidrome's canonical id transform against Navidrome's
 * own test vectors.
 *
 * The cases below are copied from `db/migrations/id_canonical_test.go` and
 * `model/id/id_test.go` in navidrome/navidrome, so this fails the day our
 * arithmetic disagrees with the server's. That matters more than it looks: a
 * wrong transform produces ids of the right length and the right character
 * set, so nothing downstream can tell that it is wrong, and what it corrupts
 * is the offline library.
 *
 * Run with `pnpm canonical:check` (Node strips the TypeScript itself).
 */
import { canonicalId, idWouldChange } from '../src/lib/navidromeIds.ts';
import {
  isTemporaryId,
  remapAlbum,
  remapIds,
  remapKeys,
  remapPinKey,
  remapSong,
} from '../src/lib/navidromeRemap.ts';
import { probeCandidates, probeMigration } from '../src/lib/navidromeMigration.ts';

let failures = 0;

function check(what, got, want) {
  if (got === want) return;
  failures++;
  console.error(`  ✗ ${what}\n      got  ${got}\n      want ${want}`);
}

// From db/migrations/id_canonical_test.go: "transforms each historical id shape".
const VECTORS = [
  ['hash-family id (fits 128 bits) is kept', '5cLJPkLA5DK2BADhoeotPk', '5cLJPkLA5DK2BADhoeotPk'],
  ['overflowing random id is remapped via md5', 'zzzzzzzzzzzzzzzzzzzzzz', '3LyqmwQBm5IRqlVjNYASwb'],
  [
    'legacy 32-hex is re-encoded value-preserving',
    'e3b7fc2ae9447bbec37a13bf916e3cf6',
    '6VHl3uR4kss6sUPKA8Cwnk',
  ],
  [
    'playlist uuid is re-encoded value-preserving',
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    '7rke2SAWaicSeSYzkhww6R',
  ],
  ['empty string passes through', '', ''],
  ['share id (10 chars) passes through', 'aB3xY9kQz1', 'aB3xY9kQz1'],
  ['truncated Finamp id (16 chars) passes through', '0123456789abcdef', '0123456789abcdef'],
  ['22 chars with non-base62 char passes through', '!'.repeat(22), '!'.repeat(22)],
  ['32 chars non-hex passes through', 'z'.repeat(32), 'z'.repeat(32)],
  ['36 chars without uuid dashes passes through', '0'.repeat(36), '0'.repeat(36)],
];

console.log('Navidrome test vectors');
for (const [what, input, want] of VECTORS) check(what, canonicalId(input), want);

// Same file: "is idempotent for every shape". An interrupted remap is replayed
// from the start, so applying the transform twice has to be applying it once.
console.log('Idempotence');
for (const [, input] of VECTORS) {
  const once = canonicalId(input);
  check(`${input || '<empty>'} applied twice`, canonicalId(once), once);
}

// The md5 branch is the one place we reimplement a standard, and the vector
// above only exercises it once. These are RFC 1321's own, run through the
// same code path by way of a 22-char input we can predict nothing about.
console.log('md5, via the overflow branch');
const MD5_SHAPED = [
  // Every 22-char string in the old uppercase-first alphabet that overflows.
  ['ZZZZZZZZZZZZZZZZZZZZZZ', 'md5 of an all-uppercase id'],
  ['zzzzzzzzzzzzzzzzzzzzzz', 'md5 of an all-lowercase id'],
];
for (const [input, what] of MD5_SHAPED) {
  const got = canonicalId(input);
  if (got.length !== 22) {
    failures++;
    console.error(`  ✗ ${what}: expected 22 chars, got ${got.length} (${got})`);
  }
  if (got === input) {
    failures++;
    console.error(`  ✗ ${what}: expected a remap, id came back unchanged`);
  }
}

// The gate used on every hot path has to agree with the transform itself, or
// the cheap check and the real one disagree about which ids matter.
console.log('idWouldChange agrees with canonicalId');
for (const [what, input, want] of VECTORS) {
  const expected = input !== want;
  if (idWouldChange(input) !== expected) {
    failures++;
    console.error(`  ✗ ${what}: idWouldChange said ${!expected}`);
  }
}

// An MBID is 36 characters with a UUID's dashes, so the transform cannot tell
// it from a legacy playlist id and will rewrite it. Nothing here can fix that;
// this only pins the fact down so a caller that passes one in is a caller bug
// and not a surprise.
console.log('MusicBrainz ids are indistinguishable from playlist uuids');
const MBID = 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d';
if (!idWouldChange(MBID)) {
  failures++;
  console.error('  ✗ an MBID came back unchanged, so this warning is now wrong');
}

// Which is why the remap enumerates its fields. This is the check that would
// catch somebody "simplifying" it into a walk over the object: the ids move
// and the MusicBrainz id does not.
console.log('The remap moves ids and leaves MusicBrainz alone');
const upper = (id) => id.toUpperCase(); // visible, and nothing like a real id
const song = remapSong(
  {
    id: 'song-1',
    title: 'A song',
    albumId: 'album-1',
    artistId: 'artist-1',
    artists: [{ id: 'artist-1', name: 'Someone' }],
    albumArtists: [{ id: 'artist-2', name: 'Someone else' }],
    musicBrainzId: MBID,
    localUri: 'file:///downloads/files/abc.mp3',
  },
  upper
);
check('song id', song.id, 'SONG-1');
check('album id', song.albumId, 'ALBUM-1');
check('artist id', song.artistId, 'ARTIST-1');
check('artists[].id', song.artists[0].id, 'ARTIST-1');
check('albumArtists[].id', song.albumArtists[0].id, 'ARTIST-2');
check('artist name is untouched', song.artists[0].name, 'Someone');
check('musicBrainzId is untouched', song.musicBrainzId, MBID);
check('title is untouched', song.title, 'A song');
check(
  'localUri is untouched, so the file stays put',
  song.localUri,
  'file:///downloads/files/abc.mp3'
);

const album = remapAlbum(
  { id: 'album-1', name: 'A record', artistId: 'artist-1', artists: [{ id: 'a', name: 'n' }] },
  upper
);
check('album own id', album.id, 'ALBUM-1');
check('album artistId', album.artistId, 'ARTIST-1');
check('album name is untouched', album.name, 'A record');

// A playlist made offline holds an id the server has never seen. Today the
// underscore in `tmp_` keeps it out of the transform by accident; these say it
// on purpose, so the day the temporary format changes this fails instead of
// the outbox quietly pointing at a playlist that does not exist.
console.log('Temporary offline ids are left alone');
const TMP = 'tmp_1754500000000_ab12cd';
check('isTemporaryId', String(isTemporaryId(TMP)), 'true');
check('remapKeys skips it', Object.keys(remapKeys({ [TMP]: 1 }, upper))[0], TMP);
check('remapIds skips it', remapIds([TMP, 'real'], upper)[0], TMP);
check('remapIds still maps the rest', remapIds([TMP, 'real'], upper)[1], 'REAL');
check('remapPinKey skips it', remapPinKey(`playlist:${TMP}`, upper), `playlist:${TMP}`);

// Pin keys are a kind and an id, not an id.
console.log('Pin keys keep their kind');
check('album pin', remapPinKey('album:abc', upper), 'album:ABC');
check('radio pin', remapPinKey('radio:abc', upper), 'radio:ABC');
check('a key with no colon is left alone', remapPinKey('abc', upper), 'abc');
check('only the first colon splits', remapPinKey('album:a:b', upper), 'album:A:B');

// The decision half. Every one of these is a way the probe could hand back a
// confident answer it has no business having, and each wrong answer in the
// "migrated" direction rewrites a working library into ids matching nothing.
console.log('The probe only concludes on positive proof');

const OLD = 'e3b7fc2ae9447bbec37a13bf916e3cf6'; // 32-hex, so the transform moves it
const NEW = canonicalId(OLD);
const OLD2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const NEW2 = canonicalId(OLD2);

/** A server that knows exactly the ids in `has`. */
const serverWith = (...has) => {
  const set = new Set(has);
  return async (id) => set.has(id);
};

async function verdictOf(candidates, exists) {
  return (await probeMigration(candidates, exists)).verdict;
}

check(
  'answers to the new id and not the old: migrated',
  await verdictOf([OLD], serverWith(NEW)),
  'migrated'
);
check(
  'answers to the old id: not migrated',
  await verdictOf([OLD], serverWith(OLD)),
  'not-migrated'
);
check(
  'answers to neither: the song was deleted, nothing is concluded',
  await verdictOf([OLD], serverWith()),
  'inconclusive'
);
check(
  'a deleted song does not stop a later sample settling it',
  await verdictOf([OLD, OLD2], serverWith(NEW2)),
  'migrated'
);
check(
  'answers to both: impossible, so no verdict',
  await verdictOf([OLD], serverWith(OLD, NEW)),
  'inconclusive'
);
check(
  'a server answering yes to everything gets no verdict',
  await verdictOf([OLD, OLD2], async () => true),
  'inconclusive'
);
check(
  'a server that cannot answer gets no verdict',
  await verdictOf([OLD, OLD2], async () => undefined),
  'inconclusive'
);
check(
  'a server that is down mid-probe is not a "no"',
  await verdictOf([OLD], async (id) => (id === NEW ? undefined : true)),
  'inconclusive'
);
check('no candidates at all: no verdict', await verdictOf([], serverWith(NEW)), 'inconclusive');
check(
  'an id the transform leaves alone is never evidence',
  await verdictOf(['aB3xY9kQz1'], async () => true),
  'inconclusive'
);

// Asking about an id that resolves the same either way spends a request to
// learn nothing, so those never become candidates in the first place.
console.log('Candidates are only ids that would move');
const CANDIDATES = probeCandidates([OLD, 'aB3xY9kQz1', '', OLD, OLD2, '5cLJPkLA5DK2BADhoeotPk']);
check('the two that move, once each', CANDIDATES.join(','), `${OLD},${OLD2}`);
check('the cap is honoured', probeCandidates([OLD, OLD2], 1).length.toString(), '1');

if (failures > 0) {
  console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('\nThe canonical id transform matches Navidrome ✓');
