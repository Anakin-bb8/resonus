/**
 * The heart outside the app: on the notification, the lock screen and the car
 * (Android). What it shows is read from the same favourites list the player's
 * heart reads, and pressing it does what that heart does.
 */
import { star, unstar } from '@/api/data';
import type { Song, Starred } from '@/api/subsonic';
import { tg } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import { applyStarChange, resyncFavorites } from './favoritesCache';
import { queryClient } from './query';

/** Whether the song is a favourite, or null where a heart makes no sense. */
export function favoriteState(song: Song | null | undefined): boolean | null {
  if (!song || song.url) return null;
  const { auth, offline } = useAuthStore.getState();
  if (!auth && !offline) return null;
  const starred = queryClient.getQueryData<Starred>(['starred']);
  return starred ? starred.songs.some((s) => s.id === song.id) : !!song.starred;
}

/** What the button is called, in the app's language: what pressing it does. */
export function favoriteLabel(favorite: boolean): string {
  return favorite ? tg('Remove from favorites') : tg('Add to favorites');
}

/** The player's heart, pressed from outside the app. */
export async function toggleFavorite(song: Song | null | undefined): Promise<void> {
  const current = favoriteState(song);
  if (current == null || !song) return;
  const next = !current;
  applyStarChange('song', song.id, next, song);
  try {
    if (next) await star(song.id);
    else await unstar(song.id);
    useToast.getState().show(next ? tg('Added to favorites') : tg('Removed from favorites'));
  } catch {
    resyncFavorites();
    useToast.getState().show(tg("Couldn't complete the action"));
  }
}

/** Calls `fn` whenever the favourites list changes. */
export function onFavoritesChange(fn: () => void): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] === 'starred' && event.type === 'updated') fn();
  });
}
