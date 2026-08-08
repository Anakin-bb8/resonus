/**
 * Lets Node import the app's TypeScript the way the app writes it.
 *
 * Metro resolves `./thing` to `./thing.ts` and `@/lib/thing` to
 * `src/lib/thing.ts`; Node's ESM loader does neither. Without this a module
 * could only be checked from a script if it happened to import nothing but
 * types, which is a rule nobody would remember and the wrong reason to shape
 * production code.
 *
 * Resolution only. Node 22.18 and up strip the types themselves.
 *
 * Synchronous because `registerHooks` runs it in the loading thread rather
 * than off on a worker.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    return next(pathToFileURL(path.join(SRC, `${specifier.slice(2)}.ts`)).href, context);
  }
  // A relative import with no extension: the app's own style.
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return next(`${specifier}.ts`, context);
    } catch {
      // Not a TypeScript module after all; let Node report its own error.
    }
  }
  return next(specifier, context);
}
