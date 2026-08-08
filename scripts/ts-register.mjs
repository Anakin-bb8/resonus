/**
 * Installs `ts-resolve` for a script run with `node --import`.
 *
 * A hook has to be registered before the script it applies to is loaded, so
 * the registration is its own module rather than something the script does.
 * `registerHooks` rather than `register`: the latter is deprecated, and it ran
 * the hook on a worker thread, which this has no use for.
 */
import { registerHooks } from 'node:module';

import { resolve } from './ts-resolve.mjs';

registerHooks({ resolve });
