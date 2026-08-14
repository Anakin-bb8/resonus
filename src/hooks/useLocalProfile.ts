/**
 * Is this the local profile — the phone's own music, with no account behind it?
 *
 * Not the same question as "offline", and the difference is what a screen
 * should do about it. A server account without a connection is offline: what
 * needs the server is greyed out and stays where it is, because the server
 * comes back and a setting that moves house while you are not looking sends
 * you hunting through every other screen (#114). The local profile has no
 * server to come back, so the same control is not waiting for anything: it is
 * furniture, and it goes.
 *
 * So: `offline` greys out, this one takes away.
 */
import { useAuthStore } from '@/store/auth';

export function useLocalProfile(): boolean {
  return useAuthStore((s) => s.offline && !s.auth);
}
