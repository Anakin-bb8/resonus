/**
 * The pinned metadata of the karaoke voice models, kept apart from the download
 * so the list can be read (and tested) without the file system.
 *
 * These are the files behind Taurus's Sing: KimberleyJensen's Mel-Band RoFormer
 * exported for the Neural Engine (the full model) and HiDolen's
 * Mini-BS-RoFormer-18M (the light one), published by Vitrine on Hugging Face as
 * Core ML `.mlmodelc` bundles. They are Apple-only. Every file is pinned by its
 * byte size and its SHA-256, so a download is kept only if both match.
 */

/** Which of the two published models is selected. */
export type SingModelKind = 'full' | 'light';

/** One file of a model: where it sits in the bundle, and what it must hash to. */
export interface SingFile {
  /** Path inside the `.mlmodelc` bundle. */
  path: string;
  size: number;
  sha256: string;
}

export interface SingDescriptor {
  /** Folder at the model's Hugging Face repository. */
  repoFolder: string;
  /** Folder name once installed under the app's `sing` directory. */
  installedFolder: string;
  files: SingFile[];
}

/** Where the model files are fetched from. */
export const SING_MODEL_BASE_URL =
  'https://huggingface.co/My-Name-Is-Jeff/vitrine-sing/resolve/main/';

const FULL_FILES: SingFile[] = [
  { path: 'metadata.json', size: 2333, sha256: '101714d1a37ad29c70bf1705ec25ec99584c3cbce27f2245858ace06dacbfb44' },
  { path: 'coremldata.bin', size: 388, sha256: 'bcfd38a8b121681dfb9fdfe6f9d88ffb29068e0dd6d24d4012f4c3a7bdcbc81b' },
  { path: 'analytics/coremldata.bin', size: 243, sha256: '55f78aab64f5b1250ce4d6016dff23aee43fb97feb77bbceab4e36b3d9ccffb3' },
  { path: 'model.mil', size: 1346642, sha256: '957024c1075fe331f7ca3410b8bf5e2f83a58c61763caf154729829ce0a92d08' },
  { path: 'weights/weight.bin', size: 209077208, sha256: 'bb4a0effafb5121b9aaa5ea96371fa14d0d8dc30a5ae44a93e0c15a2f4077635' },
];

const LIGHT_FILES: SingFile[] = [
  { path: 'metadata.json', size: 2383, sha256: '757200c870bd4c5e5b70130c9edbd60029bd81c779b504c57ddcd624597f30e9' },
  { path: 'coremldata.bin', size: 484, sha256: 'e533e0c22c3f185e5b8871d2b897111e64420736daa7dc7c239206ca2519d428' },
  { path: 'analytics/coremldata.bin', size: 243, sha256: '205b1d1d16603c69b4abdfa54b29df71164a16ca4f16a1cf436e7e33ce0b1407' },
  { path: 'model.mil', size: 715945, sha256: 'd3b62a7972344d1a8eec5de8a21130a19272738bce1135871d8bab098585a841' },
  { path: 'weights/weight.bin', size: 30040968, sha256: 'ad460549f68898eab7fe946e9675efaa2551d37b93f73796958c73d4881897fc' },
];

export const SING_MODELS: Record<SingModelKind, SingDescriptor> = {
  full: { repoFolder: 'separator-ane.mlmodelc', installedFolder: 'separator.mlmodelc', files: FULL_FILES },
  light: { repoFolder: 'separator-light.mlmodelc', installedFolder: 'separator-light.mlmodelc', files: LIGHT_FILES },
};

/** Bytes the selected model needs on disk. */
export function singModelTotalBytes(kind: SingModelKind): number {
  return SING_MODELS[kind].files.reduce((sum, f) => sum + f.size, 0);
}

/** Rounded the way the settings row shows it: "210 MB", "31 MB". Integer
 *  division, matching the Taurus tweak's own label, not a rounded number. */
export function singModelSizeLabel(kind: SingModelKind): string {
  return `${Math.floor((singModelTotalBytes(kind) + 500_000) / 1_000_000)} MB`;
}
