import React from 'react';
import { describe, expect, test } from 'bun:test';
import { plugin } from 'bun';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';

import { I18nProvider } from '@/lib/i18n';
import type { CompactionMessage } from '@/lib/opencode/model';

plugin({
    name: 'timeline-notice-worker-url',
    setup(build) {
        build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, ({ path }) => ({
            contents: `export default ${JSON.stringify(pathToFileURL(path.split('?')[0]).href)};`,
            loader: 'js',
        }));
    },
});

const { TimelineNotice } = await import('./TimelineNotice');

const compaction = (status: CompactionMessage['status']): CompactionMessage => ({
    id: 'compact-1',
    sessionID: 'session-1',
    role: 'compaction',
    time: { created: 1 },
    reason: 'auto',
    status,
    summary: 'Earlier context',
});

describe('OC2 timeline notices', () => {
    test('shows an active compaction and its streaming summary', () => {
        const html = renderToStaticMarkup(
            <I18nProvider><TimelineNotice message={compaction('running')} /></I18nProvider>,
        );
        expect(html).toContain('Compacting the conversation');
        expect(html).toContain('Earlier context');
    });

    test('shows a completed compaction with a summary control', () => {
        const html = renderToStaticMarkup(
            <I18nProvider><TimelineNotice message={compaction('completed')} /></I18nProvider>,
        );
        expect(html).toContain('Conversation compacted');
        expect(html).toContain('Show summary');
    });
});
