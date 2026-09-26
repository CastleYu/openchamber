import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { V2PermissionCard } from './V2PermissionCard';

test('persistent grant patterns remain visible even when broader than this request', () => {
  const html = renderToStaticMarkup(<I18nProvider><V2PermissionCard permission={{
    id: 'permission', sessionID: 'session', action: 'shell', resources: ['git status'], save: ['git *', 'npm run *'],
  }} /></I18nProvider>);
  expect(html).toContain('git status');
  expect(html).toContain('git *, npm run *');
  expect(html).not.toContain('disabled=""');
});

test('a whole-capability persistent grant displays the wildcard explicitly', () => {
  const html = renderToStaticMarkup(<I18nProvider><V2PermissionCard permission={{
    id: 'permission', sessionID: 'session', action: 'read', resources: ['/repo/file.txt'], save: ['*'],
  }} /></I18nProvider>);
  expect(html).toContain('/repo/file.txt');
  expect(html).toContain('Always: *');
});
