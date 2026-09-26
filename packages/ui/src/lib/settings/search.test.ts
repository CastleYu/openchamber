import { describe, expect, test } from 'bun:test';
import type { I18nKey } from '@/lib/i18n/store';
import { buildSettingsSearchResults } from './search';
import { opencodeClient } from '@/lib/opencode/client';

const t = (key: I18nKey): string => key;

const runtimeCtx = {
  isVSCode: false,
  isWeb: true,
  isDesktop: false,
  isMobile: false,
  isDesktopLocalOrigin: false,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isWindowsArm64: false,
  routingAvailable: false,
};

describe('settings search', () => {
  test('notify follows the active kernel and is absent from VS Code', () => {
    for (const generation of ['oc1', 'oc2', 'oc1'] as const) {
      opencodeClient.bindRuntime({ generation, endpoint: 'http://notify.test', epoch: generation === 'oc2' ? 2 : 3, version: generation === 'oc2' ? '2.0.16' : '1.18.32' });
      for (const isVSCode of [false, true]) {
        const results = buildSettingsSearchResults({ query: 'notify', runtimeCtx: { ...runtimeCtx, isVSCode }, t, getPageTitle: page => page });
        expect(results.some(result => result.id === 'sessions.agent-notify-tool')).toBe(generation === 'oc2' && !isVSCode);
        const search = buildSettingsSearchResults({ query: 'websearch', runtimeCtx: { ...runtimeCtx, isVSCode }, t, getPageTitle: page => page });
        expect(search.some(result => result.id === 'web-search.provider')).toBe(generation === 'oc2');
      }
    }
  });
  test('finds update history on every surface', () => {
    for (const context of [runtimeCtx, { ...runtimeCtx, isDesktop: true }, { ...runtimeCtx, isVSCode: true }, { ...runtimeCtx, isMobile: true }]) {
      const results = buildSettingsSearchResults({ query: 'DIJIANG', runtimeCtx: context, t, getPageTitle: page => page });
      expect(results.find(result => result.id === 'update-history.entries')?.page).toBe('update-history');
    }
  });
  test('Enter-to-send is searchable only outside mobile', () => {
    for (const isMobile of [false, true]) {
      const results = buildSettingsSearchResults({
        query: 'shift enter',
        runtimeCtx: { ...runtimeCtx, isMobile },
        t,
        getPageTitle: (page) => page,
      });

      expect(results.some((result) => result.id === 'chat.enter-to-send')).toBe(!isMobile);
    }
  });

  test('finds the scrollbar preference on every surface', () => {
    for (const context of [runtimeCtx, { ...runtimeCtx, isDesktop: true }, { ...runtimeCtx, isVSCode: true }, { ...runtimeCtx, isMobile: true }]) {
      const results = buildSettingsSearchResults({
        query: 'scrollbar',
        runtimeCtx: context,
        t,
        getPageTitle: (page) => page,
      });
      expect(results.find((result) => result.id === 'appearance.scrollbars')?.page).toBe('appearance');
    }
  });
  test('finds Linear connect on the integrations page', () => {
    const results = buildSettingsSearchResults({
      query: 'linear',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.linear')).toBe(true);
    expect(results.some((result) => result.id === 'integrations.linear.add-workspace')).toBe(true);
    expect(results.some((result) => result.id === 'integrations.linear.mapping')).toBe(true);
  });

  test('finds the chat input history scope setting', () => {
    const results = buildSettingsSearchResults({
      query: 'input history scope',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'chat.input-history-scope')).toBe(true);
  });

  test('finds the chat input history limit setting by recall keywords', () => {
    const results = buildSettingsSearchResults({
      query: 'remember prompts',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'chat.input-history-limit')).toBe(true);
  });

  test('hides Linear connect in VS Code', () => {
    const results = buildSettingsSearchResults({
      query: 'linear',
      runtimeCtx: { ...runtimeCtx, isVSCode: true },
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.linear')).toBe(false);
    expect(results.some((result) => result.id === 'integrations.linear.add-workspace')).toBe(false);
    expect(results.some((result) => result.id === 'integrations.linear.mapping')).toBe(false);
  });

  test('finds guest extension panels on the integrations page', () => {
    const results = buildSettingsSearchResults({
      query: 'gitlab',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.guests')).toBe(true);
  });

  test('hides guest extension panels in VS Code', () => {
    const results = buildSettingsSearchResults({
      query: 'clickup',
      runtimeCtx: { ...runtimeCtx, isVSCode: true },
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.guests')).toBe(false);
  });
});
