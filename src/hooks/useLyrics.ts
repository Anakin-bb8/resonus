/**
 * Lyrics for the current song.
 *
 * - Server: OpenSubsonic `songLyrics` extension (timestamped lines if the
 *   server has synced lyrics) with fallback to the classic artist+title
 *   endpoint for old servers (e.g. Ampache 6).
 * - Local/offline (songs with `localUri`): `.lrc` alongside the file and
 *   embedded USLT lyrics.
 * - In both modes LRCLIB (online) participates per the user's setting: as a
 *   fallback ('local'), as the preferred source ('online'), or never ('off').
 *
 * `prefetchLyrics` warms the query when each song starts playing, so the lyrics
 * card appears instantly when opening the player.
 */
import { useQuery } from '@tanstack/react-query';

import {
  getLyrics,
  getLyricsBySongId,
  type Song,
  type SongLyrics,
  type SubsonicAuth,
} from '@/api/backend';
import { getLocalLyrics, getOnlineLyrics } from '@/lib/localLyrics';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { type LyricsSource, useSettings } from '@/store/settings';

function lyricsQueryOptions(song: Song, auth: SubsonicAuth | null, source: LyricsSource) {
  const allowOnline = source !== 'off';
  const preferOnline = source === 'online';
  return {
    // The source goes in the key: changing it triggers a retry.
    queryKey: ['lyrics', song.id, source] as const,
    // A song's lyrics don't change: don't re-fetch for the entire session.
    staleTime: Infinity,
    queryFn: async (): Promise<SongLyrics | null> => {
      if (song.localUri) return getLocalLyrics(song, allowOnline, preferOnline);
      try {
        // 'online': try LRCLIB first (it absorbs network errors, returning null
        // when offline or not found), then the server.
        if (preferOnline) {
          const online = await getOnlineLyrics(song);
          if (online) return online;
        }
        try {
          const structured = await getLyricsBySongId(auth!, song.id);
          if (structured) return structured;
          // It answered, and it has nothing. The classic endpoint reads the
          // same place, so asking it as well was a second request per song for
          // an answer already given: seventy of them in a twenty three minute
          // session, queued in front of what the screens were waiting for
          // (#50). Only a server that rejects the modern one, which throws,
          // gets the old question.
          return allowOnline && !preferOnline ? getOnlineLyrics(song) : null;
        } catch {
          // Server without the songLyrics extension: try the classic endpoint.
        }
        const plain = await getLyrics(auth!, song.artist ?? '', song.title ?? '');
        if (plain) return { synced: false, lines: plain.split('\n').map((value) => ({ value })) };
        // Server has no lyrics: LRCLIB if allowed (and not already tried above).
        if (allowOnline && !preferOnline) return getOnlineLyrics(song);
        return null;
      } catch (e) {
        // This path is only reached without a network (with a connection, the
        // inner catch already absorbs servers without the extension). If the
        // song is downloaded, each download cached an .lrc alongside the file:
        // that one is used.
        const dl = useDownloads.getState().files[song.id];
        if (dl) return getLocalLyrics({ ...song, localUri: dl }, allowOnline, preferOnline);
        throw e;
      }
    },
  };
}

/** Does it make sense to fetch lyrics for this song in the current state? */
function canFetch(song: Song | undefined, auth: SubsonicAuth | null): song is Song {
  return !!song && !song.url && (!!song.localUri || !!auth);
}

export function useLyrics(song?: Song) {
  const auth = useAuthStore((s) => s.auth);
  const source = useSettings((s) => s.lyricsSource);
  const enabled = canFetch(song, auth);
  return useQuery({
    ...lyricsQueryOptions(song ?? ({ id: '' } as Song), auth, source),
    enabled,
  });
}

/** Prefetches the lyrics in the background (when the song starts playing). */
export function prefetchLyrics(song: Song | undefined): void {
  const auth = useAuthStore.getState().auth;
  if (!canFetch(song, auth)) return;
  const source = useSettings.getState().lyricsSource;
  void queryClient.prefetchQuery(lyricsQueryOptions(song, auth, source));
}
