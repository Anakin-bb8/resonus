/**
 * Where a launcher shortcut lands (`resonus://shortcut/<action>`, rewritten by
 * `+native-intent`): it does the one thing and gets out of the way.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { getStarred } from '@/api/data';
import { useT } from '@/i18n';
import {
  RESTORE_WAIT_MS,
  type ShortcutAction,
  runPlaybackToggle,
  waitFor,
} from '@/lib/homeWidget';
import { requestSearchFocus } from '@/lib/tabOrigin';
import { useAuthStore } from '@/store/auth';
import { SOURCE_FAVORITES, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, themed, useTheme } from '@/theme';

export default function ShortcutScreen() {
  useTheme();
  const t = useT();
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const { action } = useLocalSearchParams<{ action?: ShortcutAction }>();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    /** Leaves for `route`, with the tabs under it when the app was opened cold. */
    const go = (route: string) => {
      if (router.canGoBack()) {
        router.replace(route);
      } else {
        router.replace('/(tabs)');
        if (route !== '/(tabs)') router.push(route);
      }
    };

    void (async () => {
      const ready = await waitFor(() => {
        const s = useAuthStore.getState();
        return !s.hydrating && (!!s.auth || s.offline);
      }, RESTORE_WAIT_MS);
      if (!ready) return go('/(tabs)');

      if (action === 'search') {
        requestSearchFocus();
        return go('/search');
      }

      if (action === 'shuffle-favorites') {
        try {
          const { songs } = await getStarred();
          const played = await usePlayerStore
            .getState()
            .playQueue(songs, 0, SOURCE_FAVORITES, '/favorites', { shuffled: true });
          if (played) return go('/player');
        } catch {
          // Said below, the same as having none.
        }
        toast(t('No favorite songs to play'));
        return go('/(tabs)');
      }

      if (action === 'continue') {
        const player = usePlayerStore.getState;
        if (await waitFor(() => player().queue.length > 0, RESTORE_WAIT_MS)) {
          if (!player().isPlaying) player().toggle();
          return go('/player');
        }
        toast(t('Nothing to continue'));
        return go('/(tabs)');
      }

      if (action === 'playback-toggle') {
        // The button's own deep link, which only iOS 16 still takes (the
        // intent has no room there): it still toggles and still lands in the
        // player, because this route opened the app to get here. iOS 17 and
        // up never come this way — the press runs where it stands, with the
        // app untouched (see PlaybackToggleIntent).
        if (await runPlaybackToggle()) return go('/player');
        return go('/(tabs)');
      }

      go('/(tabs)');
    })();
  }, [action, router, t, toast]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

const styles = themed((colors) => ({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
}));
