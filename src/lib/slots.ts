/**
 * At most `size` at once; the rest wait their turn, first come first served.
 * A freed slot is handed straight to the next in line, so a newcomer can never
 * cut in between the release and the waiter waking up.
 */
export function createSlots(size: number) {
  let busy = 0;
  const waiting: (() => void)[] = [];
  return {
    take(): Promise<void> {
      if (busy < size) {
        busy++;
        return Promise.resolve();
      }
      return new Promise((resolve) => waiting.push(resolve));
    },
    release(): void {
      const next = waiting.shift();
      if (next) next();
      else busy--;
    },
  };
}
