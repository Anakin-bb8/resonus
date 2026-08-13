/**
 * Integration with UPnP/DLNA renderers (native module modules/upnp-cast).
 *
 * The queue lives in the player store and here only the session is managed
 * (chosen device) and the return events. The native module polls the renderer
 * state every second; track end is inferred from a STOPPED near the end
 * (UPnP doesn't distinguish "finished" from "stopped by user").
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { create } from 'zustand';

import { coverArtUrl as serverCoverArtUrl, streamUrl, type Song } from '@/api/backend';
import { COVER } from '@/api/data';
import { useAuthStore } from './auth';
import { castStop } from './castMedia';
import { useSettings } from './settings';

/** Events the player registers to react to remote output (UPnP). */
export interface RemoteEvents {
  /** Session started: transfer the current track to the renderer. */
  onConnected: () => void;
  /** Session ended: return to the local player at this position. */
  onDisconnected: (lastPositionSec: number) => void;
  /** Renderer advanced to a different track in its queue. */
  onTrackChanged: (index: number, positionSec: number, durationSec: number) => void;
  onProgress: (positionSec: number, durationSec: number) => void;
  onPlayingChanged: (isPlaying: boolean, isBuffering: boolean) => void;
  onRepeatChanged?: (repeat: 'off' | 'all' | 'one') => void;
  /** Track finished naturally on the renderer. */
  onFinished: () => void;
}

export interface UpnpDevice {
  id: string;
  name: string;
  address: string;
  isTV: boolean;
  isSonos?: boolean;
  groupId?: string | null;
  coordinatorId?: string | null;
}

interface UpnpStoreState {
  connected: boolean;
  deviceId: string | null;
  /** Renderers found in the last search. */
  devices: UpnpDevice[];
  scanning: boolean;
}

export const useUpnp = create<UpnpStoreState>(() => ({
  connected: false,
  deviceId: null,
  devices: [],
  scanning: false,
}));

interface NativeState {
  playbackState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED' | 'BUFFERING' | 'ERROR';
  positionMs: number;
  durationMs: number;
  trackNumber?: number;
  playMode?: string;
}

const native = requireOptionalNativeModule('UpnpCast');

export const upnpAvailable = !!native;

let events: RemoteEvents | null = null;
let stateSub: { remove: () => void } | undefined;
let lastPositionSec = 0;
let lastDurationSec = 0;
/** Prevents advancing the queue twice for the same track end. */
let finishedFired = false;
/** Ignores transient STOPPED while the renderer loads another track. */
let loading = false;
/** We have seen PLAYING since the last load/pause (to infer the end). */
let wasPlaying = false;
/** We requested the pause ourselves: a STOPPED after this is not a track end. */
let pausedByUs = false;
let lastNativeTrackNumber = 0;
let lastRemoteRepeat: 'off' | 'all' | 'one' | null = null;

interface CachedDevice {
  device: UpnpDevice;
  expiresAtMs: number;
}

const discoveredDeviceCache = new Map<string, CachedDevice>();
const DEFAULT_DEVICE_CACHE_TTL_MS = 15_000;
let deviceCacheTtlMs = DEFAULT_DEVICE_CACHE_TTL_MS;

export function isUpnpConnected(): boolean {
  return useUpnp.getState().connected;
}

function currentUpnpDevice(): UpnpDevice | null {
  const state = useUpnp.getState();
  return state.deviceId ? state.devices.find((device) => device.id === state.deviceId) ?? null : null;
}

/** Registers player events. Call only once (from the player). */
export function initUpnp(ev: RemoteEvents): void {
  events = ev;
}

function repeatForPlayMode(playMode?: string): 'off' | 'all' | 'one' | null {
  if (!playMode) return null;
  const normalized = playMode.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.includes('REPEAT_ONE')) return 'one';
  if (normalized === 'REPEAT_ALL' || normalized === 'SHUFFLE') return 'all';
  if (normalized === 'NORMAL' || normalized === 'SHUFFLE_NOREPEAT') return 'off';
  return null;
}

