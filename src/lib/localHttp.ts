/**
 * The phone as a source a renderer can fetch from (native module
 * `modules/local-http`).
 *
 * A UPnP renderer is not sent audio, it is sent a URL and goes and gets it. A
 * song on a server has one; a song on the phone is a `content://` nothing else
 * on the network can open, which is the whole reason casting the phone's own
 * music did nothing. This publishes the files under short keys and hands back
 * URLs pointing at this phone.
 *
 * Only up while casting. Keys are the app's, not the ids: a local song's id is
 * its own file URI, and putting that in a URL would be handing the network the
 * layout of somebody's storage.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule('LocalHttp');

export const localHttpAvailable = !!native;

/** Where the server can be reached, while it is up. */
let origin: string | null = null;
/** file URI → the key it is published under, so republishing is stable. */
const keys = new Map<string, string>();
let nextKey = 1;

function keyFor(uri: string): string {
  const known = keys.get(uri);
  if (known) return known;
  const key = `${nextKey++}${Math.random().toString(36).slice(2, 8)}`;
  keys.set(uri, key);
  return key;
}

/**
 * Starts the server if needed and publishes these files, answering whether
 * there is somewhere to fetch them from. False when there is no native module
 * (another platform, an older build) or no address on the network.
 */
export async function publishLocalFiles(
  files: { uri: string; mime: string }[],
): Promise<boolean> {
  if (!native || files.length === 0) return false;
  try {
    // Idempotent on the native side: an already started server answers where it
    // already is.
    origin = ((await native.start()) as string | null) ?? null;
    if (!origin) return false;
    native.setEntries(
      JSON.stringify(files.map((f) => ({ key: keyFor(f.uri), uri: f.uri, mime: f.mime }))),
    );
    return true;
  } catch {
    origin = null;
    return false;
  }
}

/** The URL for a file already published, or undefined if it is not. */
export function localFileUrl(uri: string | undefined): string | undefined {
  if (!uri || !origin) return undefined;
  const key = keys.get(uri);
  return key ? `${origin}/${key}` : undefined;
}

/** Closes the port and forgets the keys. Called when the cast ends. */
export async function stopLocalHttp(): Promise<void> {
  if (!native) return;
  origin = null;
  keys.clear();
  try {
    await native.stop();
  } catch {
    // Nothing to do about it: the session is over either way.
  }
}
