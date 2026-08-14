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
