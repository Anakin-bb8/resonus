/**
 * The live audio route: refreshed on mount, on every native route change and
 * whenever the app comes back, since nothing fires while it was away.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getAudioRoute, subscribeAudioRoute } from '@/lib/audioRoute';
import type { AudioRoute } from '@/lib/audioRouteTypes';

export function useAudioRoute(): AudioRoute | null {
  const [route, setRoute] = useState<AudioRoute | null>(() => getAudioRoute());
  useEffect(() => {
    const unsubscribe = subscribeAudioRoute(setRoute);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setRoute(getAudioRoute());
    });
    return () => {
      unsubscribe?.();
      appStateSub.remove();
    };
  }, []);
  return route;
}
