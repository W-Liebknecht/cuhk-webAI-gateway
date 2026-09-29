// Stable entry point for agents. It reads the shared UI configuration and
// either delegates to CUHK AI or tells the caller to solve locally.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIG_URL = new URL('../config.json', import.meta.url);
const MODEL_THINKING = {
    'glm5.3flash': ['low', 'high', 'max'],
    'glm5.3': [],
    'gpt5.6sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    'gpt6sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    'gpt6luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    'deepseek-v4.1-flash': ['none', 'high', 'max'],
    'kimi-k3': ['low', 'high', 'max'],
    'seed2.1pro': ['none', 'high'],
    'gemini3.8flash': ['low', 'high'],
    'qwen3.8-27b': ['none', 'low', 'medium', 'xhigh'],
};

function loadConfig() {
    const config = JSON.parse(readFileSync(CONFIG_URL, 'utf8'));
    const consultationEnabled = typeof config.consultationEnabled === 'boolean'
        ? config.consultationEnabled
        : config.enabled;
    if (typeof consultationEnabled !== 'boolean') {
        throw new Error('config.consultationEnabled must be a boolean');
    }
    if (!Object.hasOwn(MODEL_THINKING, config.model)) throw new Error(`Unsupported config.model: ${config.model}`);
    const levels = MODEL_THINKING[config.model];
    if (levels.length === 0) config.thinking = null;
    else if (!levels.includes(config.thinking)) throw new Error(`Unsupported thinking level for ${config.model}: ${config.thinking}`);
    return { ...config, consultationEnabled };
}

let config;
try {
    config = loadConfig();
} catch (error) {
    console.error(JSON.stringify({ ok: false, error: `Invalid CUHK AI config: ${error.message}` }, null, 2));
    process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes('--show-config')) {
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
}

if (!config.consultationEnabled) {
    console.log(JSON.stringify({
        ok: true,
        mode: 'local',
        consultationEnabled: false,
        instruction: 'CUHK web AI consultation is disabled in the local control panel. Do not call it; solve the request with the current agent.',
    }, null, 2));
    process.exit(0);
}

const fileIndex = args.indexOf('--prompt-file');
if (fileIndex < 0 || !args[fileIndex + 1]) {
    console.error('Usage: node cuhk-ai-agent.mjs --prompt-file <UTF-8 file> [--new false] [--timeout 180]');
    process.exit(2);
}

const forwarded = [...args, '--model', config.model];
if (config.thinking) forwarded.push('--thinking', config.thinking);
const child = spawn(process.execPath, [
    fileURLToPath(new URL('./cuhk-ai.mjs', import.meta.url)),
    ...forwarded,
], { stdio: 'inherit', shell: false });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
