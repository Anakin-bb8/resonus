/**
 * Lyrics for the current song, as a query.
 *
 * Where they come from is not decided here: `getSongLyrics` in the data layer
 * chooses between the file on the phone, the server and the online providers, the same way
 * every other query chooses. What is left here is what React Query needs — a
 * key, when it is worth asking at all, and warming it in advance.
 *
 * `prefetchLyrics` warms the query when each song starts playing, so the lyrics
 * card appears instantly when opening the player.
 */
import { useQuery } from '@tanstack/react-query';

import { getSongLyrics } from '@/api/data';
import { type OnlineProviders } from '@/lib/localLyrics';
import { type Song, type SubsonicAuth } from '@/api/backend';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { type LyricsProvider, type LyricsSource, useSettings } from '@/store/settings';

/** The providers turned on, in the order they were sorted. */
function enabledProviders(list: LyricsProvider[]): OnlineProviders {
  return list.filter((p) => p.enabled).map((p) => p.key);
}

function lyricsQueryOptions(song: Song, source: LyricsSource, providers: OnlineProviders) {
  return {
    // The source and the providers go in the key: changing them triggers a retry.
    queryKey: ['lyrics', song.id, source, providers.join(',')] as const,
    // A song's lyrics don't change: don't re-fetch for the entire session.
    staleTime: Infinity,
    queryFn: () => getSongLyrics(song, source, providers),
  };
}

/** Does it make sense to fetch lyrics for this song in the current state? */
function canFetch(song: Song | undefined, auth: SubsonicAuth | null): song is Song {
  return !!song && !song.url && (!!song.localUri || !!auth);
}

export function useLyrics(song?: Song) {
  const auth = useAuthStore((s) => s.auth);
  const source = useSettings((s) => s.lyricsSource);
  const providers = useSettings((s) => s.lyricsProviders);
  const enabled = canFetch(song, auth);
  return useQuery({
    ...lyricsQueryOptions(song ?? ({ id: '' } as Song), source, enabledProviders(providers)),
    enabled,
  });
}

/** Prefetches the lyrics in the background (when the song starts playing). */
export function prefetchLyrics(song: Song | undefined): void {
  const auth = useAuthStore.getState().auth;
  if (!canFetch(song, auth)) return;
  const { lyricsSource, lyricsProviders } = useSettings.getState();
  void queryClient.prefetchQuery(
    lyricsQueryOptions(song, lyricsSource, enabledProviders(lyricsProviders)),
  );
}
