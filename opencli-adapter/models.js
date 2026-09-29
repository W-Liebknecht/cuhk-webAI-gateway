import { cli, Strategy } from './_opencli.js';
import { CUHK_AI_DOMAIN, MODEL_DEFINITIONS, ensureReady, getCurrentModel } from './utils.js';

export const modelsCommand = cli({
    site: 'cuhk-ai',
    name: 'models',
    access: 'read',
    description: 'List configured CUHK AI models and their supported thinking levels',
    domain: CUHK_AI_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['alias', 'display', 'thinking', 'selected'],
    func: async (page) => {
        await ensureReady(page);
        const current = await getCurrentModel(page);
        return MODEL_DEFINITIONS.map((model) => ({
            alias: model.alias,
            display: model.display,
            thinking: model.thinking.join(', ') || null,
            selected: model.display === current,
        }));
    },
});
