/**
 * Minimal Navidrome native API client (non-Subsonic). Only used for what
 * the Subsonic API doesn't cover: custom cover art for playlists (≥ 0.61) and
 * for radio stations. Requires cleartext username and password to obtain
 * a JWT (`auth.ndPassword`); see SubsonicAuth.
 */
import { type SubsonicAuth } from './subsonic';

/** Typed error to provide useful messages in the UI. */
export class NavidromeError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'forbidden' | 'unsupported' | 'other',
  ) {
    super(message);
  }
}

/** Logs into the native API and returns the JWT. */
async function ndLogin(auth: SubsonicAuth): Promise<string> {
  if (!auth.ndPassword) throw new NavidromeError('Sin contraseña guardada', 'auth');
  let res: Response;
  try {
    res = await fetch(`${auth.serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: auth.username, password: auth.ndPassword }),
    });
  } catch {
    throw new NavidromeError('No se pudo conectar con el servidor', 'other');
  }
  if (res.status === 401) throw new NavidromeError('Credenciales incorrectas', 'auth');
  if (!res.ok) throw new NavidromeError(`Error de red (${res.status})`, 'other');
  const json = (await res.json()) as { token?: string };
  if (!json.token) throw new NavidromeError('Respuesta inesperada del servidor', 'other');
  return json.token;
}

/** Authenticated request to the native API, with errors mapped to NavidromeError. */
async function ndFetch(auth: SubsonicAuth, path: string, init: RequestInit): Promise<void> {
  const token = await ndLogin(auth);
  let res: Response;
  try {
    res = await fetch(`${auth.serverUrl}${path}`, {
      ...init,
      headers: { ...init.headers, 'x-nd-authorization': `Bearer ${token}` },
    });
  } catch {
    throw new NavidromeError('No se pudo conectar con el servidor', 'other');
  }
  if (res.ok) return;
  if (res.status === 401) throw new NavidromeError('Credenciales incorrectas', 'auth');
  if (res.status === 403) throw new NavidromeError('Subida de carátulas deshabilitada', 'forbidden');
  if (res.status === 404 || res.status === 405) {
    throw new NavidromeError('El servidor no soporta carátulas', 'unsupported');
  }
  throw new NavidromeError(`Error del servidor (${res.status})`, 'other');
}

/** What the image belongs to; both live under the same native API shape. */
export type CoverKind = 'playlist' | 'radio';

/**
 * Uploads a local image as the cover art of a playlist or a radio station.
 * Endpoint: POST /api/{kind}/{id}/image, multipart with "image" field
 * (jpeg/png/gif/webp). 403 if upload is disabled or the item doesn't belong
 * to the user; 404 on servers too old for it.
 */
export async function uploadCoverImage(
  auth: SubsonicAuth,
  kind: CoverKind,
  id: string,
  image: { uri: string; name: string; type: string },
): Promise<void> {
  const form = new FormData();
  // RN supports local files in FormData with {uri, name, type}.
  form.append('image', image as unknown as Blob);
  await ndFetch(auth, `/api/${kind}/${encodeURIComponent(id)}/image`, {
    method: 'POST',
    body: form,
  });
}

/** Removes the custom cover art; Navidrome falls back to its own default. */
export async function deleteCoverImage(
  auth: SubsonicAuth,
  kind: CoverKind,
  id: string,
): Promise<void> {
  await ndFetch(auth, `/api/${kind}/${encodeURIComponent(id)}/image`, {
    method: 'DELETE',
  });
}
