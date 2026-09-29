import { cli, Strategy } from './_opencli.js';
import { CUHK_AI_DOMAIN, ensureOnCuhkAi, getPageState } from './utils.js';

export const statusCommand = cli({
    site: 'cuhk-ai',
    name: 'status',
    access: 'read',
    description: 'Check CUHK AI login, page readiness, and selected model',
    domain: CUHK_AI_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['status', 'login', 'model', 'url'],
    func: async (page) => {
        await ensureOnCuhkAi(page);
        const state = await getPageState(page);
        return [{
            status: state.hasComposer ? 'Connected' : 'Page not ready',
            login: state.isLoggedIn ? 'Yes' : 'No',
            model: state.model || null,
            url: state.url,
        }];
    },
});
