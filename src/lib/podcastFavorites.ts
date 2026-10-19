/**
 * The hearted podcast ids, read once per screen. Every surface that lights a
 * podcast heart asks for the same SQLite set under the same key, so one hook
 * holds the query and the empty stand-in. `enabled` lets a surface that is not
 * looking at a podcast episode skip the read; a disabled read hands back the
 * same empty set, so a caller that guards on the episode never sees a gap.
 */
import { useQuery } from '@tanstack/react-query';

import { favoriteIds, NO_FAVORITES } from '@/api/podcasts';

export function usePodcastFavoriteIds(enabled = true): Set<string> {
  const q = useQuery({
    queryKey: ['podcastFavorites'],
    queryFn: favoriteIds,
    enabled,
  });
  return q.data ?? NO_FAVORITES;
}
