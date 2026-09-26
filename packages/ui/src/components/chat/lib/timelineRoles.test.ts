import { describe, expect, test } from 'bun:test';

import { isSkippedTimelineRole, isTimelineNoticeRole } from './timelineRoles';

describe('timeline message roles', () => {
    test('keeps both generations of conversation messages in the normal renderer', () => {
        for (const role of ['user', 'assistant'] as const) {
            expect(isSkippedTimelineRole(role)).toBe(false);
            expect(isTimelineNoticeRole(role)).toBe(false);
        }
    });

    test('renders compaction and shell as visible notices', () => {
        for (const role of ['compaction', 'shell'] as const) {
            expect(isSkippedTimelineRole(role)).toBe(false);
            expect(isTimelineNoticeRole(role)).toBe(true);
        }
    });

    test('hides OpenCode plumbing roles', () => {
        for (const role of ['synthetic', 'system', 'skill', 'location-switched', 'idle', 'agent-switched', 'model-switched'] as const) {
            expect(isSkippedTimelineRole(role)).toBe(true);
            expect(isTimelineNoticeRole(role)).toBe(false);
        }
    });
});
