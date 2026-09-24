/**
 * The card at the top of Home that picks up what is playing somewhere else:
 * another app on the computer, Resonus on another phone. It shows what the
 * server says that player is on (`getNowPlaying`) and plays it here, from
 * where it had got to.
 *
 * Nothing here can stop the other player: Subsonic has no remote control. So
 * the card only offers to carry on, and says where the music was.
 */
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getNowPlaying, getPlayQueue } from '@/api/backend';
import { COVER, songCoverUrl } from '@/api/data';
import { CLIENT_NAME, type NowPlayingEntry } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import Icon from '@/components/Icon';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

const COVER_SIZE = 84;
/** How often Home asks while it is on screen. */
const POLL_MS = 20_000;
/** Without the playback report a server says nothing of pauses; past this an
 *  entry is taken to be a player that stopped. */
const STALE_MINUTES = 10;

/**
 * The entry worth offering: this user's, not this phone's own report, and
 * playing before paused, most recent first.
 */
function pickEntry(
  entries: NowPlayingEntry[],
  username: string,
  ownSongId: string | undefined,
  ownPlaying: boolean,
): NowPlayingEntry | null {
  const candidates = entries.filter((e) => {
    if (e.username !== username || e.song.url) return false;
    if (e.state === 'stopped') return false;
    if (!e.state && e.minutesAgo > STALE_MINUTES) return false;
    // This phone's own report of the song it has loaded.
    if (e.playerName === CLIENT_NAME && e.song.id === ownSongId) return false;
    // Already carried on here.
    if (ownPlaying && e.song.id === ownSongId) return false;
    return true;
  });
  const rank = (e: NowPlayingEntry) => (e.state === 'paused' ? 1 : 0);
  candidates.sort((a, b) => rank(a) - rank(b) || a.minutesAgo - b.minutesAgo);
  return candidates[0] ?? null;
}

/** Carries on here with what the other player is on, where it had got to. */
async function playHere(entry: NowPlayingEntry, fetchedAt: number) {
  const store = usePlayerStore.getState;
  const auth = useAuthStore.getState().auth;
  const elapsed = entry.state === 'paused' ? 0 : Date.now() - fetchedAt;
  const positionSec = Math.max(0, ((entry.positionMs ?? 0) + elapsed) / 1000);
  // The whole queue when the server holds that player's and it is on this
  // song, which most players that report what they play also save.
  let restored = false;
  if (auth) {
    try {
      const saved = await getPlayQueue(auth);
      if (saved?.current === entry.song.id) restored = await store().restoreFromServer(true);
    } catch {
      // The song alone, below.
    }
  }
  if (!restored) {
    if (!(await store().playQueue([entry.song], 0, entry.playerName))) return;
  } else if (!store().isPlaying) {
    store().toggle();
  }
  if (positionSec > 1) store().seekTo(positionSec);
}

export function PlayingElsewhereCard() {
  const { accent } = useTheme();
  const t = useT();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const ownSongId = usePlayerStore((s) => s.queue[s.index]?.id);
  const ownPlaying = usePlayerStore((s) => s.isPlaying);
  const [focused, setFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['nowPlaying'],
    queryFn: () => getNowPlaying(auth!),
    enabled: !!auth && !offline && auth.serverType !== 'jellyfin',
    staleTime: POLL_MS,
    refetchInterval: focused ? POLL_MS : false,
  });
  const entry = data && auth ? pickEntry(data, auth.username, ownSongId, ownPlaying) : null;
  const cover = entry ? songCoverUrl(entry.song, COVER.card) : undefined;
  const vivid = useDominantColor(cover, true);
  const calm = useDominantColor(cover);

  if (!entry) return null;

  const player = entry.playerName || t('another device');
  const heading =
    entry.state === 'paused'
      ? t('Paused on {player}', { player })
      : t('Playing on {player}', { player });
  const duration = entry.song.duration ?? 0;
  const progress =
    duration > 0 && entry.positionMs != null
      ? Math.min(100, Math.round((entry.positionMs / 1000 / duration) * 100))
      : 0;

  const start = async () => {
    if (busy) return;
    haptic('light');
    setBusy(true);
    try {
      await playHere(entry, dataUpdatedAt);
    } finally {
      setBusy(false);
    }
    router.push('/player');
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.85 }]}
      onPress={() => void start()}
      accessibilityRole="button"
      accessibilityLabel={`${heading}: ${entry.song.title}. ${t('Play here')}`}
    >
      <LinearGradient
        colors={[vivid, calm] as const}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <Cover uri={cover} size={COVER_SIZE} style={styles.cover} />
        <View style={styles.info}>
          <Text style={styles.heading} numberOfLines={1}>
            {heading}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {entry.song.title}
          </Text>
          {entry.song.artist ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {entry.song.artist}
            </Text>
          ) : null}
        </View>
        <Pressable
          hitSlop={8}
          disabled={busy}
          style={({ pressed }) => [
            styles.play,
            { backgroundColor: accent },
            (pressed || busy) && { transform: [{ scale: 0.94 }] },
          ]}
          onPress={() => void start()}
          accessibilityRole="button"
          accessibilityLabel={t('Play here')}
        >
          <Icon name="play" size={26} color={colors.onAccent} />
        </Pressable>
        {progress > 0 ? (
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${progress}%`, backgroundColor: colors.text }]} />
          </View>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}

const styles = themed((colors) => ({
  wrap: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cover: { borderRadius: radius.sm },
  info: { flex: 1, minWidth: 0 },
  heading: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginTop: 2 },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  play: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: colors.surfaceHighlight,
  },
  bar: { height: 3, opacity: 0.8 },
}));