function onNativeState(e: NativeState) {
  if (!isUpnpConnected()) return;
  const repeat = repeatForPlayMode(e.playMode);
  if (repeat != null && repeat !== lastRemoteRepeat) {
    lastRemoteRepeat = repeat;
    events?.onRepeatChanged?.(repeat);
  }
  const pos = (e.positionMs ?? 0) / 1000;
  const dur = (e.durationMs ?? 0) / 1000;
  const trackNumber = Math.floor(e.trackNumber ?? 0);
  if (pos > 0) lastPositionSec = pos;
  if (dur > 0) lastDurationSec = dur;
  if (trackNumber > 0) {
    const changed = trackNumber !== lastNativeTrackNumber;
    lastNativeTrackNumber = trackNumber;
    if (changed && !loading) {
      events?.onTrackChanged(trackNumber - 1, pos, dur || lastDurationSec);
    }
  }
  switch (e.playbackState) {
    case 'PLAYING':
      loading = false;
      finishedFired = false;
      wasPlaying = true;
      pausedByUs = false;
      events?.onProgress(pos, dur || lastDurationSec);
      events?.onPlayingChanged(true, false);
      break;
    case 'BUFFERING':
      events?.onPlayingChanged(true, true);
      break;
    case 'PAUSED':
      wasPlaying = false;
      events?.onProgress(pos, dur || lastDurationSec);
      events?.onPlayingChanged(false, false);
      break;
    case 'STOPPED':
    case 'IDLE':
      // UPnP doesn't distinguish "ended" from "stopped": we infer a natural end
      // from a STOPPED that arrives after having been playing (not a pause we
      // requested). Wide window towards the end (10% of track, min 5 s):
      // polling is 1 s and some renderers stop reporting position in the last
      // seconds, so a fixed 3 s threshold was too tight and the queue wouldn't
      // advance. Without known duration, we trust we were playing (better to
      // advance than to get stuck).
      if (!finishedFired && !loading && wasPlaying && !pausedByUs) {
        const window = Math.max(5, lastDurationSec * 0.1);
        const nearEnd = lastDurationSec <= 0 || lastPositionSec >= lastDurationSec - window;
        if (nearEnd) {
          finishedFired = true;
          wasPlaying = false;
          events?.onFinished();
        }
      }
      break;
    default:
      break;
  }
}

/**
 * Searches for renderers on the network (~5 s) and refreshes the visible list.
 *
 * Devices that are seen are updated immediately. Devices that are missed on one
 * round stay visible until the cache TTL expires, which smooths over SSDP loss
 * while still eventually removing stale entries.
 */
/** A name the library made up out of the address, not the device's own. */
function looksRaw(name: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}\b/.test(name.trim());
}

/**
 * One row per address, keeping the friendliest name.
 *
 * Sonos answers discovery more than once and the library names each answer
 * differently: the room ("Schlafzimmer") in one, "<ip> - Sonos Play:1 -
 * RINCON…" in another. That's two rows for one speaker, and the unreadable one
 * is as likely to be tapped as the good one.
 */
function dedupeDevices(devices: UpnpDevice[]): UpnpDevice[] {
  const byAddress = new Map<string, UpnpDevice>();
  for (const d of devices) {
    const key = d.address || d.id;
    const kept = byAddress.get(key);
    if (!kept || (looksRaw(kept.name) && !looksRaw(d.name))) byAddress.set(key, d);
  }
  return Array.from(byAddress.values());
}

export async function upnpSearch(): Promise<void> {
  if (!native || useUpnp.getState().scanning) return;
  useUpnp.setState({ scanning: true });
  try {
    const now = Date.now();
    const found = dedupeDevices((await native.search(5000)) as UpnpDevice[]);
    const seen = new Set<string>();

    for (const device of found) {
      seen.add(device.id);
      discoveredDeviceCache.set(device.id, {
        device,
        expiresAtMs: now + deviceCacheTtlMs,
      });
    }

    for (const [id, cached] of discoveredDeviceCache) {
      if (!seen.has(id) && cached.expiresAtMs <= now) discoveredDeviceCache.delete(id);
    }

    const visible = dedupeDevices(Array.from(discoveredDeviceCache.values()).map((v) => v.device));
    useUpnp.setState({
      devices: visible,
    });
  } catch {
    // keep the previous list
  } finally {
    useUpnp.setState({ scanning: false });
  }
}

export async function upnpConnect(device: UpnpDevice): Promise<boolean> {
  if (!native) return false;
  const current = useUpnp.getState();
  // Remote-to-remote handoff: stop the previous renderer first so playback
  // doesn't continue there while the new device takes over.
  if (current.connected && current.deviceId && current.deviceId !== device.id) {
    await upnpDisconnect(true);
  }
  const ok = (await native.connect(device.id)) as boolean;
  if (!ok) return false;
  lastPositionSec = 0;
  lastDurationSec = 0;
  lastNativeTrackNumber = 0;
  lastRemoteRepeat = null;
  finishedFired = false;
  wasPlaying = false;
  pausedByUs = false;
  stateSub?.remove();
  stateSub = native.addListener('state', onNativeState);
  useUpnp.setState({ connected: true, deviceId: device.id });
  events?.onConnected();
  return true;
}

