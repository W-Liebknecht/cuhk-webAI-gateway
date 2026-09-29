import { cli, Strategy } from './_opencli.js';
import { CUHK_AI_DOMAIN, ensureReady, selectModel, setThinking } from './utils.js';

export const modelCommand = cli({
    site: 'cuhk-ai',
    name: 'model',
    access: 'write',
    description: 'Select a CUHK AI model and optionally set its thinking level',
    domain: CUHK_AI_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Configured model alias' },
        { name: 'thinking', help: 'none, low, medium, high, xhigh, or max (availability depends on model)' },
    ],
    columns: ['model', 'thinking'],
    func: async (page, args) => {
        await ensureReady(page);
        const model = await selectModel(page, args.name);
        const thinking = await setThinking(page, model, args.thinking);
        return [{ model: model.display, thinking: thinking?.name || null }];
    },
});
