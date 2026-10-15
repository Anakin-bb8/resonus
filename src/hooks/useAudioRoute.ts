/**
 * The live audio route: refreshed on mount, on every native route change and
 * whenever the app comes back, since nothing fires while it was away.
 *
 * On Android 12+, a Bluetooth route without a class asks once per route for
 * the permission that names it; denied or missing, the generic Bluetooth
 * mark stays and nobody is nagged again until the route changes.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getAudioRoute, requestBluetoothPermission, subscribeAudioRoute } from '@/lib/audioRoute';
import type { AudioRoute } from '@/lib/audioRouteTypes';

export function useAudioRoute(): AudioRoute | null {
  const [route, setRoute] = useState<AudioRoute | null>(() => getAudioRoute());
  const askedFor = useRef<string | null>(null);
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
  useEffect(() => {
    // Ask in context, once per route: a Bluetooth device whose class the OS
    // withholds for want of permission.
    const key = route ? `${route.kind}:${route.name}` : null;
    if (
      key &&
      key !== askedFor.current &&
      route?.kind === 'bluetooth' &&
      !route.deviceClass &&
      route.needsPermission
    ) {
      askedFor.current = key;
      void requestBluetoothPermission().then(() => {
        setRoute(getAudioRoute());
      });
    }
  }, [route]);
  return route;
}