/** Cuts the session; with silent it doesn't notify the player (e.g. when switching to cast). */
export async function upnpDisconnect(silent = false): Promise<void> {
  if (!isUpnpConnected()) return;
  stateSub?.remove();
  stateSub = undefined;
  // Closes the casting media session on any disconnect path
  // (including silent ones: output switch, reset), not just the normal one.
  castStop();
  useUpnp.setState({ connected: false, deviceId: null });
  lastNativeTrackNumber = 0;
  lastRemoteRepeat = null;
  lastPositionSec = 0;
  lastDurationSec = 0;
  try {
    await native?.disconnect();
  } catch {
    // ignore
  }
  if (!silent) events?.onDisconnected(lastPositionSec);
}

function firstNonBlank(...values: (string | undefined | null)[]): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function buildUpnpTrackInfo(song: Song) {
  const auth = useAuthStore.getState().auth;
  const listedArtists = firstNonBlank(song.artists?.map((a) => a.name).filter(Boolean).join(', '));
  const listedAlbumArtists = firstNonBlank(song.albumArtists?.map((a) => a.name).filter(Boolean).join(', '));
  return {
    title: song.title,
    artist: firstNonBlank(song.artist, listedArtists, listedAlbumArtists),
    albumArtist: listedAlbumArtists,
    album: firstNonBlank(song.album),
    artworkUrl: auth ? serverCoverArtUrl(auth, song.albumId ?? song.coverArt, COVER.card) : undefined,
    durationSec: song.duration ?? 0,
  };
}

function buildUpnpTrackUrl(song: Song): string | undefined {
  const auth = useAuthStore.getState().auth;
  if (song.url) return song.url;
  if (!song.localUri && auth) {
    const settings = useSettings.getState();
    return streamUrl(auth, song.id, settings.maxBitRate, 0, settings.streamFormat);
  }
  return undefined;
}

function buildUpnpQueuePayload(queue: Song[]) {
  const tracks = queue.map((song) => {
    const url = buildUpnpTrackUrl(song);
    if (!url) return null;
    const info = buildUpnpTrackInfo(song);
    const settings = useSettings.getState();
    return {
      url,
      mime: castMime(song, settings.maxBitRate > 0 ? settings.streamFormat : undefined),
      ...info,
    };
  });
  if (tracks.some((track) => track == null)) return null;
  return tracks as (ReturnType<typeof buildUpnpTrackInfo> & { url: string; mime: string })[];
}

function buildUpnpTrackPayload(song: Song) {
  const url = buildUpnpTrackUrl(song);
  if (!url) return null;
  const info = buildUpnpTrackInfo(song);
  const settings = useSettings.getState();
  return {
    url,
    mime: castMime(song, settings.maxBitRate > 0 ? settings.streamFormat : undefined),
    ...info,
  };
}

/**
 * What to tell the renderer this track is.
 *
 * A DLNA renderer decides whether it can play something from the type it is
 * handed, and a speaker refuses anything that isn't audio. The stream URL says
 * nothing about the file (`/rest/stream.view?…`), so the type has to come from
 * what we know about the song: what the server was asked to transcode to, or
 * failing that the file's own format.
 */
function castMime(song: Song, transcodedTo?: string): string {
  const suffix = (transcodedTo || song.suffix || '').toLowerCase();
  switch (suffix) {
    case 'mp3':
      return 'audio/mpeg';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg';
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'wma':
      return 'audio/x-ms-wma';
    case 'aif':
    case 'aiff':
      return 'audio/aiff';
    default:
      // Unknown is still audio, and saying so beats letting it be guessed:
      // guessing is what announced every song as a video and left speakers
      // refusing all of them (#70).
      return 'audio/mpeg';
  }
}

/**
 * Loads a track on the renderer. Returns false if there is no session or the song
 * is not castable (local files: the renderer cannot reach them).
 */
export async function upnpLoad(
  queue: Song[],
  index: number,
  autoplay: boolean,
  startTimeSec = 0,
  playMode: string,
): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  const current = queue[index];
  if (!current) return false;
  loading = true;
  finishedFired = false;
  wasPlaying = false;
  pausedByUs = false;
  lastPositionSec = startTimeSec;
  lastDurationSec = current.duration ?? 0;
  try {
    const ok = currentUpnpDevice()?.isSonos
      ? await loadSonosQueue(queue, index, autoplay, startTimeSec, playMode)
      : await loadGenericUpnpTrack(current, autoplay, startTimeSec);
    if (ok && startTimeSec > 0) void native.seek(startTimeSec * 1000);
    // Not every renderer starts on its own after being handed a URI: Sonos
    // waits for an explicit Play and otherwise sits silent while the app
    // believes it's playing. Sending it always is harmless — one that already
    // started ignores it — and skipping it left whole devices mute.
    if (ok && autoplay) void native.play();
    // The ones that DO start on their own have to be stopped when we didn't
    // want playback yet.
    if (ok && !autoplay) void native.pause();
    if (!ok) loading = false;
    return ok;
  } catch {
    loading = false;
    return false;
  }
}

