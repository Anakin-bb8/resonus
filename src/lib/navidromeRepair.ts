/**
 * The one thing that decides a repair has to happen, and then makes it happen.
 *
 * Everything under it is checkable in isolation: the transform against
 * Navidrome's vectors, which strings are ids field by field, the verdict
 * against a server that never existed. This is where those meet a real profile
 * with real downloads, so it is deliberately thin. What it owns is only the
 * things that cannot be decided anywhere else:
 *
 * - **Once per profile.** The state is filed under the profile's own key, the
 *   same one the downloads and the queue use. A phone with a Navidrome and a
 *   Jellyfin account must repair one and not touch the other, and getting
 *   scope wrong here has bitten this app before (#34).
 * - **Once at a time.** The probe is reachable from the request path, so it
 *   can be asked for by several screens in the same second. The promise is
 *   shared rather than the work repeated.
 * - **Order.** The catalog first, because it is the one holding files that
 *   cannot be fetched again; the mirror and the outbox after. Each is
 *   independently idempotent, so a repair that dies halfway is retried rather
 *   than rolled back, and the second run finishes what the first started.
 */
import { getSong, type SubsonicAuth } from '@/api/subsonic';
import { remapCatalogIds, someSongIds } from '@/lib/downloadsDb';
import { remapMirrorIds } from '@/lib/mirrorDb';
import { canonicalId } from '@/lib/navidromeIds';
import { probeCandidates, probeMigration, type Verdict } from '@/lib/navidromeMigration';
import { getItem, setItem } from '@/lib/storage';
import { pathsFor as mirrorPathsFor } from '@/store/libraryMirror';
import { serverDir } from '@/store/downloads';
import { useOfflineQueue } from '@/store/offlineQueue';
import { hashKey } from '@/lib/localLibrary';
import { primaryUrl } from '@/lib/serverUrls';

/** What a profile has been found to be, once it has been looked at. */
type Mark = 'repaired' | 'not-migrated';

function markKey(auth: SubsonicAuth): string {
  return `resonus.idRepair.${hashKey(`${primaryUrl(auth)}|${auth.username}`)}`;
}

/** One in-flight look per profile, so several callers share the answer. */
const running = new Map<string, Promise<Verdict>>();

/**
 * Whether this profile has already been settled.
 *
 * "Not migrated" is remembered too, but only as a hint: a server that had not
 * migrated last week may have been upgraded since, so it does not stop a later
 * look, it only stops the app asking on every screen for the rest of a session
 * that has nothing to find.
 */
export async function repairMark(auth: SubsonicAuth): Promise<Mark | null> {
  return (await getItem(markKey(auth))) as Mark | null;
}

/**
 * Song ids worth asking the server about, taken from the catalog.
 *
 * The downloads are the right place to look and not just a convenient one:
 * they are what a repair exists to save, so a profile with none of them has
 * nothing at stake, and one with them has a supply of ids the server gave us.
 */
async function candidatesFor(auth: SubsonicAuth): Promise<string[]> {
  try {
    // A few rows, not the catalog: enough that some of them will be ids the
    // transform moves, cheap enough to ask on a profile that has nothing to
    // find, which is every profile until the day one server is upgraded.
    return probeCandidates(await someSongIds(serverDir(auth), 200));
  } catch {
    return [];
  }
}

/**
 * Looks at one profile and, if its server has migrated, repairs it.
 *
 * Returns the verdict rather than throwing on "no": every caller of this is
 * somewhere that must carry on regardless, and a probe that could not reach a
 * conclusion is the ordinary case, not a failure.
 */
export async function repairIfMigrated(auth: SubsonicAuth): Promise<Verdict> {
  const key = markKey(auth);
  const already = running.get(key);
  if (already) return already;

  const run = (async (): Promise<Verdict> => {
    if ((await repairMark(auth)) === 'repaired') return 'migrated';

    const candidates = await candidatesFor(auth);
    if (candidates.length === 0) return 'inconclusive';

    const { verdict } = await probeMigration(candidates, async (id) => {
      try {
        return (await getSong(auth, id)) !== null;
      } catch {
        // Could not ask. Not a "no": see the probe's own note on why that
        // distinction is the whole safety of this.
        return undefined;
      }
    });

    if (verdict === 'not-migrated') {
      await setItem(key, 'not-migrated').catch(() => {});
      return verdict;
    }
    if (verdict !== 'migrated') return verdict;

    // Proof in hand. The catalog first: it is the only one of the three
    // holding something that cannot simply be asked for again.
    await remapCatalogIds(serverDir(auth), canonicalId);

    // The profile being repaired, not whichever is signed in now: this can be
    // reached from a request that outlived a profile switch, and repairing one
    // account's mirror under another's name is the shape of #34.
    const mirror = mirrorPathsFor(auth);
    await remapMirrorIds(mirror.dir, mirror.profile, canonicalId).catch(() => {});

    useOfflineQueue.getState().remapIds(canonicalId);

    await setItem(key, 'repaired').catch(() => {});
    return verdict;
  })().finally(() => running.delete(key));

  running.set(key, run);
  return run;
}
