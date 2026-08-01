/**
 * Sharing a song, album or playlist with someone else: the server mints a
 * public link (`createShare`) and the system share sheet takes it from there.
 *
 * Subsonic only — Jellyfin has no equivalent — and only when the server allows
 * it, which is what `useCanShare` checks before showing any button.
 */
import { Share } from 'react-native';

import { setShareDownloadable } from '@/api/navidrome';
import { createShare } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';

/**
 * Can this profile decide whether a link allows downloading? Only Navidrome
 * can, and only through its own API, so only a Navidrome profile that kept the
 * password for it (they all do since playlist covers; older ones may not).
 */
export function canShareDownloads(): boolean {
  const auth = useAuthStore.getState().auth;
  return auth?.serverType === 'navidrome' && !!auth.ndPassword;
}

export interface ShareResult {
  /** The link exists and was handed to the system. */
  ok: boolean;
  /** The link was made, but downloads could not be turned on for it. */
  downloadsFailed?: boolean;
}

/**
 * Creates the link and opens the share sheet. `ok` is false if the server
 * refused to create it (sharing turned off, no permission, no connection), so
 * the caller can say so; the sheet being dismissed is not a failure.
 *
 * `expiresAt` is when the link should stop working (ms since 1970); without it
 * the server's own default decides, as it always did. `downloadable` only means
 * anything where `canShareDownloads` is true, and failing at it doesn't sink
 * the share: a link that plays is still a link.
 */
export async function shareItem(
  id: string,
  description?: string,
  expiresAt?: number,
  downloadable?: boolean,
): Promise<ShareResult> {
  const auth = useAuthStore.getState().auth;
  if (!auth) return { ok: false };
  let share: { id: string; url: string };
  try {
    share = await createShare(auth, id, description, expiresAt);
  } catch {
    return { ok: false };
  }
  let downloadsFailed = false;
  if (downloadable && canShareDownloads()) {
    try {
      await setShareDownloadable(auth, share.id, true, description);
    } catch {
      downloadsFailed = true;
    }
  }
  try {
    // As `message` and not `url`: Android's share sheet ignores `url`, and the
    // apps people send links to (messengers, notes) all read the message.
    await Share.share({ message: share.url });
  } catch {
    // The sheet failed to open or was closed: the link exists either way.
  }
  return { ok: true, downloadsFailed };
}
