import { expect, test } from 'bun:test';
import { parseSpaceAnnouncement } from './space-events';

test('Space announcements accept only a scoped host event shape', () => {
  const connected = { type: 'openchamber:space-stream', properties: {
    spaceId: 'abcdef123456', status: 'connected', wasReady: true,
  } };
  expect(parseSpaceAnnouncement(connected)).toEqual(connected);
  expect(parseSpaceAnnouncement({ ...connected, properties: { ...connected.properties, spaceId: '../other' } })).toBeNull();
  expect(parseSpaceAnnouncement({ type: 'session.status', properties: connected.properties })).toBeNull();
});
