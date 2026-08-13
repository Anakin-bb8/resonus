/**
 * Change/remove the cover of a playlist or a radio station using an image from
 * the device. Combines both paths (Navidrome's native API for server profiles;
 * local copy for the offline profile, playlists only) and the password dialog
 * for older profiles that don't have it saved. Shared by the playlist and
 * radio edit sheets and the cover viewer.
 */
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';

import { deleteCoverImage, NavidromeError, uploadCoverImage, type CoverKind } from '@/api/navidrome';
import { useT } from '@/i18n';
import { removeLocalPlaylistCover, setLocalPlaylistCover } from '@/lib/localQueries';
import { forgetMirrorCover } from '@/lib/mirrorCovers';
import { useAuthStore } from '@/store/auth';
import { useLibraryMirror } from '@/store/libraryMirror';

// No filename: the upload streams the file the picker wrote, and its name on
// disk carries the extension already.
type PickedImage = { uri: string; type: string };

/** Cover action pending a password (older profiles). */
type CoverAction = { kind: 'upload'; image: PickedImage } | { kind: 'remove' };

export function useServerCover({
  kind = 'playlist',
  coverUploadId,
  localCoverId,
}: {
  /** What the cover belongs to; picks the endpoint and what to invalidate. */
  kind?: CoverKind;
  /** Server id (Navidrome profiles only): uploads via its native API. */
  coverUploadId?: string;
  /** Playlist id for the local profile: copies the image to app storage. */
  localCoverId?: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const auth = useAuthStore((s) => s.auth);
  const saveNativePassword = useAuthStore((s) => s.saveNativePassword);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [askPassword, setAskPassword] = useState(false);
  const [pendingAction, setPendingAction] = useState<CoverAction | null>(null);

  /** Resets to initial state (e.g. when re-opening the sheet that uses it).
   * Stable (useCallback) so it can go in effect deps without re-triggers. */
  const reset = useCallback(() => {
    setPickedUri(null);
    setError(null);
    setUploading(false);
    setAskPassword(false);
    setPendingAction(null);
  }, []);

  /** Opens the gallery and, if an image is picked, uploads/copies it as the cover. */
  async function pickAndUpload() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset) return;
    await runAction({
      kind: 'upload',
      image: { uri: asset.uri, type: asset.mimeType ?? 'image/jpeg' },
    });
  }

  async function removeCover() {
    await runAction({ kind: 'remove' });
  }

  async function runAction(action: CoverAction) {
    setError(null);
    if (localCoverId) {
      // Local profile playlist: the cover is copied/deleted on the device.
      setUploading(true);
      try {
        if (action.kind === 'upload') {
          await setLocalPlaylistCover(localCoverId, action.image.uri);
          setPickedUri(action.image.uri);
        } else {
          await removeLocalPlaylistCover(localCoverId);
          setPickedUri(null);
        }
        void queryClient.invalidateQueries({ queryKey: ['playlist', localCoverId] });
        void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      } catch {
        setError(t("Couldn't update the cover"));
      } finally {
        setUploading(false);
      }
      return;
    }
    if (!coverUploadId || !auth) return;
    if (!auth.ndPassword) {
      // Profile from before the password was saved: ask for it once.
      setPendingAction(action);
      setAskPassword(true);
      return;
    }
    await doServerAction(action, auth);
  }

  async function doServerAction(action: CoverAction, authToUse: NonNullable<typeof auth>) {
    if (!coverUploadId) return;
    setUploading(true);
    try {
      if (action.kind === 'upload') {
        await uploadCoverImage(authToUse, kind, coverUploadId, action.image);
        setPickedUri(action.image.uri);
      } else {
        await deleteCoverImage(authToUse, kind, coverUploadId);
        setPickedUri(null);
      }
      // The mirror keeps a copy of this cover for offline browsing, and it was
      // just replaced: forgetting it is what makes the new one be saved.
      forgetMirrorCover(useLibraryMirror.getState().profile, coverUploadId);
      if (kind === 'radio') {
        void queryClient.invalidateQueries({ queryKey: ['radioStations'] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['playlist', coverUploadId] });
        void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      }
    } catch (e) {
      if (e instanceof NavidromeError && e.kind === 'auth') {
        // Bad saved password: forget it so it will be asked again.
        void saveNativePassword('');
        setError(t('Wrong password'));
      } else if (e instanceof NavidromeError && e.kind === 'unsupported') {
        setError(
          kind === 'radio'
            ? t("Your server doesn't support radio covers")
            : t("Your server doesn't support playlist covers"),
        );
      } else if (e instanceof NavidromeError && e.kind === 'forbidden') {
        setError(t('Artwork upload is disabled on the server'));
      } else {
        // Everything that is not one of the three the app can explain. The
        // status goes in brackets when there is one: this message on its own
        // says nothing a report can be worked from, and it is the message the
        // one bug in this path spent weeks hiding behind.
        const status = e instanceof NavidromeError ? e.status : undefined;
        setError(
          status ? `${t("Couldn't update the cover")} (${status})` : t("Couldn't update the cover"),
        );
      }
    } finally {
      setUploading(false);
    }
  }

  /** Password dialog response: saves it and retries the action. */
  async function confirmPassword(password: string) {
    setAskPassword(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!password || !action || !auth) return;
    await saveNativePassword(password);
    await doServerAction(action, { ...auth, ndPassword: password });
  }

  function cancelPassword() {
    setAskPassword(false);
    setPendingAction(null);
  }

  return {
    /** There is some available path to change the cover. */
    enabled: !!(coverUploadId || localCoverId),
    pickedUri,
    error,
    uploading,
    askPassword,
    pickAndUpload,
    removeCover,
    confirmPassword,
    cancelPassword,
    reset,
  };
}
