/**
 * Android's battery optimization, as seen from JS (native module `BatteryOpt`).
 *
 * With it on — the default, and what the system restores by itself after a
 * while without opening the app — Android may kill playback in the background,
 * stall a download or delay the sleep timer. It can't be read from JS, hence
 * the module; on a build without it (or another platform) everything answers
 * "nothing to warn about", which is the safe side.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule<{
  isIgnoringOptimizations: () => boolean;
  openSettings: () => boolean;
}>('BatteryOpt');

/** Is the app restricted by battery optimization? */
export function isBatteryOptimized(): boolean {
  if (!native) return false;
  try {
    return !native.isIgnoringOptimizations();
  } catch {
    return false;
  }
}

/** Opens the system screen where the exemption is granted. */
export function openBatterySettings(): void {
  try {
    native?.openSettings();
  } catch {
    // The device has no such screen: nothing else to try from here.
  }
}
