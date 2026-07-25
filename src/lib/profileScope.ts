/**
 * Guard for stores partitioned by profile (`resonus.<store>.<profile hash>`).
 *
 * Two things go wrong when the storage key depends on the active profile and
 * reading it is asynchronous:
 *
 * - Hydrations overlap. On startup everything hydrates once with no session yet
 *   (`default` scope) and again when the saved session comes back, so two reads
 *   are in flight against different keys and the slower one wins — leaving
 *   another profile's data (or factory values) in memory.
 * - Writes resolve the key when they happen, not when the data was loaded. Any
 *   write in flight while the profile changes lands on the NEW profile.
 *
 * Both end the same way: data silently replaced by another profile's, and made
 * permanent by the next write. The guard ties what is in memory to the key it
 * came from — stale reads are discarded, and writes only reach the key that
 * owns the state.
 */
export function profileScopeGuard() {
  let token = 0;
  let loadedKey: string | null = null;
  return {
    /** Call before reading storage; pass the result to `accept`. */
    start(): number {
      return ++token;
    },
    /**
     * Is this read still the current one? If so it becomes the owner of the
     * state; if not, the caller must discard what it read without touching
     * the store.
     */
    accept(startToken: number, key: string): boolean {
      if (startToken !== token) return false;
      loadedKey = key;
      return true;
    },
    /** Did the state in memory come from `key` (so it can be written back)? */
    owns(key: string): boolean {
      return loadedKey === key;
    },
  };
}
