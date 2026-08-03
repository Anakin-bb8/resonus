/**
 * Subtle "offline" indicator for the tab headers (Home, Library, Search).
 * It reminds why what is on screen is limited to downloads.
 * Only for server accounts in offline mode; on a local profile "offline" is
 * the normal state and doesn't need a warning, and Home marks that one with an
 * icon of its own.
 *
 * The cloud on its own, everywhere. The word beside it was the widest thing in
 * a header that already carries two or three buttons, and in the search bar it
 * took room from what was being typed. Translation only makes that worse: one
 * word in English is two or three elsewhere. It stays as the accessibility
 * label, which is where saying it out loud is the whole point.
 */
import Ionicons from '@expo/vector-icons/Ionicons';

import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors } from '@/theme';

export function OfflineIndicator() {
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const hasAccount = useAuthStore((s) => !!s.auth);
  if (!offline || !hasAccount) return null;
  // A step under the 24 of the buttons it sits next to: it is a state, not
  // something to press.
  return (
    <Ionicons
      name="cloud-offline-outline"
      size={20}
      color={colors.textMuted}
      accessibilityLabel={t('Offline')}
    />
  );
}
