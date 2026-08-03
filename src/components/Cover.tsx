/** Square cover art with placeholder when no image. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { CACHED_COVER, COVER } from '@/api/data';
import { bump } from '@/lib/perfLog';
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

/**
 * Sizes to look for a marked cover at, and there are more of them than the app
 * asks for on purpose.
 *
 * The same picture at a different size is a different URL and so a different
 * entry in the image loader's cache. The first three are what the app asks for
 * now (see `COVER`); the rest are what older versions asked for, and the cache
 * on somebody's phone was filled by those. Dropping them from this list is what
 * made covers disappear offline after an update: the pictures were still there,
 * under names we had stopped saying.
 *
 * The size asked for is tried on its own first, and the rest only on a miss and
 * all at once, so the length of this list costs one round trip, not six.
 */
const CACHE_SIZES = [COVER.card, COVER.full, COVER.thumb, 500, 300, 100] as const;

/**
 * What each marked cover was found to be, so a lookup is done once.
 *
 * Every one of these is a call into the image loader, and a screen is thirty
 * rows: without this, a list asked a hundred and fifty times on the way in, and
 * again on the way back, and again for every row scrolling recycled. On a
 * fifteen thousand song library most of them miss, which is the expensive case.
 *
 * A hit is kept for good, since a file in the cache does not leave while the
 * app is running. A miss is kept for a minute: offline nothing new arrives, but
 * back online the mirror does save covers, and a miss remembered for ever would
 * hold a placeholder over one that is now there.
 */
const MISS_TTL = 60_000;
const memo = new Map<string, { path?: string; at: number }>();

async function cachedPath(url: string): Promise<string | undefined> {
  const seen = memo.get(url);
  if (seen && (seen.path || Date.now() - seen.at < MISS_TTL)) return seen.path;
  const sized = (n: number) => url.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, `$1${n}`);
  const look = async (candidate: string) => {
    const path = await Image.getCachePathAsync(candidate).catch(() => null);
    return path ? (path.startsWith('file://') ? path : `file://${path}`) : undefined;
  };
  // The size asked for first, on its own: that is the one that hits when the
  // cover was already seen at this size, and it costs one call. Only when it
  // misses are the other sizes worth asking for, and then all at once rather
  // than one after another, in the order that prefers scaling down to up.
  let found = await look(url);
  // Counted, because this is where the covers went missing twice already: once
  // when the sizes the app asks for changed under a cache filled by an older
  // one, and once when a picture was saved under a name the row never asks by.
  // "asked for" against "another size" against "missing" says which it is
  // without anybody having to guess from a screenshot.
  if (found) {
    bump('cover cache · asked for');
  } else {
    const others = await Promise.all(CACHE_SIZES.map((n) => look(sized(n))));
    found = others.find(Boolean);
    bump(found ? 'cover cache · another size' : 'cover cache · missing');
  }
  memo.set(url, { path: found, at: Date.now() });
  return found;
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
    void cachedPath(uri.slice(CACHED_COVER.length)).then((path) => {
      if (alive && path) setCached(path);
    });
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
        {/* The icon carries the whole placeholder: its background is the same
            grey as a Home tile or a sheet, so on those it is the icon or
            nothing, and dimmer than this it read as a picture that had failed
            rather than one that was never there. */}
        <Ionicons name={placeholderIcon} size={size * 0.4} color={colors.textSecondary} />
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
