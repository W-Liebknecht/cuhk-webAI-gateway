import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, TimeoutError, EmptyResultError } from './_opencli.js';

const mocks = vi.hoisted(() => ({
    ensureReady: vi.fn(),
    getTurnCounts: vi.fn(),
    requireNonEmptyPrompt: vi.fn((value) => String(value ?? '').trim()),
    requirePositiveInt: vi.fn((value) => Number(value)),
    sendMessage: vi.fn(),
    selectModel: vi.fn(),
    setThinking: vi.fn(),
    startFreshConversation: vi.fn(),
    stopActiveGeneration: vi.fn(),
    uploadImages: vi.fn(),
    waitForResponse: vi.fn(),
    withRetry: vi.fn(async (operation) => operation()),
}));

vi.mock('./utils.js', () => ({
    CUHK_AI_DOMAIN: 'ai.cuhk.edu.cn',
    CUHK_AI_URL: 'https://ai.cuhk.edu.cn/chat/',
    COMPOSER_SELECTOR: '[data-testid="chat-input"]',
    ensureReady: mocks.ensureReady,
    getTurnCounts: mocks.getTurnCounts,
    requireNonEmptyPrompt: mocks.requireNonEmptyPrompt,
    requirePositiveInt: mocks.requirePositiveInt,
    sendMessage: mocks.sendMessage,
    selectModel: mocks.selectModel,
    setThinking: mocks.setThinking,
    startFreshConversation: mocks.startFreshConversation,
    stopActiveGeneration: mocks.stopActiveGeneration,
    uploadImages: mocks.uploadImages,
    waitForResponse: mocks.waitForResponse,
    withRetry: mocks.withRetry,
}));

import { askCommand } from './ask.js';

describe('cuhk-ai ask', () => {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ensureReady.mockResolvedValue({ hasComposer: true, isLoggedIn: true });
        mocks.getTurnCounts.mockResolvedValue({ user: 2, ai: 2 });
        mocks.sendMessage.mockResolvedValue({ ok: true });
        mocks.selectModel.mockResolvedValue({ alias: 'gpt5.6sol', display: 'GPT 5.6 Sol', thinking: ['high'] });
        mocks.setThinking.mockResolvedValue({ name: 'high', label: '高' });
        mocks.waitForResponse.mockResolvedValue('complete answer');
    });

    it('starts a new chat by default and returns one complete response row', async () => {
        const rows = await askCommand.func(page, { prompt: 'hello', timeout: 180, new: true });

        expect(mocks.startFreshConversation).toHaveBeenCalledWith(page);
        expect(mocks.sendMessage).toHaveBeenCalledWith(page, 'hello');
        expect(mocks.waitForResponse).toHaveBeenCalledWith(
            page,
            { user: 2, ai: 2 },
            'hello',
            180000,
            { stalledAfterMs: 300000 },
        );
        expect(rows).toEqual([{ response: 'complete answer' }]);
    });

    it('continues the current conversation when --new is false', async () => {
        await askCommand.func(page, { prompt: 'continue', timeout: 60, new: false });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('returns identity with a confirmed empty bootstrap for safe recovery', async () => {
        const url = 'https://ai.cuhk.edu.cn/chat/c/empty-test';
        page.evaluate.mockResolvedValue(url);
        mocks.waitForResponse.mockRejectedValueOnce(new EmptyResultError('ask'));
        const rows = await askCommand.func(page, { prompt: 'test', new: true, 'gateway-identity': true });
        expect(rows[0]).toMatchObject({ ok: false, errorCode: 'cuhk_empty_result', conversationUrl: url });
    });

    it('switches to the intended conversation and checks identity before sending', async () => {
        const target = 'https://ai.cuhk.edu.cn/chat/c/target';
        page.evaluate.mockResolvedValueOnce('https://ai.cuhk.edu.cn/chat/c/other').mockResolvedValue(target);
        const result = await askCommand.func(page, { prompt: 'continue', new: false, 'conversation-url': target });
        expect(page.goto).toHaveBeenCalledWith(target);
        expect(result[0].conversationUrl).toBe(target);
    });

    it('does not send when navigation does not restore the intended conversation', async () => {
        page.evaluate.mockResolvedValue('https://ai.cuhk.edu.cn/chat/');
        await expect(askCommand.func(page, { prompt: 'continue', new: false, 'conversation-url': 'https://ai.cuhk.edu.cn/chat/c/missing' })).rejects.toThrow(/identity mismatch/);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('reads a large prompt from --prompt-file without a positional argument', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuhk-prompt-test-'));
        const promptFile = path.join(dir, 'prompt.txt');
        try {
            fs.writeFileSync(promptFile, '\uFEFFlarge prompt from file', 'utf8');
            await askCommand.func(page, { 'prompt-file': promptFile, timeout: 60, new: false });
            expect(mocks.sendMessage).toHaveBeenCalledWith(page, 'large prompt from file');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('uploads manifest images before sending the prompt', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuhk-image-test-'));
        const manifest = path.join(dir, 'images.json');
        fs.writeFileSync(manifest, JSON.stringify(['C:\\Users\\me\\photo.png']), 'utf8');
        try {
            await askCommand.func(page, { prompt: 'describe it', timeout: 60, new: false, 'image-manifest': manifest });
            expect(mocks.uploadImages).toHaveBeenCalledWith(page, ['C:\\Users\\me\\photo.png']);
            expect(mocks.uploadImages.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendMessage.mock.invocationCallOrder[0]);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('selects the requested model and thinking level before sending', async () => {
        await askCommand.func(page, {
            prompt: 'hello', timeout: 60, new: false, model: 'gpt5.6sol', thinking: 'high',
        });
        expect(mocks.selectModel).toHaveBeenCalledWith(page, 'gpt5.6sol');
        expect(mocks.setThinking).toHaveBeenCalledWith(page, expect.objectContaining({ alias: 'gpt5.6sol' }), 'high');
        expect(mocks.selectModel.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendMessage.mock.invocationCallOrder[0]);
    });

    it('rejects a thinking level without an explicit model', async () => {
        await expect(askCommand.func(page, {
            prompt: 'hello', timeout: 60, new: false, thinking: 'high',
        })).rejects.toThrow(ArgumentError);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('fails with a typed execution error when the send action is rejected', async () => {
        mocks.sendMessage.mockResolvedValue({ ok: false, reason: 'send button stayed disabled' });
        await expect(askCommand.func(page, { prompt: 'hello', timeout: 60, new: false }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('fails with a typed empty result when no complete reply arrives', async () => {
        mocks.waitForResponse.mockResolvedValue(null);
        await expect(askCommand.func(page, { prompt: 'hello', timeout: 60, new: false }))
            .rejects.toThrow(TimeoutError);
        expect(mocks.stopActiveGeneration).toHaveBeenCalledWith(page);
    });
});
