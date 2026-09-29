import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { EmptyResultError } from './_opencli.js';
import { getVisibleMessages, resolveModel, resolveThinking, setThinking, startFreshConversation, stopActiveGeneration, uploadImages, waitForResponse } from './utils.js';

describe('CUHK AI conversation identity', () => {
    it('clicks New Chat and verifies a blank base conversation', async () => {
        const dom = new JSDOM('<button>新对话</button><div data-turn="user">old</div><div data-turn="ai">old answer</div><textarea data-testid="chat-input"></textarea>', {
            runScripts: 'outside-only',
            url: 'https://ai.cuhk.edu.cn/chat/c/old-conversation',
        });
        dom.window.document.querySelector('button').addEventListener('click', () => {
            dom.window.history.pushState({}, '', '/chat/');
            dom.window.document.querySelectorAll('[data-turn]').forEach(node => node.remove());
        });
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            goto: vi.fn(),
            evaluate: async source => dom.window.eval(source),
        };
        try {
            const state = await startFreshConversation(page);
            expect(state.url).toBe('https://ai.cuhk.edu.cn/chat/');
            expect(state.userTurns).toBe(0);
            expect(page.goto).not.toHaveBeenCalled();
        } finally { dom.window.close(); }
    });

    it('refuses a bootstrap when the New Chat control is unavailable', async () => {
        const dom = new JSDOM('<div data-turn="user">old</div><textarea data-testid="chat-input"></textarea>', {
            runScripts: 'outside-only',
            url: 'https://ai.cuhk.edu.cn/chat/c/old-conversation',
        });
        const page = { wait: vi.fn(), goto: vi.fn(), evaluate: async source => dom.window.eval(source) };
        try {
            await expect(startFreshConversation(page)).rejects.toThrow(/control was not found/iu);
        } finally { dom.window.close(); }
    });
});

describe('CUHK AI model configuration', () => {
    it('resolves aliases and page display names', () => {
        expect(resolveModel('gpt5.6sol').display).toBe('GPT 5.6 Sol');
        expect(resolveModel('GLM 5.3 Flash（本地版）').alias).toBe('glm5.3flash');
        expect(resolveModel('seed2.1pro').display).toBe('豆包 Seed 2.1 Pro');
        expect(resolveModel('Gemini 3.8 Flash').alias).toBe('gemini3.8flash');
        expect(resolveModel('GPT 6 Sol').alias).toBe('gpt6sol');
        expect(resolveModel('gpt6luna').display).toBe('GPT 6 Luna');
        expect(resolveModel('Qwen3.8 27B（本地版）').alias).toBe('qwen3.8-27b');
    });

    it('validates thinking levels per model', () => {
        expect(resolveThinking('extreme', resolveModel('gpt5.6sol')).name).toBe('xhigh');
        expect(resolveThinking('none', resolveModel('deepseek-v4.1-flash')).label).toBe('不思考');
        expect(resolveThinking('极致', resolveModel('glm5.3flash')).name).toBe('max');
        expect(resolveThinking('思考', resolveModel('seed2.1pro')).name).toBe('high');
        expect(resolveThinking('high', resolveModel('gemini3.8flash')).label).toBe('高');
        expect(resolveThinking('超高', resolveModel('gpt6sol')).name).toBe('xhigh');
        expect(resolveThinking('极高', resolveModel('gpt6luna')).name).toBe('xhigh');
        expect(resolveThinking('中', resolveModel('qwen3.8-27b')).name).toBe('medium');
        expect(() => resolveThinking('medium', resolveModel('kimi-k3'))).toThrow(/not available/);
        expect(() => resolveThinking('high', resolveModel('glm5.3'))).toThrow(/not available/);
    });

    it('uses browser clicks to open and select a thinking option by stable ordinal', async () => {
        const display = 'GLM 5.3 Flash（本地版）';
        const dom = new JSDOM(`
            <button aria-haspopup="dialog" aria-label="${display}"></button>
            <div role="dialog">
                <button id="model-option-current"></button>
                <button role="combobox" aria-label="设置 ${display} 的思考配置"><span>高</span></button>
            </div>
            <div role="option" aria-selected="false" data-state="unchecked">低</div>
            <div role="option" aria-selected="true" data-state="checked">高</div>
            <div role="option" aria-selected="false" data-state="unchecked">极致</div>
        `, { runScripts: 'outside-only' });
        Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
            configurable: true,
            get() { return this.textContent; },
            set(value) { this.textContent = value; },
        });
        const combo = dom.window.document.querySelector('[role="combobox"]');
        const options = Array.from(dom.window.document.querySelectorAll('[role="option"]'));
        combo.addEventListener('click', () => combo.setAttribute('aria-expanded', 'true'));
        for (const option of options) {
            option.addEventListener('click', () => {
                options.forEach((candidate) => {
                    candidate.setAttribute('aria-selected', String(candidate === option));
                    candidate.setAttribute('data-state', candidate === option ? 'checked' : 'unchecked');
                });
                combo.querySelector('span').textContent = option.textContent;
                combo.setAttribute('aria-expanded', 'false');
            });
        }
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            click: vi.fn(async (selector) => {
                const target = dom.window.document.querySelector(selector);
                if (!target) throw new Error('target not found');
                target.click();
            }),
            evaluate: async (source, ...args) => {
                if (typeof source === 'string') return dom.window.eval(source);
                const serialized = JSON.stringify(args);
                return dom.window.eval(`(${source.toString()})(...${serialized})`);
            },
        };
        try {
            const result = await setThinking(page, resolveModel('glm5.3flash'), 'max');
            expect(result.name).toBe('max');
            expect(combo.textContent).toBe('极致');
            expect(options[2].getAttribute('data-state')).toBe('checked');
            expect(page.click).toHaveBeenCalledTimes(2);
            expect(page.click.mock.calls[0][0]).toContain('data-cuhk-thinking-trigger');
            expect(page.click.mock.calls[1][0]).toContain('data-cuhk-thinking-option');
            expect(combo.getAttribute('aria-expanded')).toBe('false');
        } finally {
            dom.window.close();
        }
    });
});

