import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { useAcpControls } from './useAcpControls';
import { opencodeClient } from '@/lib/opencode/client';
import type { Session } from '@/lib/opencode/model';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';

const previousResolver = getRuntimeUrlResolver();
const session: Session = { id: 'one', projectID: '/repo', directory: '/repo', title: 'One', time: { created: 1, updated: 2 } };
const controls = { configOptions: [], commands: [{ name: 'review', description: 'Review' }], capabilities: { load: true, resume: true, delete: false } };
let root: Root;
let restore: () => void;
let latest: ReturnType<typeof useAcpControls> | undefined;

function Probe({ selected }: { selected: Session }) {
    latest = useAcpControls(selected);
    return null;
}
function current() {
    if (!latest) throw new Error('Probe has not rendered');
    return latest;
}
async function render(selected: Session) {
    await act(async () => { root.render(<Probe selected={selected} />); });
}

beforeEach(() => {
    const win = new Window({ url: 'https://acp.test' });
    const globals = { window: win, document: win.document, HTMLElement: win.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
    const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    restore = () => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
    root = createRoot(document.createElement('div'));
    latest = undefined;
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://acp.test' });
    opencodeClient.reconnectToRuntimeBaseUrl(false);
    opencodeClient.bindRuntime({ generation: 'acp', endpoint: 'acp:test', epoch: 1, version: null });
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    setRuntimeUrlResolver(previousResolver);
    opencodeClient.reconnectToRuntimeBaseUrl(false);
    restore();
});

test('authoritative revision refresh preserves controls on failure but never reuses another session', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(controls));
    try {
        await render(session);
        expect(current().controls).toEqual(controls);
        fetch.mockResolvedValue(Response.json({ error: 'offline' }, { status: 503 }));
        await render({ ...session, time: { ...session.time, updated: 3 } });
        expect(current().controls).toEqual(controls);
        expect(current().error).toContain('503');
        await render({ ...session, id: 'two' });
        expect(current().controls).toBeUndefined();
        expect(current().error).toContain('503');
    } finally { fetch.mockRestore(); }
});

test('old session completion cannot replace the current session controls', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetch = spyOn(globalThis, 'fetch');
    fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    try {
        await render(session);
        const other = { ...controls, commands: [{ name: 'other', description: 'Other agent command' }] };
        fetch.mockResolvedValue(Response.json(other));
        await render({ ...session, id: 'two' });
        await act(async () => { resolve(Response.json(controls)); });
        expect(current().controls).toEqual(other);
    } finally { fetch.mockRestore(); }
});

test('failed controls on a new runtime never retain the previous runtime choices', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(controls));
    try {
        await render(session);
        expect(current().controls).toEqual(controls);
        fetch.mockResolvedValue(Response.json({ error: 'offline' }, { status: 503 }));
        await act(async () => { opencodeClient.bindRuntime({ generation: 'acp', endpoint: 'acp:other', epoch: 2, version: null }); });
        expect(current().controls).toBeUndefined();
        expect(current().error).toContain('503');
    } finally { fetch.mockRestore(); }
});

test('configuration response replaces all dependent choices and failed changes retain them', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(controls));
    try {
        await render(session);
        const replacement = { ...controls, configOptions: [{ id: 'reasoning', name: 'Reasoning', type: 'select', currentValue: 'high', options: [{ value: 'high', name: 'High' }] }] };
        fetch.mockResolvedValue(Response.json(replacement));
        await act(async () => { await current().change('model', 'large'); });
        expect(current().controls).toEqual(replacement);
        fetch.mockResolvedValue(Response.json({ error: 'Agent refused' }, { status: 400 }));
        await act(async () => { await current().change('reasoning', 'low'); });
        expect(current().controls).toEqual(replacement);
        expect(current().error).toBe('Agent refused');
        expect(current().changing).toBe(false);
    } finally { fetch.mockRestore(); }
});
