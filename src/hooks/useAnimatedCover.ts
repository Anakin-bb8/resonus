/**
 * Detects whether a cover art is animated (GIF, animated WebP, APNG) at
 * runtime using expo-image's onLoad callback, which reports `isAnimated`
 * from the native decoder.
 *
 * The result is cached per URI so the detection only runs once per unique
 * cover. When the URI changes, the state resets immediately so a
 * transition from animated → static (or vice versa) is reflected right
 * away.
 */
import { useEffect, useRef, useState } from 'react';

export function useAnimatedCover(uri?: string) {
  const [isAnimated, setIsAnimated] = useState(false);
  const cache = useRef(new Map<string, boolean>());

  // Reset immediately when the cover URI changes: a new song means the
  // previous detection no longer applies. `onCoverLoad` will set the
  // correct value once the new image decodes.
  useEffect(() => {
    if (!uri) {
      setIsAnimated(false);
      return;
    }
    const cached = cache.current.get(uri);
    setIsAnimated(cached ?? false);
  }, [uri]);

  const onCoverLoad = (animated: boolean) => {
    if (!uri) return;
    cache.current.set(uri, animated);
    setIsAnimated(animated);
  };

  return { isAnimated, onCoverLoad };
}
