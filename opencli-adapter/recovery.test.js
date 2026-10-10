import { test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { waitForResponse } from './utils.js';
import { CommandExecutionError, EmptyResultError } from './_opencli.js';
const empty = '<div data-turn="ai"><i>此回复没有内容</i><button aria-label="重新生成"></button></div>';
const answer = text => `<div data-turn="ai"><div class="prose-code-custom"><p>${text}</p></div><button aria-label="重新生成"></button></div>`;
async function scenario(initial, mutate, timeout = 60000, baseline = { user: 0, ai: 0 }, options = {}) {
    const dom = new JSDOM(initial, { runScripts: 'outside-only' });
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const page = {
        wait: async seconds => { now += seconds * 1000; mutate?.(dom.window.document, now); },
        evaluate: async source => dom.window.eval(source),
    };
    try { return await waitForResponse(page, baseline, 'task', timeout, options); }
    finally { clock.mockRestore(); dom.window.close(); }
}
test('an empty bubble can precede the valid answer', async () => {
    expect(await scenario('<div data-turn="user"></div>' + empty + answer('valid'))).toBe('valid');
});
test('a trailing empty bubble does not mask the preceding valid answer', async () => {
    expect(await scenario('<div data-turn="user"></div>' + answer('valid') + empty)).toBe('valid');
});
test('waits for a later answer after the empty placeholder has appeared', async () => {
    expect(await scenario('<div data-turn="user"></div>' + empty, (doc, now) => {
        if (now === 5000) doc.body.insertAdjacentHTML('beforeend', answer('late answer'));
    })).toBe('late answer');
});
test('placeholder text inside the answer body is not accepted as a final answer', async () => {
    await expect(scenario('<div data-turn="user"></div>' + answer('此回复没有内容'))).rejects.toThrow(EmptyResultError);
});
test('never uses a previous user turn answer when the current turn is empty', async () => {
    await expect(scenario('<div data-turn="user"></div>' + answer('old answer') + '<div data-turn="user"></div>' + empty, null, 60000, { user: 1, ai: 1 })).rejects.toThrow(EmptyResultError);
});
test('newest substantive answer wins if multiple alternatives appear', async () => {
    expect(await scenario('<div data-turn="user"></div>' + answer('first') + answer('second') + empty)).toBe('second');
});
test('continues observing active thought beyond 180 seconds and captures the final answer', async () => {
    expect(await scenario('<div data-turn="user"></div><div data-turn="ai" id="thought"></div><button data-testid="chat-stop-button"></button>', (doc, now) => {
        if (now < 210000) doc.querySelector('#thought').textContent = `thinking ${now}`;
        if (now === 210000) {
            doc.querySelector('[data-testid="chat-stop-button"]').remove();
            doc.body.insertAdjacentHTML('beforeend', answer('long thought finished'));
        }
    }, 900000)).toBe('long thought finished');
});
test('a static thinking indicator without a Stop button is never classified as empty', async () => {
    expect(await scenario('<div data-turn="user"></div><div data-turn="ai" id="thought"><span>正在推理...</span></div>', (doc, now) => {
        if (now === 30000) {
            doc.querySelector('#thought').remove();
            doc.body.insertAdjacentHTML('beforeend', answer('thought finished'));
        }
    }, 120000)).toBe('thought finished');
});
test('silent spinning generation is stopped before it is classified as recoverable', async () => {
    let stopped = false;
    await expect(scenario('<div data-turn="user"></div>' + empty + '<button data-testid="chat-stop-button"></button>', (doc, now) => {
        if (now === 1000) doc.querySelector('[data-testid="chat-stop-button"]').onclick = event => { stopped = true; event.target.remove(); };
    }, 900000)).rejects.toThrow(EmptyResultError);
    expect(stopped).toBe(true);
});
test('fails early when the submitted user turn never appears', async () => {
    await expect(scenario('', null, 900000)).rejects.toThrow(CommandExecutionError);
});

test('current send-button Stop label keeps completed earlier bubbles from returning prematurely', async () => {
    expect(await scenario('<div data-turn="user"></div>' + answer('early bubble')
        + '<button data-testid="chat-send-button" aria-label="停止生成"></button>', (doc, now) => {
        if (now === 10000) {
            doc.querySelector('[data-testid="chat-send-button"]').setAttribute('aria-label', '发送消息');
            doc.body.insertAdjacentHTML('beforeend', answer('actual final bubble'));
        }
    })).toBe('actual final bubble');
});

test('current send-button Stop control is canceled before empty recovery', async () => {
    let stopped = false;
    await expect(scenario('<div data-turn="user"></div>' + empty
        + '<button data-testid="chat-send-button" aria-label="停止生成"></button>', (doc, now) => {
        if (now === 1000) doc.querySelector('[data-testid="chat-send-button"]').onclick = event => {
            stopped = true; event.target.setAttribute('aria-label', '发送消息');
        };
    }, 900000)).rejects.toThrow(EmptyResultError);
    expect(stopped).toBe(true);
});

test('idle send button is never mistaken for a Stop control', async () => {
    expect(await scenario('<div data-turn="user"></div>' + answer('finished')
        + '<button data-testid="chat-send-button" aria-label="发送消息"></button>')).toBe('finished');
});
test('fails after one bounded stop attempt when a silent spinner cannot be stopped', async () => {
    await expect(scenario('<div data-turn="user"></div><button data-testid="chat-stop-button"></button>', null, 900000, { user: 0, ai: 0 }, {
        stalledAfterMs: 3000,
        stopConfirmMs: 2000,
    })).rejects.toThrow(/stayed stuck/);
});
test('surfaces a typed page rejection without waiting for the total timeout', async () => {
    await expect(scenario('<div data-turn="user"></div><div data-turn="ai">消息格式异常 Error Code: chat.llm_api.invalid_message</div>', null, 900000))
        .rejects.toThrow(/rejected the submitted message/);
});
