/**
 * Vocal removal (Karaoke), through the native `VocalSeparator` module.
 *
 * The separation itself — a Core ML Mel-Band RoFormer over the player's audio,
 * done on Apple's Neural Engine — lives in `modules/vocal-separator` and is
 * iOS-only: the models are compiled Core ML bundles and there is no equivalent
 * for Android or web. Everywhere else the module is absent and this is a no-op,
 * so callers can import it without a platform check.
 *
 * The mix runs 0 to 1: 0 is the background alone, 0.5 the original track, 1 the
 * vocals alone — the same scale the Taurus tweak's Sing uses. The value is
 * applied to the audio already playing, so moving the slider is immediate.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

/** The native module's surface. Absent on Android, web and Expo Go. */
interface NativeVocalSeparator {
  /** iOS 18+ with Core ML: false everywhere the models cannot run. */
  isSupported: () => boolean;
  /** SHA-256 of a file, hex. Used to verify the downloaded voice models. */
  sha256: (uri: string) => string;
  /**
   * Loads an installed model bundle and warms it. `kind` is 'full' or 'light'
   * and only selects the internal voice, the path is what is loaded.
   */
  loadModel: (uri: string, kind: string) => boolean;
  /** Frees the loaded model and stops whatever separation is running. */
  unloadModel: () => void;
  /** Turns the live separation on and off for the player's current sound. */
  setEnabled: (enabled: boolean) => void;
  /** The mix, 0 (background only) to 1 (vocals only). */
  setMix: (mix: number) => void;
}

export const vocalSeparator = requireOptionalNativeModule<NativeVocalSeparator>('VocalSeparator');

/** Can this build and this device remove vocals at all? */
export function isVocalRemovalSupported(): boolean {
  if (!vocalSeparator) return false;
  try {
    return vocalSeparator.isSupported();
  } catch {
    return false;
  }
}
