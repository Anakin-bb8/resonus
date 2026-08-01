/**
 * Sharing a song, album or playlist with someone else: the server mints a
 * public link (`createShare`) and the system share sheet takes it from there.
 *
 * Subsonic only — Jellyfin has no equivalent — and only when the server allows
 * it, which is what `useCanShare` checks before showing any button.
 */
import { Share } from 'react-native';

import { createShare } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';

/**
 * Creates the link and opens the share sheet. Returns false if the server
 * refused to create it (sharing turned off, no permission, no connection), so
 * the caller can say so; the sheet being dismissed is not a failure.
 *
 * `expiresAt` is when the link should stop working (ms since 1970); without it
 * the server's own default decides, as it always did.
 */
export async function shareItem(
  id: string,
  description?: string,
  expiresAt?: number,
): Promise<boolean> {
  const auth = useAuthStore.getState().auth;
  if (!auth) return false;
  let url: string;
  try {
    url = await createShare(auth, id, description, expiresAt);
  } catch {
    return false;
  }
  try {
    // As `message` and not `url`: Android's share sheet ignores `url`, and the
    // apps people send links to (messengers, notes) all read the message.
    await Share.share({ message: url });
  } catch {
    // The sheet failed to open or was closed: the link exists either way.
  }
  return true;
}
