// Load this checkout's adapters with the shared OpenCLI engine. Worktree changes
// must not silently execute the primary checkout's linked adapter instead.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bridgePaths from './bridge-paths.cjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const runtimeDir = path.dirname(bridgePaths.openCliEntry(root));
const load = name => import(pathToFileURL(path.join(runtimeDir, name)).href);
const { installNodeNetwork } = await load('node-network.js');
installNodeNetwork();
for (const name of ['ask', 'status', 'model', 'models', 'new', 'read']) {
    await import(`../opencli-adapter/${name}.js`);
}
const { runCli } = await load('cli.js');
runCli(path.join(root, 'opencli-adapter'), path.join(root, 'opencli-adapter'));
