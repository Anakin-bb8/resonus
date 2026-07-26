/**
 * One-time cleanup of the radio covers that used to live on the device.
 *
 * Station images now come from the server (Navidrome holds them and every
 * client sees the same one), so the old copies under `radio-covers/` are
 * unreachable: nothing reads them any more. This deletes the folder so they
 * don't sit there taking up space forever. Safe to drop from the app once
 * enough time has passed since the version that introduced it.
 */
import * as FileSystem from 'expo-file-system/legacy';

const LEGACY_DIR = FileSystem.documentDirectory + 'radio-covers/';

export async function removeLegacyRadioCovers(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(LEGACY_DIR);
    if (info.exists) await FileSystem.deleteAsync(LEGACY_DIR, { idempotent: true });
  } catch {
    // Nothing to clean up, or it can't be deleted: not worth bothering about.
  }
}
