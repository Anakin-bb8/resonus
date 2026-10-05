/**
 * A push that replaces the top route when a modal is sitting on it.
 *
 * On iOS a push out of the player — or the queue or lyrics above it — lands
 * in a sheet, the same reason those three wear fullScreenModal. Replacing
 * swaps the modal for the screen, which then takes its own presentation (a
 * card): the detail screens stay whole screens, with the bar and the mini
 * player under them, and the back chevron goes where the modal would have
 * gone. Anywhere else it is an ordinary push — and on Android it always is,
 * where a push out of a modal is just a push and replacing would pointlessly
 * lose the screen below.
 */
import { router } from 'expo-router';
import { Platform } from 'react-native';

/** The routes whose presentation is a native modal (see `_layout`). */
const MODAL_TOPS = ['player', 'queue', 'lyrics'];

export function pushOrReplace(href: string, top: string | undefined): void {
  if (Platform.OS === 'ios' && top && MODAL_TOPS.includes(top)) {
    router.replace(href as never);
  } else {
    router.push(href as never);
  }
}
