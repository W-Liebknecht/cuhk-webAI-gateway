// The adapter lives outside the OpenCLI checkout, so package self-references
// such as "@jackwener/opencli/registry" cannot resolve from this real path.
// Keep the coupling explicit and limited to this compatibility module.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import bridgePaths from '../bin/bridge-paths.cjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const runtimeDir = path.dirname(bridgePaths.openCliEntry(root));
const requireRuntime = createRequire(bridgePaths.openCliEntry(root));
export const TurndownService = requireRuntime('turndown');
export const { gfm } = requireRuntime('turndown-plugin-gfm');
const registry = await import(pathToFileURL(path.join(runtimeDir, 'registry-api.js')).href);
const errors = await import(pathToFileURL(path.join(runtimeDir, 'errors.js')).href);
export const { cli, Strategy } = registry;
export const { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } = errors;
