import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min: a library changes little
      retry: 1,
    },
  },
});

/**
 * Empties the cache on the way from one profile to another.
 *
 * No query key here carries the account, so everything in the cache is an
 * answer from whoever was signed in when it was asked. Clearing it is not
 * enough on its own: a request already on its way resolves after the clearing
 * and writes the profile that was left into the cache of the one just entered,
 * which is a playlist list nobody on this account owns. So they are cancelled
 * first.
 *
 * Call it immediately before flipping the session, with nothing awaited in
 * between: both halves are synchronous, so no render can happen between them
 * and no screen can draw the wrong profile.
 */
export function clearProfileCache(): void {
  void queryClient.cancelQueries();
  queryClient.clear();
}

/**
 * Everything that shows a podcast: the open show screens (`['podcast', id]`),
 * the quick grid's covers (`['podcast','covers',…]`), the list (`podcastChannels`)
 * and Home's shelf (`podcastRecentEpisodes`). Read after a show is added,
 * removed or refreshed, so no surface keeps an answer that the read just
 * changed. The favorite lists carry what a refresh learned about a show too —
 * its episode count and its feed error — so they are invalidated here as well.
 */
export function invalidatePodcastCaches(): void {
  queryClient.invalidateQueries({ queryKey: ['podcast'] });
  queryClient.invalidateQueries({ queryKey: ['podcastChannels'] });
  queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] });
  queryClient.invalidateQueries({ queryKey: ['podcastFavoriteChannels'] });
  queryClient.invalidateQueries({ queryKey: ['podcastFavoriteEpisodes'] });
}

/** The hearts and the two favorite lists, after a podcast heart goes on or off. */
export function invalidatePodcastFavorites(): void {
  queryClient.invalidateQueries({ queryKey: ['podcastFavorites'] });
  queryClient.invalidateQueries({ queryKey: ['podcastFavoriteChannels'] });
  queryClient.invalidateQueries({ queryKey: ['podcastFavoriteEpisodes'] });
}
