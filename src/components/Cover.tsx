/** Square cover art with placeholder when no image. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { CACHED_COVER } from '@/api/data';
import { colors, radius } from '@/theme';

interface Props {
  uri?: string;
  size: number;
  rounded?: boolean;
  /** Fade when loading/switching the image (ms). 0 for instant changes. */
  transition?: number;
  /** Placeholder icon when no image (e.g. radio). */
  placeholderIcon?: keyof typeof Ionicons.glyphMap;
  /**
   * How the artwork fills its square. Defaults to `cover` (fills and crops),
   * which is what every list, card and grid wants. The player can ask for
   * `contain` so non-square artwork is shown whole, letterboxed.
   */
  contentFit?: ImageContentFit;
  style?: StyleProp<ViewStyle | ImageStyle>;
}

export function Cover({
  uri,
  size,
  rounded,
  transition = 200,
  placeholderIcon = 'musical-notes',
  contentFit = 'cover',
  style,
}: Props) {
  // If the image fails to load (e.g. offline without cache or download), we fall
  // back to the placeholder instead of leaving a gap. Reset on `uri` change
  // because lists recycle the same instance with a different song.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  // Offline, a cover that is not downloaded arrives marked (see `CACHED_COVER`
  // in the data layer): it may be shown, but only if it is already in the image
  // cache from when it was seen online, and never fetched. This is the only
  // place that knows how to read the mark, and asking the cache is the only way
  // it can be read, so a playlist or a favourite whose cover was never seen
  // simply keeps its placeholder.
  const cacheOnly = uri?.startsWith(CACHED_COVER) ?? false;
  const [cached, setCached] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!uri || !uri.startsWith(CACHED_COVER)) {
      setCached(undefined);
      return;
    }
    let alive = true;
    void Image.getCachePathAsync(uri.slice(CACHED_COVER.length))
      .then((path) => {
        if (alive && path) setCached(path.startsWith('file://') ? path : `file://${path}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri]);
  const shown = cacheOnly ? cached : uri;
  const borderRadius = rounded ? size / 2 : radius.md;
  if (!shown || failed) {
    return (
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius,
            backgroundColor: colors.surfaceHighlight,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style as StyleProp<ViewStyle>,
        ]}
      >
        <Ionicons name={placeholderIcon} size={size * 0.4} color={colors.textMuted} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: shown }}
      style={[{ width: size, height: size, borderRadius }, style as StyleProp<ImageStyle>]}
      contentFit={contentFit}
      transition={transition}
      recyclingKey={shown}
      // expo-image defaults to 'disk', which keeps the file but not the decoded
      // image: scrolling a list back up decoded every cover again. Covers are
      // small and the same handful come round constantly, which is what a
      // memory cache is for.
      cachePolicy="memory-disk"
      onError={() => setFailed(true)}
    />
  );
}
