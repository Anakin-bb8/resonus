/** Square cover art with placeholder when no image. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native';

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

/**
 * Covers still waiting to draw the picture they were last given, so they can be
 * told to ask again when the app comes back.
 *
 * A load started while the app is away does not finish there: the image loader
 * is tied to the activity and holds its requests until it is on screen again.
 * That on its own would be harmless —the request would run on the way back—
 * except that the view has already written down which source it is loading, so
 * nothing on the way back looks like a change to it, and it goes on showing the
 * last picture it managed to draw. Playing a playlist with the player open and
 * the phone in a pocket, that is a cover from some song several tracks ago,
 * under the right title, until something makes the view load again.
 *
 * `reloadAsync` is that something, and it is the only thing that is: it asks
 * for the same source the view believes it already has, which a re-render by
 * itself will not do. One subscription for all of them, since a list on screen
 * is thirty of these and the answer to the question is the same for every one.
 */
const waiting = new Set<() => void>();
AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  for (const askAgain of [...waiting]) askAgain();
});

/**
 * Ties one `expo-image` view to the above: give it the view's `ref`, put the
 * `onDisplay` it hands back on the same view, and it will ask again for
 * anything it was given while the app was away and never got to draw.
 *
 * Exported because the player's blurred backdrop is an `Image` of its own,
 * outside this component and deliberately so (it keeps the previous artwork up
 * while the next one decodes, which is what stops a black frame between
 * songs), and it goes stale by exactly the same route.
 */
export function useRedrawOnReturn(
  ref: RefObject<Image | null>,
  shown: string | undefined,
): { nonce: number; onDisplay: () => void } {
  // Which picture the view has actually drawn, which is not the same question
  // as which one it was asked for.
  const drawn = useRef<string | undefined>(undefined);
  /**
   * Whether this view was handed a different picture while nobody was looking.
   *
   * Asking only when the view never reported drawing was not enough, and the
   * report is why: the covers here are files on the phone, so the loader
   * answers out there without a network and says it drew — and the screen still
   * comes back showing the picture before it. So what decides is not what the
   * view claims, it is whether the question changed while the app was away.
   * That is true of the player's cover and of nothing else on screen: a list
   * does not scroll in a pocket.
   */
  const changedWhileAway = useRef(false);
  useEffect(() => {
    if (AppState.currentState !== 'active') changedWhileAway.current = true;
  }, [shown]);
  /**
   * Bumped to build the view again: a fresh one remembers nothing — no source
   * it believes it has already loaded, no picture left over from before. It is
   * what leaving the player and opening it once more does, which is the one
   * thing the report confirms comes back right.
   *
   * It is used rather than merely asking the view to load again whenever the
   * picture changed out there, and the reason is that the view's own account
   * of itself cannot be checked from here. It already said it had drawn a
   * cover it was not showing, which is how the first attempt at this went
   * wrong; deciding whether asking had worked would mean believing the same
   * claim twice. The blink it costs falls inside the system's own animation
   * for opening the app, and it is one view, once, on the way back.
   */
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const askAgain = () => {
      if (!shown) return;
      const changed = changedWhileAway.current;
      changedWhileAway.current = false;
      // Counted three ways, because "it still happens" cannot say which of
      // these ran, and they want different fixes.
      if (changed) {
        bump('cover · rebuilt on return');
        setNonce((n) => n + 1);
      } else if (drawn.current !== shown) {
        // Never drew what it was given, and the picture is still the same one:
        // asking is enough here and does not blink.
        bump('cover · asked again on return');
        void ref.current?.reloadAsync().catch(() => {});
      } else {
        bump('cover · looked fine on return');
      }
    };
    waiting.add(askAgain);
    return () => {
      waiting.delete(askAgain);
    };
  }, [ref, shown]);
  // Fired when a picture is put on screen, and only for the real source: a
  // placeholder is not an answer to the question above.
  const onDisplay = useCallback(() => {
    drawn.current = shown;
  }, [shown]);
  return { nonce, onDisplay };
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
  /**
   * What was looked up, and for which `uri`. Both halves matter: the answer on
   * its own outlives the question. This held the path alone and only wrote it
   * down on a hit, so the same instance moving to a cover that is NOT on the
   * phone — a list recycling a row, the player moving to the next song — kept
   * painting the picture resolved for the song before it. The right title over
   * somebody else's artwork, and it stayed that way until a cover that did
   * resolve came along. Keeping the question next to the answer means a stale
   * pair is simply not used, whether it lost by a miss or by still being in
   * flight.
   */
  const [cached, setCached] = useState<{ uri: string; path?: string } | undefined>(undefined);
  useEffect(() => {
    if (!uri || !uri.startsWith(CACHED_COVER)) return;
    let alive = true;
    void cachedPath(uri.slice(CACHED_COVER.length)).then((path) => {
      if (alive) setCached({ uri, path });
    });
    return () => {
      alive = false;
    };
  }, [uri]);
  const shown = cacheOnly ? (cached && cached.uri === uri ? cached.path : undefined) : uri;
  const imageRef = useRef<Image>(null);
  const redraw = useRedrawOnReturn(imageRef, shown);
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
      key={redraw.nonce}
      ref={imageRef}
      source={{ uri: shown }}
      style={[{ width: size, height: size, borderRadius }, style as StyleProp<ImageStyle>]}
      contentFit={contentFit}
      transition={transition}
      recyclingKey={shown}
      onDisplay={redraw.onDisplay}
      // expo-image defaults to 'disk', which keeps the file but not the decoded
      // image: scrolling a list back up decoded every cover again. Covers are
      // small and the same handful come round constantly, which is what a
      // memory cache is for.
      cachePolicy="memory-disk"
      onError={() => setFailed(true)}
    />
  );
}
