/**
 * Lyrics for the current song, as a query.
 *
 * Where they come from is not decided here: `getSongLyrics` in the data layer
 * chooses between the file on the phone, the server and LRCLIB, the same way
 * every other query chooses. What is left here is what React Query needs — a
 * key, when it is worth asking at all, and warming it in advance.
 *
 * `prefetchLyrics` warms the query when each song starts playing, so the lyrics
 * card appears instantly when opening the player.
 */
import { useQuery } from '@tanstack/react-query';

import { getSongLyrics } from '@/api/data';
import { type Song, type SubsonicAuth } from '@/api/backend';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { type LyricsSource, useSettings } from '@/store/settings';

function lyricsQueryOptions(song: Song, source: LyricsSource, providers: string) {
  return {
    // The source and the provider order go in the key: changing either
    // triggers a retry.
    queryKey: ['lyrics', song.id, source, providers] as const,
    // A song's lyrics don't change: don't re-fetch for the entire session.
    staleTime: Infinity,
    queryFn: () => getSongLyrics(song, source),
  };
}

/** The enabled providers as one string, for the query key above. */
function providersSig(): string {
  return useSettings
    .getState()
    .lyricsProviders.filter((p) => p.enabled)
    .map((p) => p.key)
    .join('+');
}

/** Does it make sense to fetch lyrics for this song in the current state? */
function canFetch(song: Song | undefined, auth: SubsonicAuth | null): song is Song {
  return !!song && !song.url && (!!song.localUri || !!auth);
}

export function useLyrics(song?: Song) {
  const auth = useAuthStore((s) => s.auth);
  const source = useSettings((s) => s.lyricsSource);
  const providers = useSettings((s) =>
    s.lyricsProviders
      .filter((p) => p.enabled)
      .map((p) => p.key)
      .join('+'),
  );
  const enabled = canFetch(song, auth);
  return useQuery({
    ...lyricsQueryOptions(song ?? ({ id: '' } as Song), source, providers),
    enabled,
  });
}

/** Prefetches the lyrics in the background (when the song starts playing). */
export function prefetchLyrics(song: Song | undefined): void {
  const auth = useAuthStore.getState().auth;
  if (!canFetch(song, auth)) return;
  const source = useSettings.getState().lyricsSource;
  void queryClient.prefetchQuery(lyricsQueryOptions(song, source, providersSig()));
}
