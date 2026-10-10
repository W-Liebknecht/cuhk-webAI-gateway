// File-based entry point for agents: keeps large prompts out of the Windows
// command line all the way through the OpenCLI adapter.
import { accessSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bridgePaths from './bridge-paths.cjs';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--prompt-file');
if (fileIndex < 0 || !args[fileIndex + 1]) {
    console.error('Usage: node bin/cuhk-ai.mjs --prompt-file <UTF-8 file> [--new false] [--timeout 180]');
    process.exit(2);
}
const promptPath = args[fileIndex + 1];
try { accessSync(promptPath); }
catch (error) { console.error(error.message); process.exit(2); }
const openCliEntry = bridgePaths.openCliEntry(fileURLToPath(new URL('..', import.meta.url)));
try { accessSync(openCliEntry); }
catch (error) { console.error(`OpenCLI entry is unavailable: ${error.message}`); process.exit(2); }
const child = spawn(process.execPath, [fileURLToPath(new URL('./cuhk-opencli.mjs', import.meta.url)),
    'cuhk-ai', 'ask', ...args, '--format', 'json'], { stdio: 'inherit', shell: false });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
