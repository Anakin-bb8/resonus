/** Heart to mark/unmark favorites (Subsonic star/unstar). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';

import { star, unstar, type StarType } from '@/api/data';
import { applyStarChange, resyncFavorites } from '@/lib/favoritesCache';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/i18n';
import { colors } from '@/theme';

interface Props {
  id: string;
  type?: StarType;
  starred?: boolean;
  size?: number;
}

export function FavoriteButton({ id, type = 'song', starred, size = 22 }: Props) {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const [fav, setFav] = useState(!!starred);
  const [busy, setBusy] = useState(false);

  // Resync with the current song: the same component is reused when switching
  // tracks (mini-player/player), so without this the heart would stay "stuck"
  // to the previous song's state.
  useEffect(() => {
    setFav(!!starred);
  }, [id, starred]);

  async function toggle(e?: GestureResponderEvent) {
    e?.stopPropagation();
    if ((!auth && !offline) || busy) return;
    const nextFav = !fav;
    haptic('medium');
    setFav(nextFav); // optimistic update
    setBusy(true);
    try {
      if (nextFav) await star(id, type);
      else await unstar(id, type);
      // Only the id is known here, so removing is exact and adding leaves the
      // list to refresh when something needs it (see `favoritesCache`).
      applyStarChange(type, id, nextFav);
    } catch {
      setFav(!nextFav); // revert on failure
      resyncFavorites();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      hitSlop={10}
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={fav ? t('Remove from favorites') : t('Add to favorites')}
    >
      <Ionicons
        name={fav ? 'heart' : 'heart-outline'}
        size={size}
        color={fav ? colors.accent : colors.textSecondary}
      />
    </Pressable>
  );
}
