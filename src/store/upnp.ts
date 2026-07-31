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

import { streamUrl, type Song } from '@/api/backend';
// The data layer's: it resolves a downloaded cover to the file on disk, which
// is filtered out below since only this phone can reach it.
import { coverArtUrl } from '@/api/data';
import { useAuthStore } from './auth';
import { castStop } from './castMedia';
import { useSettings } from './settings';

/** Events the player registers to react to remote output (UPnP). */
export interface RemoteEvents {
  /** Session started: transfer the current track to the renderer. */
  onConnected: () => void;
  /** Session ended: return to the local player at this position. */
  onDisconnected: (lastPositionSec: number) => void;
  onProgress: (positionSec: number, durationSec: number) => void;
  onPlayingChanged: (isPlaying: boolean, isBuffering: boolean) => void;
  /** Track finished naturally on the renderer. */
  onFinished: () => void;
}

export interface UpnpDevice {
  id: string;
  name: string;
  address: string;
  isTV: boolean;
}

interface UpnpStoreState {
  connected: boolean;
  deviceId: string | null;
  deviceName: string | null;
  /** Renderers found in the last search. */
  devices: UpnpDevice[];
  scanning: boolean;
}

export const useUpnp = create<UpnpStoreState>(() => ({
  connected: false,
  deviceId: null,
  deviceName: null,
  devices: [],
  scanning: false,
}));

interface NativeState {
  playbackState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'STOPPED' | 'BUFFERING' | 'ERROR';
  positionMs: number;
  durationMs: number;
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

export function isUpnpConnected(): boolean {
  return useUpnp.getState().connected;
}

/** Registers player events. Call only once (from the player). */
export function initUpnp(ev: RemoteEvents): void {
  events = ev;
}

function onNativeState(e: NativeState) {
  if (!isUpnpConnected()) return;
  const pos = (e.positionMs ?? 0) / 1000;
  const dur = (e.durationMs ?? 0) / 1000;
  if (pos > 0) lastPositionSec = pos;
  if (dur > 0) lastDurationSec = dur;
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
 * Searches for renderers on the network (~5 s) and merges them into the list.
 *
 * SSDP discovery runs over UDP and is lossy: a device that didn't answer this
 * round would vanish if we replaced the list, then reappear on the next scan
 * (the flakiness users report). So we MERGE by id and keep everything seen this
 * session; a re-answer refreshes the entry. Truly-gone devices just fail to
 * connect (handled gracefully). Use `upnpClearDevices` to start a fresh list.
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
    const found = (await native.search(5000)) as UpnpDevice[];
    useUpnp.setState((s) => {
      const byId = new Map(s.devices.map((d) => [d.id, d]));
      for (const d of found) byId.set(d.id, d);
      return { devices: dedupeDevices(Array.from(byId.values())) };
    });
  } catch {
    // keep the previous list
  } finally {
    useUpnp.setState({ scanning: false });
  }
}

export async function upnpConnect(device: UpnpDevice): Promise<boolean> {
  if (!native) return false;
  const ok = (await native.connect(device.id)) as boolean;
  if (!ok) return false;
  lastPositionSec = 0;
  lastDurationSec = 0;
  finishedFired = false;
  wasPlaying = false;
  pausedByUs = false;
  stateSub?.remove();
  stateSub = native.addListener('state', onNativeState);
  useUpnp.setState({ connected: true, deviceId: device.id, deviceName: device.name });
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
  useUpnp.setState({ connected: false, deviceId: null, deviceName: null });
  try {
    await native?.disconnect();
  } catch {
    // ignore
  }
  if (!silent) events?.onDisconnected(lastPositionSec);
}

/** Bitrate for the MP3 fallback below when streaming at original quality: a
 *  lossless track has no bitrate to inherit, and 320 is as good as MP3 gets. */
const CAST_MP3_BITRATE = 320;

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
export async function upnpLoad(song: Song, autoplay: boolean, startTimeSec = 0): Promise<boolean> {
  if (!native || !isUpnpConnected()) return false;
  const auth = useAuthStore.getState().auth;
  let url: string | undefined;
  if (song.url) url = song.url;
  // The Wi-Fi settings on purpose, quality and codec both: casting over UPnP
  // means being on the same network as the renderer.
  else if (!song.localUri && auth) {
    const st = useSettings.getState();
    url = streamUrl(auth, song.id, st.maxBitRate, 0, st.streamFormat);
  }
  if (!url) return false;
  // Fallback for renderers that turn the original down (see below); only makes
  // sense for songs the server streams.
  const s = useSettings.getState();
  const mp3Url =
    auth && !song.url && !song.localUri
      ? streamUrl(auth, song.id, s.maxBitRate > 0 ? s.maxBitRate : CAST_MP3_BITRATE, 0, 'mp3')
      : undefined;
  loading = true;
  finishedFired = false;
  wasPlaying = false;
  pausedByUs = false;
  lastPositionSec = startTimeSec;
  lastDurationSec = song.duration ?? 0;
  // Two of them: the one line the fallback path can show, and the fields for
  // the metadata we send ourselves, where each has its own place.
  const oneLine = [song.title, song.artist].filter(Boolean).join(' — ');
  const info = {
    title: song.title,
    artist: song.artist ?? undefined,
    album: song.album ?? undefined,
    // The renderer gets the same picture the lock screen gets, as long as it is
    // an address it can reach: a downloaded cover lives on this phone only.
    artworkUrl: coverArtUrl(song.coverArt ?? (song.url ? undefined : song.albumId), 500),
    durationSec: song.duration ?? 0,
  };
  try {
    let ok = (await native.load(url, oneLine, startTimeSec * 1000, {
      ...info,
      // Original quality: the file arrives as it is, unless the server was
      // asked for something else.
      mime: castMime(song, s.maxBitRate > 0 ? s.streamFormat : undefined),
    })) as boolean;
    // A renderer that won't take the format says so, and the answer to that is
    // to ask the server for the one nothing refuses. Only after being turned
    // down: the ones that do take FLAC keep getting it.
    if (!ok && mp3Url && mp3Url !== url) {
      ok = (await native.load(mp3Url, oneLine, startTimeSec * 1000, {
        ...info,
        mime: 'audio/mpeg',
      })) as boolean;
    }
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
