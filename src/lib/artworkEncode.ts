/**
 * The frame rate lock screen clips encode at, handed to the native module.
 *
 * The value itself lives in settings (`animatedArtworkFps`); this is the
 * one place that tells the encoder about it, so the store never has to know
 * what the native side looks like — and a build without the patched module
 * keeps its own default, because the call below simply throws and is caught.
 */
import { AudioModule, type NativeAudioModule } from 'expo-audio';

/**
 * The module under its own type: the namespace rule at an import reads
 * nothing off it (see the same alias in `player.ts`).
 */
const audioModule = AudioModule as NativeAudioModule;

/** Pushes the fps to the encoder; 30 by default, 60 on request. */
export function pushArtworkEncodeFps(fps: number) {
  try {
    audioModule.setArtworkFps(fps);
  } catch {
    // A build without the patched module: covers encode at its default.
  }
}
