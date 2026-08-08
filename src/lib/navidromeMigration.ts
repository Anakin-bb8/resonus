/**
 * Deciding whether a server has moved its ids underneath us.
 *
 * This is the dangerous half of the repair. The transform is checkable against
 * Navidrome's own vectors and either matches or does not; this part is a
 * judgement about somebody else's database, and getting it wrong in the
 * confident direction rewrites a working library into ids that match nothing.
 * A repair that never runs leaves the user where they already are. A repair
 * that runs when it should not is us breaking their downloads ourselves.
 *
 * So the rule, and everything here follows from it: **conclude only on
 * positive proof**. A migrated server is one that answers to an id it could
 * only know if it had migrated. An id that stopped resolving proves nothing at
 * all, because a deleted song looks exactly the same.
 *
 * The asking is a parameter. Partly so the whole decision can be checked on a
 * laptop with no server, which for code that only runs once in a library's
 * lifetime is the difference between tested and hoped for, and partly because
 * this has to stay free of the request layer: it is reached from inside it.
 */
import { canonicalId, idWouldChange } from './navidromeIds';

/**
 * Asks the server whether one song id resolves. `true` means the server
 * answered and the song is there.
 *
 * Anything that is not a clear answer, a timeout, a refused connection, a 500,
 * has to be `undefined` rather than `false`. A server that is having a bad
 * moment must never be read as a server that has migrated, and must not be
 * read as one that has not either: both of those are conclusions, and there is
 * nothing here to conclude from.
 */
export type SongExists = (id: string) => Promise<boolean | undefined>;

export type Verdict =
  /** The server answered to a canonical id. Positive proof; the repair can run. */
  | 'migrated'
  /** The server still answers to an old id. Nothing to do, and worth remembering. */
  | 'not-migrated'
  /** No sample settled it. Ask again another day; change nothing. */
  | 'inconclusive';

/**
 * Enough samples that a library where some songs have been deleted still
 * reaches a conclusion, few enough that the whole probe is a handful of small
 * requests. Each sample costs up to two.
 */
export const MAX_SAMPLES = 6;

/**
 * Ids worth asking about: the ones the transform would actually change.
 *
 * An id that maps to itself resolves whether or not the server migrated, so it
 * can never be evidence, and asking about it spends a request to learn
 * nothing. Callers pass song ids only: the probe asks about songs, so an album
 * or playlist id would come back "not found" either way.
 */
export function probeCandidates(ids: Iterable<string>, limit = MAX_SAMPLES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (out.length >= limit) break;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (idWouldChange(id)) out.push(id);
  }
  return out;
}

/**
 * The verdict for one server, from up to `MAX_SAMPLES` of its own ids.
 *
 * Per sample, the new id is asked about first, because a yes there ends the
 * whole thing. Then the old one, which can only rule the migration out. The
 * four ways one sample can go:
 *
 * - new yes, old no ....... migrated. The one conclusion worth having.
 * - new no, old yes ....... not migrated, and the song is still there to prove it.
 * - new no, old no ........ the song was deleted. Says nothing; next sample.
 * - new yes, old yes ...... impossible, so something else is going on.
 *
 * That last one is the guard worth spelling out. After the migration the old
 * id is gone, so a server claiming both is not a migrated server: it is one
 * answering yes to whatever it is handed, or a proxy serving something that is
 * not the answer. Reading that as proof would hand a confident verdict to
 * exactly the setups least able to survive being wrong, so it abandons the
 * probe outright rather than moving on to a sample that might get lucky.
 */
export async function probeMigration(
  candidates: string[],
  exists: SongExists,
): Promise<{ verdict: Verdict; samples: number }> {
  let samples = 0;
  for (const old of candidates.slice(0, MAX_SAMPLES)) {
    const fresh = canonicalId(old);
    // Nothing to learn from an id the transform leaves alone; `probeCandidates`
    // filters these out, but this is not the only caller it could ever have.
    if (fresh === old) continue;
    samples++;

    const hasNew = await exists(fresh);
    if (hasNew === undefined) continue; // no answer, not an answer of "no"

    const hasOld = await exists(old);
    if (hasOld === undefined) continue;

    if (hasNew && hasOld) return { verdict: 'inconclusive', samples };
    if (hasNew) return { verdict: 'migrated', samples };
    if (hasOld) return { verdict: 'not-migrated', samples };
    // Neither: a song that has been deleted. Try another.
  }
  return { verdict: 'inconclusive', samples };
}
