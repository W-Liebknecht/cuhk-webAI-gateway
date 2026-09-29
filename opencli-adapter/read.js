import { cli, Strategy, EmptyResultError } from './_opencli.js';
import { CUHK_AI_DOMAIN, ensureReady, getVisibleMessages } from './utils.js';

export const readCommand = cli({
    site: 'cuhk-ai',
    name: 'read',
    access: 'read',
    description: 'Read all visible messages from the current CUHK AI conversation',
    domain: CUHK_AI_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['index', 'role', 'text'],
    func: async (page) => {
        await ensureReady(page, 'CUHK AI read requires a visible conversation page.');
        const rows = await getVisibleMessages(page);
        if (!rows.length) throw new EmptyResultError('cuhk-ai read', 'The current conversation has no visible messages.');
        return rows;
    },
});
