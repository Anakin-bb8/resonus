/**
 * Cover art for the Favorites entry point: indigo → sky gradient with a heart,
 * like Spotify's "Liked Songs". The Favorites screen header uses the darkened
 * indigo (see HEADER_COLOR there).
 */
import Icon from '@/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';

import { radius } from '@/theme';

export function FavoritesArt({ size }: { size: number }) {
  return (
    <LinearGradient
      colors={['#450af5', '#8e8ee5'] as const}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="heart" size={size * 0.45} color="#fff" />
    </LinearGradient>
  );
}
