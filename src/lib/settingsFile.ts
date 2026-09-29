/**
 * Settings to a file and back (#243): a new phone, or somebody else's app set up
 * the way yours is.
 *
 * The file is JSON with a header, so a file from anything else is refused
 * before it touches a setting, and `format` leaves room for a later version
 * that has to read this one differently. The settings themselves need no such
 * care: they are read through the same checks and migrations as the ones saved
 * on the phone, so a file from an older version is just an older blob.
 */
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { exportedSettings } from '@/store/settings';

const APP = 'resonus-settings';
const FORMAT = 1;

/** Writes the file and opens the share sheet; false when there is none. */
export async function shareSettingsFile(): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const body = {
    app: APP,
    format: FORMAT,
    version: Constants.expoConfig?.version ?? null,
    exportedAt: new Date().toISOString(),
    settings: exportedSettings(),
  };
  const day = body.exportedAt.slice(0, 10);
  const file = new File(Paths.cache, `resonus-settings-${day}.json`);
  file.create({ overwrite: true });
  file.write(JSON.stringify(body, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
  return true;
}

/**
 * Asks for a file and returns its settings, `null` when nothing was picked.
 * Throws when the file is not one of ours, or is from a newer format.
 */
export async function pickSettingsFile(): Promise<Record<string, unknown> | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Anything: a .json that went through a chat app or a file manager often
    // comes back as `application/octet-stream`, and the header decides anyway.
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const parsed = JSON.parse(await new File(result.assets[0].uri).text()) as {
    app?: unknown;
    format?: unknown;
    settings?: unknown;
  };
  if (
    parsed?.app !== APP ||
    typeof parsed.format !== 'number' ||
    parsed.format > FORMAT ||
    !parsed.settings ||
    typeof parsed.settings !== 'object' ||
    Array.isArray(parsed.settings)
  ) {
    throw new Error('Not a Resonus settings file');
  }
  return parsed.settings as Record<string, unknown>;
}
