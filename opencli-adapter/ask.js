import { readFileSync } from 'node:fs';
import { cli, Strategy, ArgumentError, CommandExecutionError, TimeoutError } from './_opencli.js';
import {
    CUHK_AI_DOMAIN,
    ensureReady,
    getContextUsage,
    getTurnCounts,
    requireNonEmptyPrompt,
    requirePositiveInt,
    sendMessage,
    selectModel,
    setThinking,
    startFreshConversation,
    stopActiveGeneration,
    uploadImages,
    waitForResponse,
    withRetry,
} from './utils.js';

export const askCommand = cli({
    site: 'cuhk-ai',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to the CUHK-Shenzhen AI web platform and return the complete reply',
    domain: CUHK_AI_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: false, help: 'Prompt to send' },
        { name: 'prompt-file', valueRequired: true, help: 'Read the UTF-8 prompt from a file (for large agent requests)' },
        { name: 'conversation-url', valueRequired: true, help: 'Verified conversation URL to resume (gateway use)' },
        { name: 'gateway-identity', type: 'boolean', default: false, help: 'Return durable conversation identity' },
        { name: 'timeout', type: 'int', default: 180, help: 'Maximum seconds to wait for a complete response' },
        { name: 'stalled-after', type: 'int', default: 300, help: 'Seconds without visible activity before stopping a stuck generation' },
        { name: 'image-manifest', valueRequired: true, help: 'JSON file containing local image paths to attach' },
        { name: 'new', type: 'boolean', default: true, help: 'Start a fresh conversation before sending' },
        { name: 'model', help: 'Model alias from `cuhk-ai models` (including qwen3.8-27b, seed2.1pro, gemini3.8flash, gpt6sol, and gpt6luna)' },
        { name: 'thinking', help: 'Thinking level supported by the selected model: none, low, medium, high, xhigh, or max' },
    ],
    columns: ['response', 'contextUsedPercent', 'contextRemainingPercent', 'contextTruncated'],

    func: async (page, args) => {
        let promptValue = args.prompt;
        if (args['prompt-file']) {
            if (args.prompt) throw new ArgumentError('Pass either a prompt or --prompt-file, not both.');
            try {
                promptValue = readFileSync(String(args['prompt-file']), 'utf8').replace(/^\uFEFF/, '');
            } catch (error) {
                throw new ArgumentError(`Could not read --prompt-file: ${error.message}`);
            }
        }
        const prompt = requireNonEmptyPrompt(promptValue, 'cuhk-ai ask');
        const timeoutSeconds = requirePositiveInt(args.timeout ?? 180, 'cuhk-ai ask --timeout');
        const stalledAfterSeconds = requirePositiveInt(args['stalled-after'] ?? 300, 'cuhk-ai ask --stalled-after');
        let imagePaths = [];
        if (args['image-manifest']) {
            try {
                const parsed = JSON.parse(readFileSync(String(args['image-manifest']), 'utf8').replace(/^\uFEFF/, ''));
                if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || !value.trim())) throw new Error('expected an array of paths');
                imagePaths = parsed;
            } catch (error) {
                throw new ArgumentError(`Could not read --image-manifest: ${error.message}`);
            }
        }

        const target = args['conversation-url'];
        if (target && !/^https:\/\/ai\.cuhk\.edu\.cn\/chat\/c\/[a-zA-Z0-9-]+\/?$/.test(target)) {
            throw new ArgumentError('Invalid CUHK conversation URL.');
        }
        if (args.new === false && target) {
            const current = await page.evaluate('window.location.href');
            if (current !== target) {
                await page.goto(target);
                await page.wait({ selector: '[data-turn="user"]', timeout: 20 });
            }
            const actual = await page.evaluate('window.location.href');
            if (actual !== target) throw new CommandExecutionError('Conversation identity mismatch; no message was sent.');
        }
        if (args.new !== false) {
            await startFreshConversation(page);
        }
        await ensureReady(page, 'CUHK AI ask requires a visible chat composer.');

        if (args.thinking && !args.model) {
            throw new ArgumentError('Pass --model together with --thinking so the setting is applied to the intended model.');
        }
        if (args.model) {
            const selectedModel = await selectModel(page, args.model);
            if (args.thinking) await setThinking(page, selectedModel, args.thinking);
        }

        const baseline = await withRetry(() => getTurnCounts(page));
        if (target && args.new === false && await page.evaluate('window.location.href') !== target) {
            throw new CommandExecutionError('Conversation changed before submission; no message was sent.');
        }
        await uploadImages(page, imagePaths);
        // A lost acknowledgement may still mean the prompt was submitted.
        // Never retry a write automatically and risk creating duplicate turns.
        const sendResult = await sendMessage(page, prompt);
        if (!sendResult?.ok) {
            throw new CommandExecutionError(sendResult?.reason || 'Could not send the prompt to CUHK AI.');
        }

        let response;
        try {
            response = await waitForResponse(page, baseline, prompt, timeoutSeconds * 1000, {
                stalledAfterMs: stalledAfterSeconds * 1000,
            });
        } catch (error) {
            // Preserve the address even when the first response is empty so the
            // gateway's one recovery attempt can verify the same conversation.
            if (args['gateway-identity'] && error.code === 'EMPTY_RESULT') {
                const conversationUrl = await page.evaluate('window.location.href');
                if (/^https:\/\/ai\.cuhk\.edu\.cn\/chat\/c\/[a-zA-Z0-9-]+\/?$/.test(conversationUrl)) {
                    return [{ ok: false, error: error.message, errorCode: 'cuhk_empty_result', conversationUrl }];
                }
            }
            throw error;
        }
        if (!response) {
            await stopActiveGeneration(page);
            throw new TimeoutError(
                'cuhk-ai ask',
                timeoutSeconds,
                'Completion was not confirmed. Inspect the existing chat with cuhk-ai read; do not automatically resend the prompt.',
            );
        }
        if (args['conversation-url'] || args['gateway-identity']) {
            const conversationUrl = await page.evaluate('window.location.href');
            if (target && args.new === false && conversationUrl !== target) {
                throw new CommandExecutionError('Conversation changed during generation; response ownership is uncertain.');
            }
            if (!/^https:\/\/ai\.cuhk\.edu\.cn\/chat\/c\/[a-zA-Z0-9-]+\/?$/.test(conversationUrl)) {
                throw new CommandExecutionError('No durable conversation URL after submission; delivery is uncertain.');
            }
            const context = await getContextUsage(page);
            return [{
                response,
                conversationUrl,
                contextUsedPercent: context?.usedPercent ?? null,
                contextRemainingPercent: context?.remainingPercent ?? null,
                contextTruncated: context?.truncated ?? false,
            }];
        }
        return [{ response }];
    },
});
