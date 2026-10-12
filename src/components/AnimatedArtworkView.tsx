/**
 * HLS covers over their still ones: the still image underneath is the poster
 * the clip fades in over, so a missing or loading clip simply shows the
 * cover as before. Mounted only when a clip URL is known.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

let VideoView: React.ComponentType<any> | null = null;
let useVideoPlayer: ((source: string, setup?: (player: any) => void) => any) | null = null;
try {
  const mod = require('expo-video');
  VideoView = mod.VideoView ?? null;
  useVideoPlayer = mod.useVideoPlayer ?? null;
} catch {
  VideoView = null;
  useVideoPlayer = null;
}

/** True on builds that can play HLS covers (absent from bare runtimes). */
export function canPlayAnimatedCovers(): boolean {
  return !!VideoView && !!useVideoPlayer;
}

/**
 * A native call that may land nowhere: on teardown (Expo Go most of all)
 * the shared object can be gone while JS still holds it. Those calls are
 * best-effort by design — the still cover underneath covers for them.
 */
function callPlayer(fn: () => void): void {
  try {
    fn();
  } catch {
    // The native player is already gone; nothing to pause or start.
  }
}

/** A looping muted clip player that sleeps with the app: no decoding behind
 *  the lock screen, where only the audio keeps going. */
function useClipPlayer(uri: string): any {
  const player = useVideoPlayer!(uri, (p) => {
    p.loop = true;
    p.muted = true;
    callPlayer(() => p.play());
  });
  useEffect(() => {
    callPlayer(() => player.play());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') callPlayer(() => player.play());
      else callPlayer(() => player.pause());
    });
    return () => {
      sub.remove();
      callPlayer(() => player.pause());
    };
  }, [player]);
  return player;
}

function ClipVideo({ uri, size, corner }: { uri: string; size: number; corner: number }) {
  const player = useClipPlayer(uri);
  if (!VideoView) return null;
  const VV = VideoView;
  return (
    <VV
      style={{ width: size, height: size, borderRadius: corner }}
      player={player}
      contentFit="cover"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}

export function AnimatedArtworkView({
  square,
  size,
  corner,
}: {
  /** Square HLS clip, or null while unknown: renders nothing then. */
  square: string | null | undefined;
  size: number;
  corner: number;
}) {
  if (!square || !VideoView || !useVideoPlayer) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <ClipVideo uri={square} size={size} corner={corner} />
    </View>
  );
}

/** Full-screen clip behind everything, like the animated image background. */
export function AnimatedArtworkBackground({ square }: { square: string | null | undefined }) {
  if (!square || !VideoView || !useVideoPlayer) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <BackgroundClip uri={square} />
    </View>
  );
}

function BackgroundClip({ uri }: { uri: string }) {
  const player = useClipPlayer(uri);
  if (!VideoView) return null;
  const VV = VideoView;
  return (
    <VV
      style={StyleSheet.absoluteFill}
      player={player}
      contentFit="cover"
      nativeControls={false}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
    />
  );
}
