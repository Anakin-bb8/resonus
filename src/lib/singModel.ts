/**
 * Downloading and installing the karaoke voice models.
 *
 * The models are large and never ship with the app, so every file is pinned by
 * its byte size and its SHA-256 and only kept if it matches both: nothing the
 * server says about a file is trusted. The files are downloaded one by one into
 * a staging folder and only become the installed model once all of them are in,
 * so a cancelled download leaves nothing half-installed. The metadata itself
 * lives in `singModels.ts` (no file system there, so it can be tested).
 */
import { Directory, File, Paths } from 'expo-file-system';

import {
  SING_MODELS,
  SING_MODEL_BASE_URL,
  singModelTotalBytes,
  type SingFile,
  type SingModelKind,
} from './singModels';
import { vocalSeparator } from './vocalSeparator';

export type { SingModelKind } from './singModels';

/** Where every installed model lives, next to the rest of the app's data. */
function modelsDir(): Directory {
  return new Directory(Paths.document, 'sing');
}

/** The installed bundle for one model. */
function installedDir(kind: SingModelKind): Directory {
  return new Directory(modelsDir(), SING_MODELS[kind].installedFolder);
}

/** Where a download is assembled before it becomes the installed model. */
function stagingDir(kind: SingModelKind): Directory {
  return new Directory(modelsDir(), `download-${kind}`);
}

function fileFor(base: Directory, field: string): File {
  return new File(base, field);
}

/** A file is right only if its size and its hash both match, in that order. */
function fileMatches(file: File, spec: SingFile): boolean {
  if (!file.exists || file.size !== spec.size) return false;
  // Hashing 200 MB has to happen natively; without the module the model cannot
  // be verified and so cannot be trusted.
  if (!vocalSeparator) return false;
  try {
    return vocalSeparator.sha256(file.uri).toLowerCase() === spec.sha256;
  } catch {
    return false;
  }
}

/** Every file of the model is installed and correct. */
export function isModelInstalled(kind: SingModelKind): boolean {
  const dir = installedDir(kind);
  if (!dir.exists) return false;
  return SING_MODELS[kind].files.every((spec) => fileMatches(fileFor(dir, spec.path), spec));
}

/** The installed bundle's folder, or null when it is not there or incomplete. */
export function installedModelPath(kind: SingModelKind): string | null {
  return isModelInstalled(kind) ? installedDir(kind).uri : null;
}

/** How much of the selected model is on disk, for a progress bar. */
export function modelReceivedBytes(kind: SingModelKind): number {
  const dir = stagingDir(kind);
  const installed = installedDir(kind);
  let total = 0;
  for (const spec of SING_MODELS[kind].files) {
    if (fileMatches(fileFor(installed, spec.path), spec)) {
      total += spec.size;
      continue;
    }
    const partial = fileFor(dir, spec.path);
    if (partial.exists && partial.size !== null) total += Math.min(partial.size, spec.size);
  }
  return total;
}

export interface DownloadModelOptions {
  /** Receives the fraction (0–1) as the files arrive. */
  onProgress?: (fraction: number) => void;
  /** Stops the download; already-downloaded files are kept for a resume. */
  signal?: AbortSignal;
}

/**
 * Downloads the model's files one by one, verifying each before keeping it, and
 * only then moves the staging folder into place. A file already present and
 * correct is skipped, so a restart continues where it stopped.
 */
export async function downloadModel(kind: SingModelKind, options: DownloadModelOptions = {}): Promise<void> {
  if (!vocalSeparator) throw new Error('Vocal removal is not available on this build.');
  const model = SING_MODELS[kind];
  const staging = stagingDir(kind);
  staging.create({ intermediates: true, idempotent: true });
  const total = singModelTotalBytes(kind);

  for (const spec of model.files) {
    const target = fileFor(staging, spec.path);
    if (fileMatches(target, spec)) {
      options.onProgress?.(Math.min(1, modelReceivedBytes(kind) / total));
      continue;
    }
    // The file's folder (e.g. `weights/`, `analytics/`) may not exist yet.
    target.parentDirectory.create({ intermediates: true, idempotent: true });
    // A wrong or partial file from an earlier run is replaced from scratch.
    if (target.exists) target.delete();
    await File.downloadFileAsync(`${SING_MODEL_BASE_URL}${model.repoFolder}/${spec.path}`, target, {
      idempotent: true,
      signal: options.signal,
      onProgress: () => options.onProgress?.(Math.min(1, modelReceivedBytes(kind) / total)),
    });
    if (!fileMatches(target, spec)) {
      target.delete();
      throw new Error('A downloaded file did not match the voice model and was not kept.');
    }
  }

  // Every file is in and correct: the staging folder becomes the installed
  // bundle in one move, so a half-downloaded model is never loadable.
  const installed = installedDir(kind);
  if (installed.exists) installed.delete();
  staging.move(installed);
  options.onProgress?.(1);
}

/** Deletes the installed model and anything a download left behind. */
export function removeModel(kind: SingModelKind): void {
  try {
    const installed = installedDir(kind);
    if (installed.exists) installed.delete();
  } catch {
    // Already gone: nothing to remove.
  }
  clearStaging(kind);
}

/**
 * Deletes the half-downloaded files of a model. The installed bundle is left
 * alone: cancelling a download is not the same as removing what is installed.
 */
export function clearStaging(kind: SingModelKind): void {
  try {
    const staging = stagingDir(kind);
    if (staging.exists) staging.delete();
  } catch {
    // Nothing to clear.
  }
}