describe('CUHK AI image upload', () => {
    it('normalizes a Windows path and confirms the selected file before sending', async () => {
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuhk-upload-'));
        const file = path.join(dir, 'photo.png');
        fs.writeFileSync(file, Buffer.from([1, 2, 3]));
        const page = {
            setFileInput: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(true),
            wait: vi.fn(),
        };
        try {
            await uploadImages(page, [file.replace(/\\/g, '/')]);
            expect(page.setFileInput).toHaveBeenCalledWith([file], 'input[type="file"]');
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
    it('falls back to DataTransfer when the native file chooser times out', async () => {
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuhk-upload-'));
        const file = path.join(dir, 'photo.png');
        fs.writeFileSync(file, Buffer.from([1, 2, 3]));
        const page = {
            setFileInput: vi.fn().mockRejectedValue(new Error('fileChooserOpened not received')),
            evaluate: vi.fn().mockResolvedValueOnce({ session: 'x', data: { ok: true, count: 1 } }).mockResolvedValueOnce({ session: 'x', data: true }),
            wait: vi.fn(),
        };
        try {
            await uploadImages(page, [file]);
            expect(page.evaluate.mock.calls[0][0]).toContain('new DataTransfer()');
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});

describe('CUHK AI body extraction', () => {
    it('preserves nested fences and missing language without undefined text', async () => {
        const dom = new JSDOM('<div data-turn="ai"><div class="prose-code-custom"><pre><code>```powershell\nWrite-Output "中文$"\n```</code></pre></div></div>', { runScripts: 'outside-only' });
        const rows = await getVisibleMessages({ evaluate: async source => dom.window.eval(source) });
        expect(rows[0].text).toBe('````\n```powershell\nWrite-Output "中文$"\n```\n````');
        dom.window.close();
    });
    it('preserves standalone tool JSON and does not activate examples', async () => {
        const protocol = '<tool_call>{"name":"echo","arguments":{"value":"a_b\\\\folder"}}</tool_call>';
        const escaped = protocol.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        for (const [html, accepted] of [[`<p>${escaped}</p>`, true], [`<pre><code>${escaped}</code></pre>`, false], [`<code>${escaped}</code>`, false], [`<blockquote>${escaped}</blockquote>`, false], [`<p>Example: ${escaped}</p>`, false], [`<p>${escaped}${escaped}</p>`, false]]) {
            const dom = new JSDOM(`<div data-turn="ai"><div class="prose-code-custom">${html}</div></div>`, { runScripts: 'outside-only' });
            const rows = await getVisibleMessages({ evaluate: async source => dom.window.eval(source) });
            if (accepted) expect(rows[0].text).toBe(protocol);
            else expect(rows[0].text).not.toBe(protocol);
            dom.window.close();
        }
    });
    it('preserves highlighted code whitespace and excludes model metadata', async () => {
        const dom = new JSDOM(`<div data-turn="ai"><div class="prose-code-custom"><div class="relative"><div>python</div><button>复制</button><div data-block="true"><code class="language-python"><span>def add(a, b):</span>\n<span>    return a + b</span></code></div></div><p>Done</p></div><footer>Claude 10 秒前</footer></div>`, { runScripts: 'outside-only' });
        const page = { evaluate: async (source) => dom.window.eval(source) };
        const rows = await getVisibleMessages(page);
        expect(rows[0].text).toBe('```python\ndef add(a, b):\n    return a + b\n```\n\nDone');
        dom.window.close();
    });
    it('allows replacement grace before failing a completed empty answer', async () => {
        const dom = new JSDOM(`<div data-turn="user"></div><div data-turn="ai"><div class="prose-code-custom"></div><button aria-label="重新生成">重新生成</button></div>`, { runScripts: 'outside-only' });
        let now = 1000;
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
        const page = {
            wait: vi.fn(async () => { now += 1000; }),
            evaluate: async (source) => dom.window.eval(source),
        };
        await expect(waitForResponse(page, { user: 0, ai: 0 }, 'hello', 30000))
            .rejects.toThrow(EmptyResultError);
        clock.mockRestore();
        dom.window.close();
    });

    it('clicks the page stop control when cancelling a stalled generation', async () => {
        const dom = new JSDOM('<button data-testid="chat-stop-button"></button>', { runScripts: 'outside-only' });
        let clicks = 0;
        dom.window.HTMLElement.prototype.click = function click() { clicks += 1; };
        await stopActiveGeneration({ evaluate: async (source) => dom.window.eval(source) });
        expect(clicks).toBe(1);
        dom.window.close();
    });

});

describe('CUHK AI idle completion detection', () => {
    for (const [name, html, expected, timeout] of [
        ['no AI turn', '', null, 5000],
        ['empty AI turn without regenerate', '<div data-turn="ai"></div>', null, 5000],
        ['answer without regenerate', '<div data-turn="ai"><div class="prose-code-custom"><p>Finished</p></div></div>', 'Finished', 60000],
    ]) {
        it(name, async () => {
            const dom = new JSDOM(`<div data-turn="user"></div>${html}`, { runScripts: 'outside-only' });
            let now = 1000;
            const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
            const page = { wait: async () => { now += 1000; }, evaluate: async source => dom.window.eval(source) };
            try {
                const response = waitForResponse(page, { user: 0, ai: 0 }, 'task', timeout);
                if (expected) expect(await response).toBe(expected);
                else expect(await response).toBeNull();
                if (expected) expect(now).toBeLessThan(20000);
                else expect(now).toBeGreaterThanOrEqual(timeout);
            } finally { clock.mockRestore(); dom.window.close(); }
        });
    }
    it('does not finish while the generation stop button is present', async () => {
        const dom = new JSDOM('<div data-turn="user"></div><div data-turn="ai"><div class="prose-code-custom">Partial</div></div><button data-testid="chat-stop-button"></button>', { runScripts: 'outside-only' });
        let now = 1000;
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
        try {
            const page = { wait: async () => { now += 1000; }, evaluate: async source => dom.window.eval(source) };
            expect(await waitForResponse(page, { user: 0, ai: 0 }, 'task', 20000)).toBeNull();
        } finally { clock.mockRestore(); dom.window.close(); }
    });
});
