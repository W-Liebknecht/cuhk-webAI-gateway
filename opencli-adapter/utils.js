import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TurndownService, gfm } from './_opencli.js';
import fs from 'node:fs';
import path from 'node:path';

const markdown = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx' });
markdown.use(gfm);
markdown.remove(['button', 'svg']);
// Preserve code literally, including nested Markdown fences. A fixed three-tick
// fence can prematurely close when the output itself contains fenced examples.
markdown.addRule('literalPre', {
    filter: 'pre',
    replacement: (_content, node) => {
        const code = node.querySelector('code');
        const text = (code || node).textContent || '';
        const runs = text.match(/`+/g) || [];
        const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
        const language = /(?:^|\s)language-([\w+-]+)/.exec(code?.getAttribute('class') || '')?.[1] || '';
        return '\n\n' + fence + language + '\n' + text.replace(/\n$/, '') + '\n' + fence + '\n\n';
    },
});
// UI_SELECTOR / visible-ui: use only the completed assistant body. Extract a
// standalone protocol before Markdown serialization; examples remain Markdown.
export function extractProtocolText(turn) {
    const bodies = Array.from(turn.querySelectorAll('.prose-code-custom'));
    if (!bodies.length || bodies.some(body => body.querySelector('pre, code, blockquote'))) return null;
    const text = bodies.map(body => body.textContent || '').join('\n').trim();
    const match = /^<tool_call>\s*([\s\S]*?)\s*<\/tool_call>$/u.exec(text);
    if (!match) return null;
    // JSON parsing excludes multiple envelopes without rewriting any bytes.
    try { JSON.parse(match[1]); } catch { return null; }
    return text;
}
export function serializeBody(body) {
    const clone = body.cloneNode(true);
    for (const block of clone.querySelectorAll('[data-block="true"]')) {
        const code = block.querySelector('code');
        if (!code) continue;
        const pre = document.createElement('pre');
        pre.appendChild(code.cloneNode(true));
        const wrapper = block.parentElement;
        if (wrapper?.classList.contains('relative') && wrapper.querySelector('button')) wrapper.replaceWith(pre);
        else block.replaceWith(pre);
    }
    clone.querySelectorAll('button, svg').forEach((node) => node.remove());
    return clone.innerHTML;
}
// Streamdown renders the code language and copy action outside <pre>.
markdown.addRule('streamdownCode', {
    filter: (node) => node.hasAttribute?.('data-streamdown') && node.getAttribute('data-streamdown') === 'code-block',
    replacement: (content, node) => {
        // Child <pre> has already been converted by literalPre. Re-wrapping it
        // loses language information and corrupts nested fences.
        return content;
    },
});

export const CUHK_AI_DOMAIN = 'ai.cuhk.edu.cn';
export const CUHK_AI_URL = 'https://ai.cuhk.edu.cn/chat/';
export const COMPOSER_SELECTOR = '[data-testid="chat-input"]';
export const SEND_BUTTON_SELECTOR = '[data-testid="chat-send-button"]';
export const USER_TURN_SELECTOR = '[data-turn="user"]';
const STOP_BUTTON_SELECTOR = '[data-testid="chat-stop-button"], [data-testid="chat-send-button"][aria-label="停止生成"], [data-testid="chat-send-button"][aria-label="Stop generating"]';
export const AI_TURN_SELECTOR = '[data-turn="ai"]';

export async function getContextUsage(page) {
    return page.evaluate(`(() => {
        const body = document.querySelector('[data-testid="chat-input-body"]');
        if (!body) return null;
        const ring = body.querySelector('circle[stroke-dasharray]');
        const label = ring?.parentElement?.parentElement?.getAttribute('aria-label') || '';
        const labelMatch = /(?:^|\\s|:)\\s*(\\d+(?:\\.\\d+)?)\\s*%/u.exec(label);
        let usedPercent = labelMatch ? Number(labelMatch[1]) : NaN;
        if (!Number.isFinite(usedPercent) && ring) {
            const values = String(ring.getAttribute('stroke-dasharray') || '')
                .trim().split(/[ ,]+/u).map(Number);
            if (values.length >= 2 && values.every(Number.isFinite) && values[0] >= 0 && values[1] > 0) {
                usedPercent = values[0] / values[1] * 100;
            }
        }
        if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
        const roundedUsed = Math.round(usedPercent * 10) / 10;
        const truncated = /截断|truncated/iu.test(body.innerText || '');
        return {
            usedPercent: roundedUsed,
            remainingPercent: Math.round((100 - roundedUsed) * 10) / 10,
            truncated,
        };
    })()`);
}

export const MODEL_DEFINITIONS = [
    { alias: 'glm5.3flash', display: 'GLM 5.3 Flash（本地版）', thinking: ['low', 'high', 'max'] },
    { alias: 'glm5.3', display: 'GLM 5.3', thinking: [] },
    { alias: 'gpt5.6sol', display: 'GPT 5.6 Sol', thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { alias: 'gpt6sol', display: 'GPT 6 Sol', thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { alias: 'gpt6luna', display: 'GPT 6 Luna', thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
    { alias: 'deepseek-v4.1-flash', display: 'DeepSeek V4.1 Flash', thinking: ['none', 'high', 'max'] },
    { alias: 'kimi-k3', display: 'Kimi K3', thinking: ['low', 'high', 'max'] },
    { alias: 'seed2.1pro', display: '豆包 Seed 2.1 Pro', thinking: ['none', 'high'] },
    { alias: 'gemini3.8flash', display: 'Gemini 3.8 Flash', thinking: ['low', 'high'] },
    { alias: 'qwen3.8-27b', display: 'Qwen3.8 27B（本地版）', thinking: ['none', 'low', 'medium', 'xhigh'] },
];

const THINKING_LABELS = {
    none: '不思考',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
    max: '极致',
};

function normalizeName(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[\s_.\-（）()]/g, '');
}

export function resolveModel(value) {
    const key = normalizeName(value);
    const model = MODEL_DEFINITIONS.find((item) =>
        normalizeName(item.alias) === key || normalizeName(item.display) === key);
    if (!model) {
        throw new ArgumentError(
            `Unsupported CUHK AI model: ${value}`,
            `Supported models: ${MODEL_DEFINITIONS.map((item) => item.alias).join(', ')}`,
        );
    }
    return model;
}

export function resolveThinking(value, model) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const raw = String(value).trim().toLowerCase();
    const aliases = {
        none: 'none', off: 'none', false: 'none', '不思考': 'none',
        low: 'low', '低': 'low',
        medium: 'medium', med: 'medium', '中': 'medium',
        high: 'high', '高': 'high', '思考': 'high',
        xhigh: 'xhigh', extreme: 'xhigh', '极高': 'xhigh', '超高': 'xhigh',
        max: 'max', strong: 'max', '强力': 'max', '极致': 'max',
    };
    const thinking = aliases[raw];
    if (!thinking || !model.thinking.includes(thinking)) {
        const supported = model.thinking.length ? model.thinking.join(', ') : 'none (this model has no thinking selector)';
        throw new ArgumentError(
            `Thinking level "${value}" is not available for ${model.alias}`,
            `Supported thinking levels: ${supported}`,
        );
    }
    return { name: thinking, label: THINKING_LABELS[thinking] };
}

export async function getCurrentModel(page) {
    return page.evaluate((names) => {
        const button = Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]'))
            .find((candidate) => names.includes(candidate.getAttribute('aria-label')));
        return button?.getAttribute('aria-label') || '';
    }, MODEL_DEFINITIONS.map((item) => item.display));
}

async function openModelDialog(page) {
    const alreadyOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"] button[id^="model-option-"]'));
    if (alreadyOpen) return;
    const opened = await page.evaluate((names) => {
        const button = Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]'))
            .find((candidate) => names.includes(candidate.getAttribute('aria-label')));
        if (!button) return false;
        button.click();
        return true;
    }, MODEL_DEFINITIONS.map((item) => item.display));
    if (!opened) throw new CommandExecutionError('CUHK AI model selector was not found.');
    try {
        await page.wait({ selector: '[role="dialog"] button[id^="model-option-"]', timeout: 5 });
    } catch {
        throw new CommandExecutionError('CUHK AI model dialog did not open.');
    }
}

async function closeModelDialog(page) {
    await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const close = dialog && Array.from(dialog.querySelectorAll('button'))
            .find((button) => /^(关闭|Close)$/i.test(button.getAttribute('aria-label') || ''));
        close?.click();
    });
}

export async function selectModel(page, value) {
    const model = resolveModel(value);
    if (await getCurrentModel(page) === model.display) return model;
    await openModelDialog(page);
    const result = await page.evaluate((display) => {
        const options = Array.from(document.querySelectorAll('[role="dialog"] button[id^="model-option-"]'));
        const target = options.find((button) => (button.innerText || '').split('\n')[0].trim() === display);
        if (!target) return { ok: false, available: options.map((button) => (button.innerText || '').split('\n')[0].trim()) };
        if (target.disabled) return { ok: false, disabled: true };
        target.click();
        return { ok: true };
    }, model.display);
    if (!result?.ok) {
        await closeModelDialog(page);
        throw new CommandExecutionError(result?.disabled
            ? `${model.display} is disabled for this account.`
            : `${model.display} was not found in the model dialog.`);
    }
    try {
        await page.wait({ selector: `button[aria-label=${JSON.stringify(model.display)}]`, timeout: 5 });
    } catch {
        throw new CommandExecutionError(`Model selection for ${model.display} could not be confirmed; inspect the open page before retrying.`);
    }
    return model;
}

export async function setThinking(page, model, value) {
    const thinking = resolveThinking(value, model);
    if (!thinking) return null;
    if (await getCurrentModel(page) !== model.display) {
        throw new CommandExecutionError(`Select ${model.display} before changing its thinking level.`);
    }
    await openModelDialog(page);
    const control = await page.evaluate((display) => {
        const dialog = document.querySelector('[role="dialog"]');
        const box = dialog && Array.from(dialog.querySelectorAll('[role="combobox"]'))
            .find((candidate) => (candidate.getAttribute('aria-label') || '').includes(display));
        if (!box) return { ok: false };
        return { ok: true };
    }, model.display);
    if (!control?.ok) {
        await closeModelDialog(page);
        throw new CommandExecutionError(`${model.display} does not expose a thinking selector on the current page.`);
    }
    // Select/combobox components may open on pointer events. DOM .click() can
    // report success without expanding them, so use OpenCLI's browser click,
    // which performs a hit-tested CDP click before falling back to DOM click.
    const triggerToken = `thinking-trigger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const markedTrigger = await page.evaluate((input) => {
        const dialog = document.querySelector('[role="dialog"]');
        const box = dialog && Array.from(dialog.querySelectorAll('[role="combobox"]'))
            .find((candidate) => (candidate.getAttribute('aria-label') || '').includes(input.display));
        if (!box) return false;
        box.setAttribute('data-cuhk-thinking-trigger', input.token);
        return true;
    }, { display: model.display, token: triggerToken });
    if (!markedTrigger) {
        await closeModelDialog(page);
        throw new CommandExecutionError(`${model.display} thinking selector disappeared before it could be opened.`);
    }
    try {
        await page.click(`[data-cuhk-thinking-trigger=${JSON.stringify(triggerToken)}]`);
    } catch {
        await page.evaluate((token) => {
            document.querySelector(`[data-cuhk-thinking-trigger=${JSON.stringify(token)}]`)
                ?.removeAttribute('data-cuhk-thinking-trigger');
        }, triggerToken).catch(() => {});
        await closeModelDialog(page);
        throw new CommandExecutionError(`Thinking options for ${model.display} could not be opened.`);
    }
    await page.evaluate((token) => {
        const box = document.querySelector(`[data-cuhk-thinking-trigger=${JSON.stringify(token)}]`);
        // Some persistent background tabs acknowledge CDP input without
        // delivering the key/pointer event to this React select. Its documented
        // keyboard interaction still works through a bubbling DOM key event.
        // Only open a closed menu: never toggle one that the click already opened.
        if (box && box.getAttribute('aria-expanded') !== 'true') {
            box.focus();
            box.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
        }
        document.querySelector(`[data-cuhk-thinking-trigger=${JSON.stringify(token)}]`)
            ?.removeAttribute('data-cuhk-thinking-trigger');
    }, triggerToken).catch(() => {});
    try {
        await page.wait({ selector: '[role="option"]', timeout: 3 });
    } catch {
        await closeModelDialog(page);
        throw new CommandExecutionError(`Thinking options for ${model.display} did not open.`);
    }
    // The page localizes these labels and may rename them (for example, max
    // changed from "强力" to "极致"). The model definition is the stable
    // contract, so select the corresponding enabled option by its ordinal.
    // The live label is captured only to confirm that the click took effect.
    const targetIndex = model.thinking.indexOf(thinking.name);
    const optionToken = `thinking-option-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const selected = await page.evaluate((input) => {
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        if (options.length !== input.expectedCount) {
            return { ok: false, count: options.length, labels: options.map((option) => (option.innerText || '').trim()) };
        }
        const option = options[input.index];
        if (!option) return { ok: false, count: options.length };
        if (option.hasAttribute('disabled') || option.getAttribute('aria-disabled') === 'true' || option.hasAttribute('data-disabled')) {
            return { ok: false, count: options.length, disabled: true };
        }
        const label = (option.innerText || '').trim();
        const alreadySelected = option.getAttribute('aria-selected') === 'true'
            || option.getAttribute('data-state') === 'checked';
        if (!alreadySelected) option.setAttribute('data-cuhk-thinking-option', input.token);
        return { ok: true, label, alreadySelected };
    }, { index: targetIndex, expectedCount: model.thinking.length, display: model.display, token: optionToken });
    if (!selected?.ok) {
        if (selected?.disabled) {
            throw new CommandExecutionError(`Thinking level ${thinking.name} is disabled for ${model.display}.`);
        }
        throw new CommandExecutionError(
            `Thinking options for ${model.display} no longer match its configured levels `
            + `(expected ${model.thinking.length}, found ${selected?.count ?? 0}).`,
        );
    }
    if (!selected.alreadySelected) {
        try {
            await page.click(`[data-cuhk-thinking-option=${JSON.stringify(optionToken)}]`);
        } catch {
            await page.evaluate((token) => {
                document.querySelector(`[data-cuhk-thinking-option=${JSON.stringify(token)}]`)
                    ?.removeAttribute('data-cuhk-thinking-option');
            }, optionToken).catch(() => {});
            await closeModelDialog(page);
            throw new CommandExecutionError(`Thinking option ${thinking.name} could not be selected for ${model.display}.`);
        }
        await page.evaluate((input) => {
            const option = document.querySelector(`[data-cuhk-thinking-option=${JSON.stringify(input.token)}]`);
            const box = Array.from(document.querySelectorAll('[role="dialog"] [role="combobox"]'))
                .find(candidate => (candidate.getAttribute('aria-label') || '').includes(input.display));
            if (option && (box?.innerText || '').trim() !== input.label) {
                option.focus();
                option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            }
            document.querySelector(`[data-cuhk-thinking-option=${JSON.stringify(input.token)}]`)
                ?.removeAttribute('data-cuhk-thinking-option');
        }, { token: optionToken, display: model.display, label: selected.label }).catch(() => {});
    }
    let confirmed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
        confirmed = await page.evaluate((input) => {
            const dialog = document.querySelector('[role="dialog"]');
            const box = dialog && Array.from(dialog.querySelectorAll('[role="combobox"]'))
                .find((candidate) => (candidate.getAttribute('aria-label') || '').includes(input.display));
            return (box?.innerText || '').trim() === input.label;
        }, { display: model.display, label: selected.label });
        if (confirmed) break;
        await page.wait({ time: 0.15 });
    }
    if (!confirmed) {
        throw new CommandExecutionError(`Thinking level ${thinking.name} could not be confirmed; inspect the open page before retrying.`);
    }
    await closeModelDialog(page);
    return thinking;
}

export function requireNonEmptyPrompt(value, commandName) {
    const prompt = String(value ?? '').trim();
    if (!prompt) {
        throw new ArgumentError(
            `${commandName} prompt cannot be empty`,
            `Example: opencli ${commandName} "hello"`,
        );
    }
    return prompt;
}

export function requirePositiveInt(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    return parsed;
}

export async function getPageState(page) {
    return page.evaluate(`(() => {
        const composer = document.querySelector('${COMPOSER_SELECTOR}');
        return {
            url: window.location.href,
            title: document.title,
            hasComposer: !!composer,
            isLoggedIn: !!composer && window.location.pathname.startsWith('/chat/'),
            model: Array.from(document.querySelectorAll('button'))
                .map((button) => (button.getAttribute('aria-label') || '').trim())
                .find((label) => /Claude|GPT|Gemini|DeepSeek|Qwen|Kimi|GLM/i.test(label)) || '',
        };
    })()`);
}

export async function ensureOnCuhkAi(page) {
    const currentUrl = await page.evaluate('window.location.href').catch(() => '');
    let onSite = false;
    try {
        onSite = new URL(currentUrl).hostname === CUHK_AI_DOMAIN;
    } catch {
        onSite = false;
    }
    if (!onSite || !currentUrl.includes('/chat/')) {
        await page.goto(CUHK_AI_URL);
        try {
            await page.wait({ selector: COMPOSER_SELECTOR, timeout: 12 });
        } catch {
            // The typed check below distinguishes login from a broken chat page.
        }
    }
}

export async function ensureReady(page, message = 'CUHK AI chat is not ready.') {
    await ensureOnCuhkAi(page);
    const state = await getPageState(page);
    if (!state.isLoggedIn) {
        throw new AuthRequiredError(
            CUHK_AI_DOMAIN,
            'Open https://ai.cuhk.edu.cn in Chrome and finish the university login, then retry.',
        );
    }
    if (!state.hasComposer) throw new CommandExecutionError(message);
    return state;
}

// Navigating to /chat/ is not sufficient: the SPA may restore the previously
// active conversation. A Gateway bootstrap must start from a verified blank
// composer or it can capture another chat's URL and corrupt that conversation
// on the first continuation.
export async function startFreshConversation(page) {
    await ensureOnCuhkAi(page);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const state = await page.evaluate(`(() => ({
            url: window.location.href,
            userTurns: document.querySelectorAll('${USER_TURN_SELECTOR}').length,
            aiTurns: document.querySelectorAll('${AI_TURN_SELECTOR}').length,
            hasComposer: !!document.querySelector('${COMPOSER_SELECTOR}')
        }))()`);
        if (state?.url === CUHK_AI_URL && state.userTurns === 0 && state.aiTurns === 0 && state.hasComposer) return state;
        const clicked = await page.evaluate(`(() => {
            const labels = new Set(['新对话', 'New chat', 'New Chat']);
            const button = Array.from(document.querySelectorAll('button'))
                .find((item) => labels.has((item.textContent || '').trim()));
            if (!button) return false;
            button.click();
            return true;
        })()`);
        if (!clicked) throw new CommandExecutionError('CUHK AI new-conversation control was not found; no message was sent.');
        for (let poll = 0; poll < 40; poll += 1) {
            await page.wait(0.25);
            const ready = await page.evaluate(`(() => ({
                url: window.location.href,
                userTurns: document.querySelectorAll('${USER_TURN_SELECTOR}').length,
                aiTurns: document.querySelectorAll('${AI_TURN_SELECTOR}').length,
                hasComposer: !!document.querySelector('${COMPOSER_SELECTOR}')
            }))()`);
            if (ready?.url === CUHK_AI_URL && ready.userTurns === 0 && ready.aiTurns === 0 && ready.hasComposer) return ready;
        }
    }
    throw new CommandExecutionError('CUHK AI did not reach a verified blank conversation; no message was sent.');
}

export async function getVisibleMessages(page) {
    const rows = await page.evaluate(`(() => {
        return Array.from(document.querySelectorAll('[data-turn="user"], [data-turn="ai"]'))
            .map((turn) => {
                const role = turn.getAttribute('data-turn') === 'ai' ? 'assistant' : 'user';
                const bodies = role === 'assistant' ? Array.from(turn.querySelectorAll('.prose-code-custom')) : [turn];
                const html = bodies.map(${serializeBody.toString()}).join('');
                const protocol = role === 'assistant' ? (${extractProtocolText.toString()})(turn) : null;
                return { role, html, protocol };
            })
            .filter((row) => row.html);
    })()`);
    if (!Array.isArray(rows)) return [];
    return rows.map((row, index) => ({ index, role: row.role, text: row.protocol || markdown.turndown(row.html) }));
}

export async function getTurnCounts(page) {
    const result = await page.evaluate(`(() => ({
        user: document.querySelectorAll('${USER_TURN_SELECTOR}').length,
        ai: document.querySelectorAll('${AI_TURN_SELECTOR}').length,
    }))()`);
    return {
        user: Number(result?.user || 0),
        ai: Number(result?.ai || 0),
    };
}

export async function sendMessage(page, prompt) {
    const result = await page.evaluate((input) => {
        const composer = document.querySelector(input.composerSelector);
        if (!composer) return { ok: false, reason: 'composer not found' };

        const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!valueSetter) return { ok: false, reason: 'textarea value setter unavailable' };
        composer.focus();
        valueSetter.call(composer, input.prompt);
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: input.prompt }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
    }, { composerSelector: COMPOSER_SELECTOR, prompt });
    if (!result?.ok) return result;

    try {
        await page.wait({ selector: `${SEND_BUTTON_SELECTOR}:not([disabled])`, timeout: 5 });
    } catch {
        return { ok: false, reason: 'send button stayed disabled after filling the composer' };
    }

    return page.evaluate(`(() => {
        const button = document.querySelector('${SEND_BUTTON_SELECTOR}');
        if (!button || button.disabled) return { ok: false, reason: 'enabled send button not found' };
        button.click();
        return { ok: true };
    })()`);
}

// Best-effort cancellation for a turn that is still generating when the adapter
// gives up. Clicking the page's stop control prevents the stalled CUHK turn from
// continuing to consume quota or keeping the active browser session busy.
export async function stopActiveGeneration(page) {
    try {
        await page.evaluate(`(() => {
            const button = document.querySelector('${STOP_BUTTON_SELECTOR}');
            if (!button || button.disabled) return false;
            button.click();
            return true;
        })()`);
    } catch {
        // Stopping is best effort; the typed timeout/empty error is the contract.
    }
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif']);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function unwrapEvaluateResult(value) {
    if (value && !Array.isArray(value) && typeof value === 'object' && 'session' in value && 'data' in value) return value.data;
    return value;
}

export async function uploadImages(page, imagePaths) {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) return;
    if (imagePaths.length > 4) throw new ArgumentError('CUHK AI accepts at most 4 images per message.');
    const absolutePaths = imagePaths.map((value) => path.resolve(String(value).replace(/\\/g, path.sep)));
    for (const filePath of absolutePaths) {
        let stat;
        try { stat = fs.statSync(filePath); }
        catch { throw new ArgumentError(`Image file was not found: ${filePath.replace(/\\/g, '/')}`); }
        if (!stat.isFile()) throw new ArgumentError(`Image path is not a file: ${filePath.replace(/\\/g, '/')}`);
        if (!IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
            throw new ArgumentError(`Unsupported image type: ${path.extname(filePath) || '(none)'}`);
        }
        if (stat.size > MAX_IMAGE_BYTES) throw new ArgumentError(`Image exceeds 25 MiB: ${path.basename(filePath)}`);
    }
    if (typeof page.setFileInput !== 'function') {
        throw new CommandExecutionError('This OpenCLI browser driver cannot upload images.');
    }
    let uploaded = false;
    try {
        await page.setFileInput(absolutePaths, 'input[type="file"]');
        uploaded = true;
    } catch (error) {
        const fallbackFiles = absolutePaths.map((filePath) => ({
            name: path.basename(filePath),
            type: ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif' })[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            base64: fs.readFileSync(filePath).toString('base64'),
        }));
        try {
            const result = unwrapEvaluateResult(await page.evaluate(`(() => {
                const input = document.querySelector('input[type="file"]');
                if (!(input instanceof HTMLInputElement)) return { ok: false, reason: 'file input not found' };
                const files = ${JSON.stringify(fallbackFiles)};
                const transfer = new DataTransfer();
                for (const item of files) {
                    const binary = atob(item.base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
                    transfer.items.add(new File([bytes], item.name, { type: item.type }));
                }
                input.files = transfer.files;
                const propsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'));
                if (propsKey && input[propsKey] && typeof input[propsKey].onChange === 'function') {
                    const nativeEvent = new Event('change', { bubbles: true });
                    input[propsKey].onChange({
                        target: input, currentTarget: input, nativeEvent,
                        preventDefault() {}, stopPropagation() {},
                        isDefaultPrevented() { return false; },
                        isPropagationStopped() { return false; }, persist() {},
                    });
                } else {
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return { ok: true, count: input.files.length };
            })()`));
            // React may synchronously clear input.files after consuming the
            // change event, so confirmation comes from the attachment preview.
            uploaded = result?.ok === true;
            if (!uploaded) throw new Error(result?.reason || 'file selection was not accepted');
        } catch (fallbackError) {
            throw new CommandExecutionError(`CUHK AI image picker was not available: ${error.message}; fallback failed: ${fallbackError.message}`);
        }
    }
    if (!uploaded) throw new CommandExecutionError('CUHK AI image selection was not accepted.');
    const expectedNames = absolutePaths.map((filePath) => path.basename(filePath));
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const confirmed = unwrapEvaluateResult(await page.evaluate((names) => {
            const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            if (inputs.some((input) => names.every((name) => Array.from(input.files || []).some((file) => file.name === name)))) return true;
            const composer = document.querySelector('[data-testid="chat-input"]');
            const area = composer?.closest('[data-testid="chat-input-body"]')?.parentElement || composer?.parentElement;
            const text = area?.textContent || '';
            return names.every((name) => text.includes(name)) || !!area?.querySelector('img[src^="blob:"], img[src^="data:"], [data-testid*="attachment"], [data-testid*="upload"]');
        }, expectedNames));
        if (confirmed) return;
        await page.wait(0.25);
    }
    throw new CommandExecutionError('CUHK AI did not confirm the image attachment; no message was sent.');
}


export async function waitForResponse(page, baseline, prompt, timeoutMs, options = {}) {
    const startedAt = Date.now();
    const submissionConfirmMs = Math.min(timeoutMs, options.submissionConfirmMs ?? 30000);
    const stalledAfterMs = options.stalledAfterMs ?? 300000;
    const stopConfirmMs = options.stopConfirmMs ?? 15000;
    let lastText = '';
    let stablePolls = 0;
    let idleSince = null;
    let lastActivity = '';
    let activitySince = startedAt;
    let stopRequestedAt = null;

    while (Date.now() - startedAt < timeoutMs) {
        await page.wait(1);
        let snapshot;
        try {
            snapshot = await page.evaluate(`(() => {
                const users = Array.from(document.querySelectorAll('${USER_TURN_SELECTOR}'));
                const userCount = users.length;
                const lastUser = users[users.length - 1];
                const aiTurns = Array.from(document.querySelectorAll('${AI_TURN_SELECTOR}'));
                // One submitted message can have multiple assistant bubbles,
                // including a trailing empty placeholder. Search the whole new
                // response group, never fall back to the previous user's answer.
                const group = lastUser ? aiTurns.filter(turn => lastUser.compareDocumentPosition(turn) & 4) : [];
                const stopVisible = !!document.querySelector('${STOP_BUTTON_SELECTOR}');
                const responseStates = group.map(turn => {
                    const bodies = Array.from(turn.querySelectorAll('.prose-code-custom'));
                    const plain = bodies.map(body => body.textContent || '').join('').trim();
                    const complete = Array.from(turn.querySelectorAll('button')).some(button => /^(重新生成|Regenerate)$/i.test((button.getAttribute('aria-label') || button.innerText || button.textContent || '').trim()));
                    const empty = !plain || /^(?:此回复没有内容|此回复无内容|This response (?:has no content|is empty))[。.!！]?$/i.test(plain);
                    if (empty) return { candidate: null, emptyComplete: complete };
                    const text = bodies.map(${serializeBody.toString()}).join('').trim();
                    return { candidate: { text, protocol: (${extractProtocolText.toString()})(turn), complete }, emptyComplete: false };
                });
                const candidates = responseStates.map(state => state.candidate).filter(Boolean);
                const selected = candidates[candidates.length - 1];
                const errorText = group.map(turn => turn.textContent || '').join('\\n').trim();
                const activity = group.map(turn => turn.textContent || '').join('');
                const hasCompletedAnswer = candidates.some(candidate => candidate.complete);
                const explicitThinking = group.some(turn => !!turn.querySelector('[data-testid*="thinking" i], [class*="thinking" i], [aria-label*="推理"], [aria-label*="思考"]'));
                const thinkingVisible = !hasCompletedAnswer && (explicitThinking
                    || /(?:正在推理|正在思考|思考中|Thinking)\\s*[.…>.›»]*$/iu.test(activity.trim()));
                return { userCount, text: selected?.text || '', protocol: selected?.protocol,
                    complete: !!selected?.complete && !stopVisible && !thinkingVisible,
                    emptyComplete: responseStates.some(state => state.emptyComplete),
                    stopVisible, thinkingVisible, activity, errorText };
            })()`);
        } catch {
            continue;
        }

        if (snapshot?.userCount <= baseline.user) {
            if (Date.now() - startedAt >= submissionConfirmMs) {
                throw new CommandExecutionError('CUHK AI did not show the submitted user message within 30 seconds; delivery is uncertain and the prompt was not resent.');
            }
            continue;
        }
        if (snapshot.userCount > baseline.user + 1) {
            throw new CommandExecutionError('The web conversation received another user message while awaiting this response.');
        }
        if (/Error Code:|消息格式异常|服务暂时不可用|内容不符合.*要求/iu.test(snapshot.errorText || '')) {
            throw new CommandExecutionError(`CUHK AI rejected the submitted message: ${String(snapshot.errorText).slice(0, 500)}`);
        }
        const candidate = String(snapshot.text || '').trim();
        if (snapshot.activity !== lastActivity) {
            lastActivity = snapshot.activity;
            activitySince = Date.now();
            idleSince = null;
        }
        const generating = snapshot.stopVisible || snapshot.thinkingVisible;
        if (generating) idleSince = null;
        else if (idleSince === null) idleSince = Date.now();
        const idleMs = idleSince === null ? 0 : Date.now() - idleSince;
        // Give the site time to replace an empty bubble or append its actual
        // answer before classifying the turn as empty.
        if (snapshot.emptyComplete && idleMs >= 15000 && (!candidate || candidate === prompt.trim())) {
            throw new EmptyResultError('cuhk-ai ask', 'CUHK AI stopped without an answer body.');
        }
        // A spinning Stop control alone is not evidence of continuing thought.
        // Only recover an empty stalled turn after cancellation is confirmed.
        if (snapshot.stopVisible && !candidate && stopRequestedAt === null && Date.now() - activitySince >= stalledAfterMs) {
            await stopActiveGeneration(page);
            stopRequestedAt = Date.now();
        }
        if (stopRequestedAt !== null && snapshot.stopVisible && Date.now() - stopRequestedAt >= stopConfirmMs) {
            throw new CommandExecutionError('CUHK AI stayed stuck after its Stop control was clicked; inspect the existing chat before retrying.');
        }
        if (stopRequestedAt !== null && !snapshot.stopVisible) {
            // Re-observe after stopping: a final answer may have arrived at the
            // same time. Only the normal idle grace may classify it as empty.
            if (idleSince === null) idleSince = Date.now();
        }
        if (!candidate || candidate === prompt.trim()) continue;

        if (candidate === lastText) stablePolls += 1;
        else {
            lastText = candidate;
            stablePolls = 0;
        }

        if ((snapshot.complete || (!generating && idleMs >= 15000)) && stablePolls >= 1) return snapshot.protocol || markdown.turndown(candidate);
    }
    return null;
}

export async function withRetry(operation, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400));
        }
    }
    throw lastError;
}
