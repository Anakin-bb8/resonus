/**
 * Animated cover clips for a song from the animated-artwork endpoint, if one
 * is set and the server knows the album. Session-cached by the fetcher, so a
 * cover seen before resolves without another request.
 */
import { useEffect, useState } from 'react';

import type { Song } from '@/api/subsonic';
import {
  animatedArtworkKey,
  fetchAnimatedArtwork,
  type AnimatedArtworkUrls,
} from '@/lib/animatedArtwork';
import { useSettings } from '@/store/settings';

export function useAnimatedArtwork(song: Song | null | undefined): AnimatedArtworkUrls | null {
  const endpoint = useSettings((s) => s.animatedArtworkEndpoint);
  const customs = useSettings((s) => s.animatedArtworkUrls);
  const [urls, setUrls] = useState<AnimatedArtworkUrls | null>(null);
  const customUrl = song ? customs[animatedArtworkKey(song.artist ?? '', song.album ?? '')] : undefined;
  useEffect(() => {
    let live = true;
    setUrls(null);
    if (!endpoint || !song?.artist || !song?.album) return undefined;
    void fetchAnimatedArtwork(endpoint, song.artist, song.album, customUrl).then((out) => {
      if (live) setUrls(out);
    });
    return () => {
      live = false;
    };
    // Not the song id: the next track of the same album has the same clips,
    // and starting over for it flashed the still cover between them.
  }, [endpoint, customUrl, song?.artist, song?.album]);
  return urls;
}
