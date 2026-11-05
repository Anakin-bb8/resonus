/**
 * The live output of the phone: read on mount, on every native route change
 * and whenever the app comes back, since a change while it was away may
 * never have reached it.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getAudioRoute, subscribeAudioRoute } from '@/lib/audioRoute';
import { sameRoute, type AudioRoute } from '@/lib/audioRouteTypes';

export function useAudioRoute(): AudioRoute | null {
  const [route, setRoute] = useState(getAudioRoute);
  useEffect(() => {
    const update = (next: AudioRoute | null) =>
      setRoute((prev) => (sameRoute(prev, next) ? prev : next));
    update(getAudioRoute());
    const unsubscribe = subscribeAudioRoute(update);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') update(getAudioRoute());
    });
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, []);
  return route;
}