export async function upnpSyncQueue(
  queue: Song[],
  index: number,
  startTimeSec = 0,
  playMode: string,
): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  if (!currentUpnpDevice()?.isSonos) return false;
  const payload = buildUpnpQueuePayload(queue);
  if (!payload) return false;
  try {
    return (await native.syncQueue(
      JSON.stringify({
        tracks: payload,
        currentIndex: index,
        positionMs: startTimeSec * 1000,
        playMode,
      }),
    )) as boolean;
  } catch {
    return false;
  }
}

export async function upnpSetPlayMode(playMode: string): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  if (!currentUpnpDevice()?.isSonos) return true;
  try {
    return (await native.setPlayMode(playMode)) as boolean;
  } catch {
    return false;
  }
}

export async function upnpSetSleepTimer(durationSec: number | null): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  if (!currentUpnpDevice()?.isSonos) return true;
  const seconds = Math.max(0, Math.round(durationSec ?? 0));
  try {
    return (await native.setSleepTimer(seconds)) as boolean;
  } catch {
    return false;
  }
}

async function loadSonosQueue(
  queue: Song[],
  index: number,
  autoplay: boolean,
  startTimeSec: number,
  playMode: string,
): Promise<boolean> {
  const payload = buildUpnpQueuePayload(queue);
  if (!payload) return false;
  return (await native.loadQueue(
    JSON.stringify({
      tracks: payload,
      currentIndex: index,
      autoplay,
      positionMs: startTimeSec * 1000,
      playMode,
    }),
  )) as boolean;
}

/** Bitrate for the MP3 fallback below when streaming at original quality: a
 *  lossless track has no bitrate to inherit, and 320 is as good as MP3 gets. */
const CAST_MP3_BITRATE = 320;

async function loadGenericUpnpTrack(song: Song, autoplay: boolean, startTimeSec: number): Promise<boolean> {
  const payload = buildUpnpTrackPayload(song);
  if (!payload) return false;
  let ok = (await native.load(payload.url, payload, autoplay)) as boolean;
  // A renderer that won't take the format says so, and the answer to that is
  // to ask the server for the one nothing refuses. Only after being turned
  // down: the ones that do take FLAC keep getting it. Sonos never comes
  // through here, so this is the same second chance the TVs and speakers had
  // before the queue path existed (#70).
  if (!ok) {
    const mp3Url = mp3StreamUrl(song);
    if (mp3Url && mp3Url !== payload.url) {
      ok = (await native.load(mp3Url, { ...payload, url: mp3Url, mime: 'audio/mpeg' }, autoplay)) as boolean;
    }
  }
  if (ok && startTimeSec > 0) void native.seek(startTimeSec * 1000);
  return ok;
}

/** The same song asked for as MP3, or undefined when the server isn't the one
 *  serving it (a downloaded file, a URL of its own). */
function mp3StreamUrl(song: Song): string | undefined {
  const auth = useAuthStore.getState().auth;
  if (!auth || song.url || song.localUri) return undefined;
  const settings = useSettings.getState();
  return streamUrl(
    auth,
    song.id,
    settings.maxBitRate > 0 ? settings.maxBitRate : CAST_MP3_BITRATE,
    0,
    'mp3',
  );
}

export async function upnpJoinDevice(deviceId: string, targetDeviceId: string): Promise<boolean> {
  if (!native) return false;
  try {
    return (await native.join(deviceId, targetDeviceId)) as boolean;
  } catch {
    return false;
  }
}

export async function upnpUngroupDevice(deviceId: string): Promise<boolean> {
  if (!native) return false;
  try {
    return (await native.ungroup(deviceId)) as boolean;
  } catch {
    return false;
  }
}

export async function upnpPlay(): Promise<void> {
  pausedByUs = false;
  try {
    await native?.play();
  } catch {
    // ignore
  }
}

export async function upnpPause(): Promise<void> {
  // Marks the pause as ours: if the renderer reports STOPPED instead of
  // PAUSED, we don't confuse it with a track end (the queue wouldn't advance).
  pausedByUs = true;
  try {
    await native?.pause();
  } catch {
    // ignore
  }
}

export async function upnpSeek(sec: number): Promise<void> {
  try {
    await native?.seek(sec * 1000);
  } catch {
    // ignore
  }
}

/** Renderer volume; the app slider goes 0..1 and UPnP uses 0..100. */
export function upnpSetVolume(volume: number): void {
  try {
    void native?.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100));
  } catch {
    // ignore
  }
}
