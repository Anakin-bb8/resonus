/**
 * Can the active profile share links? Only Subsonic servers (Jellyfin has no
 * such endpoint), online, and with the `shareRole` the admin grants — Navidrome
 * ties it to `ND_ENABLESHARING`, which is off by default.
 *
 * Cached per profile and never refetched on its own: a role doesn't change
 * while the app is open, and this only exists to decide whether to draw a
 * button. Which is only safe because a failed lookup is a failure and not a
 * `false`: cached forever, one bad moment used to take the share button away
 * for the rest of the session (see `hasShareRole`).
 */
import { useQuery } from '@tanstack/react-query';

import { hasShareRole } from '@/api/subsonic';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from '@/store/auth';

export function useCanShare(): boolean {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const supported = !!auth && !offline && auth.serverType !== 'jellyfin';
  const { data } = useQuery({
    queryKey: ['shareRole', auth?.username, auth ? primaryUrl(auth) : null],
    queryFn: () => hasShareRole(auth!),
    enabled: supported,
    staleTime: Infinity,
  });
  return supported && data === true;
}
