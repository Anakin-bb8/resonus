/**
 * "Add to favorites" and "Remove from favorites" for the ⋯ menu of a selection
 * (#164). Two fixed entries rather than one that flips, because a selection can
 * hold songs on both sides of the heart and one button would have to pick a
 * direction for it. Each touches only the songs it applies to: starring a
 * favorite again moves it to the top of the list for nothing.
 */
import { star, unstar } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { useT } from '@/i18n';
import { applyStarChange, resyncFavorites } from '@/lib/favoritesCache';
import { useToast } from '@/store/toast';
import { type SelectionAction } from '@/components/SelectionBar';
import { useFavoriteIds } from './useFavoriteIds';

/** Runs an action with the marked songs and leaves selection mode. */
export type SelectionRunner = (fn: (songs: Song[]) => void) => void;

export function useSelectionFavorites(run: SelectionRunner): SelectionAction[] {
  const t = useT();
  const toast = useToast((s) => s.show);
  const favIds = useFavoriteIds();

  async function apply(songs: Song[], add: boolean) {
    // Without the list at hand, everything selected goes: the request is
    // harmless either way and doing nothing would be worse.
    const which = favIds ? songs.filter((s) => favIds.has(s.id) !== add) : songs;
    if (which.length === 0) {
      toast(t('Nothing to change'));
      return;
    }
    try {
      for (const s of which) {
        if (add) await star(s.id, 'song');
        else await unstar(s.id, 'song');
        // The cached list is patched, not thrown away: see `favoritesCache`.
        applyStarChange('song', s.id, add, s);
      }
      const n = which.length;
      toast(
        add
          ? n === 1
            ? t('Added to favorites')
            : t('{n} added to favorites', { n })
          : n === 1
            ? t('Removed from favorites')
            : t('{n} removed from favorites', { n }),
      );
    } catch {
      resyncFavorites();
      toast(t("Couldn't complete the action"));
    }
  }

  return [
    {
      icon: 'heart-outline',
      label: t('Add to favorites'),
      onPress: () => run((sel) => void apply(sel, true)),
    },
    {
      icon: 'heart-dislike-outline',
      label: t('Remove from favorites'),
      onPress: () => run((sel) => void apply(sel, false)),
    },
  ];
}
