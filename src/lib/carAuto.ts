/**
 * JS ↔ `CarAuto` native module bridge (Android Auto / Automotive OS).
 *
 * The native module holds ONE MediaLibrarySession (Media3) that provides the
 * car controls and the browse tree. From JS:
 *  - `setNodes` pushes the browse tree (root → albums/artists/...).
 *  - `setNowPlaying`/`setQueue`/`setPlaybackState` keep the car session in
 *    sync with actual playback.
 *  - `onPlay` fires when a playable leaf is tapped in the car.
 *  - `onTransport` fires with transport buttons (play/pause/next...).
 *
 * On platforms without the module (web, iOS) everything is a no-op.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule('CarAuto');

export const carAutoAvailable = !!native;

/** A node of the browse tree shown in the car. */
export interface CarNode {
  id: string;
  title: string;
  subtitle?: string;
  /** http(s) → downloaded by host; file:// → embedded; data: unsupported. */
  artworkUrl?: string;
  /** true = playable leaf; false = browsable folder. */
  playable: boolean;
  /** How to render children of a browsable node: "list" | "grid". */
  contentStyle?: 'list' | 'grid';
  /**
   * What the item is. The car draws each kind its own way — an artist's cover
   * comes out round, an album's square — and without this everything browsable
   * is a folder to it. Left out, it falls back to that.
   */
  mediaType?: 'album' | 'artist' | 'playlist';
}

/** Tree: parentId → children map. Root is the "root" key. */
export interface CarTree {
  nodes: Record<string, CarNode[]>;
}

export interface CarTrack {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
}

export type TransportEvent =
  | { action: 'play' | 'pause' | 'next' | 'previous' }
  | { action: 'seek'; value: number } // ms
  | { action: 'seekToIndex'; value: number }
  | { action: 'shuffle'; value: number } // 1/0
  | { action: 'repeat'; value: 'off' | 'all' | 'one' };

export interface PlayEvent {
  mediaId: string;
  parentId?: string;
}

export function setNodes(tree: CarTree): void {
  native?.setNodes(JSON.stringify(tree));
}

export function setNowPlaying(track: CarTrack | null): void {
  native?.setNowPlaying(track ? JSON.stringify(track) : null);
}

export function setQueue(tracks: CarTrack[], currentIndex: number): void {
  native?.setQueue(JSON.stringify({ tracks, currentIndex }));
}

export function setPlaybackState(state: {
  isPlaying: boolean;
  positionMs: number;
  shuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
}): void {
  native?.setPlaybackState(JSON.stringify(state));
}

export function onPlay(cb: (e: PlayEvent) => void): { remove: () => void } | undefined {
  return native?.addListener('play', cb);
}

export function onTransport(cb: (e: TransportEvent) => void): { remove: () => void } | undefined {
  return native?.addListener('transport', cb);
}
