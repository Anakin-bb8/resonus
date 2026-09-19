/**
 * The font file a user picks in Settings › Font.
 *
 * Only the file name is kept in settings, never the full path: on iOS the app's
 * document directory changes with an update or a restore from backup, and a
 * stored absolute path then points at nothing. The name is resolved against the
 * current directory every time.
 *
 * Every pick gets its own file and its own family name. expo-font does nothing
 * when asked to load a family it already has, so reusing one name kept showing
 * the first font picked in the session.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Font from 'expo-font';

const PREFIX = 'custom-font-';

/** Where a stored font lives now. Accepts the old full-path values too. */
export function customFontPath(stored: string): string {
  return `${FileSystem.documentDirectory}${stored.split('/').pop()}`;
}

/** Loads the stored font under `family`. Resolves false if it can't be loaded. */
export async function loadCustomFont(family: string, stored: string): Promise<boolean> {
  if (Font.isLoaded(family)) return true;
  try {
    await Font.loadAsync({ [family]: { uri: customFontPath(stored) } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies a picked file in, loads it and removes the previous custom fonts.
 * Returns what goes into settings. Throws if the file is not a usable font.
 */
export async function importCustomFont(
  sourceUri: string,
  name: string,
): Promise<{ family: string; file: string }> {
  const ext = name.split('.').pop()?.toLowerCase() || 'ttf';
  const id = Date.now().toString(36);
  const file = `${PREFIX}${id}.${ext}`;
  const family = `CustomFont-${id}`;
  await FileSystem.copyAsync({ from: sourceUri, to: customFontPath(file) });
  try {
    await Font.loadAsync({ [family]: { uri: customFontPath(file) } });
  } catch (e) {
    await FileSystem.deleteAsync(customFontPath(file), { idempotent: true });
    throw e;
  }
  await removeCustomFontFiles(file);
  return { family, file };
}

/** Deletes the custom font files in the document directory, except `keep`. */
export async function removeCustomFontFiles(keep?: string): Promise<void> {
  const dir = FileSystem.documentDirectory;
  if (!dir) return;
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((n) => (n.startsWith(PREFIX) || n.startsWith('custom-font.')) && n !== keep)
      .map((n) => FileSystem.deleteAsync(`${dir}${n}`, { idempotent: true })),
  );
}
