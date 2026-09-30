/**
 * The songs this phone last told the server it was on (`reportState`).
 *
 * The server names the player only by client, so every Resonus reads the same
 * in `getNowPlaying`. The card on Home told this phone's own entry apart by the
 * song loaded here, and the entry outlives it: a pause left there, then the
 * queue gone or a radio or local song on, and Home offered this phone's own
 * song back as playing "on Resonus". Kept on disk, since the app being killed
 * is one of those.
 */
import { getItem, setItem } from '@/lib/storage';

const KEY = 'own_now_playing';
/** A few, not one: the reports are not awaited, so they can land out of order. */
const KEEP = 3;

let ids: string[] = [];
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  loaded ??= getItem(KEY)
    .then((raw) => {
      const saved = raw ? (JSON.parse(raw) as unknown) : [];
      // Anything reported before this read finished goes first.
      if (Array.isArray(saved)) ids = [...new Set([...ids, ...saved.map(String)])].slice(0, KEEP);
    })
    .catch(() => {});
  return loaded;
}

export function noteOwnReport(id: string): void {
  if (ids[0] === id) return;
  ids = [id, ...ids.filter((x) => x !== id)].slice(0, KEEP);
  void setItem(KEY, JSON.stringify(ids));
}

/** What this phone reported, once it has been read back. */
export async function ownReports(): Promise<ReadonlySet<string>> {
  await load();
  return new Set(ids);
}
