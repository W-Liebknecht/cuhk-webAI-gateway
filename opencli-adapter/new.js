import { cli, Strategy } from './_opencli.js';
import { CUHK_AI_DOMAIN, ensureReady, startFreshConversation } from './utils.js';

export const newCommand = cli({
    site: 'cuhk-ai',
    name: 'new',
    access: 'read',
    description: 'Open a fresh CUHK AI conversation',
    domain: CUHK_AI_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['status', 'url'],
    func: async (page) => {
        await startFreshConversation(page);
        const state = await ensureReady(page, 'CUHK AI new requires a visible chat composer.');
        return [{ status: 'New chat ready', url: state.url }];
    },
});
