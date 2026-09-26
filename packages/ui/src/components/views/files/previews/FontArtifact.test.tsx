import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { FontArtifact } from './FontArtifact';

class ControlledFontFace implements FontFace {
  ascentOverride = 'normal';
  descentOverride = 'normal';
  display: FontDisplay = 'auto';
  family: string;
  featureSettings = 'normal';
  lineGapOverride = 'normal';
  readonly loaded: Promise<FontFace>;
  stretch = 'normal';
  style = 'normal';
  unicodeRange = 'U+0-10FFFF';
  weight = 'normal';
  readonly source: string | BufferSource;
  private resolveLoaded!: (face: FontFace) => void;
  private rejectLoaded!: (reason: Error) => void;
  private currentStatus: FontFaceLoadStatus = 'unloaded';

  constructor(family: string, source: string | BufferSource) {
    this.family = family;
    this.source = source;
    this.loaded = new Promise<FontFace>((resolve, reject) => {
      this.resolveLoaded = resolve;
      this.rejectLoaded = reject;
    });
  }

  get status(): FontFaceLoadStatus {
    return this.currentStatus;
  }

  load(): Promise<FontFace> {
    this.currentStatus = 'loading';
    return this.loaded;
  }

  resolve(): void {
    this.currentStatus = 'loaded';
    this.resolveLoaded(this);
  }

  reject(): void {
    this.currentStatus = 'error';
    this.rejectLoaded(new Error('fixture font load failed'));
  }
}

const installDOM = () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  const originalFontFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace');
  const originalFonts = Object.getOwnPropertyDescriptor(dom.document, 'fonts');
  const registered = new Set<FontFace>();
  const created: ControlledFontFace[] = [];
  const fonts = {
    add(face: FontFace) {
      registered.add(face);
      return fonts;
    },
    delete(face: FontFace) {
      return registered.delete(face);
    },
  };
  const FontFaceFixture = class extends ControlledFontFace {
    constructor(family: string, source: string | BufferSource) {
      super(family, source);
      created.push(this);
    }
  };
  Object.defineProperty(globalThis, 'FontFace', { configurable: true, writable: true, value: FontFaceFixture });
  Object.defineProperty(dom.document, 'fonts', { configurable: true, value: fonts });

  return {
    dom,
    registered,
    created,
    restore: async () => {
      if (originalFontFace) Object.defineProperty(globalThis, 'FontFace', originalFontFace);
      else Reflect.deleteProperty(globalThis, 'FontFace');
      if (originalFonts) Object.defineProperty(dom.document, 'fonts', originalFonts);
      else Reflect.deleteProperty(dom.document, 'fonts');
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      await dom.happyDOM.close();
    },
  };
};

test('loads a font, switches sources without letting old completions win, and unregisters faces', async () => {
  const fixture = installDOM();
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let src = '/font-first.woff2';
  const render = () => act(async () => {
    root.render(<I18nProvider><FontArtifact src={src} name="Fixture font" sizeBytes={128} /></I18nProvider>);
  });

  try {
    await render();
    expect(fixture.created).toHaveLength(1);
    const firstFace = fixture.created[0];
    expect(firstFace.source).toBe('url("/font-first.woff2")');
    expect(fixture.registered.has(firstFace)).toBe(true);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    src = '/font-second.woff2';
    await render();
    expect(fixture.created).toHaveLength(2);
    const secondFace = fixture.created[1];
    expect(secondFace.source).toBe('url("/font-second.woff2")');
    expect(fixture.registered.has(firstFace)).toBe(false);
    expect(fixture.registered.has(secondFace)).toBe(true);

    await act(async () => { firstFace.resolve(); });
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(container.textContent).not.toContain('The quick brown fox jumps over the lazy dog');

    await act(async () => { secondFace.resolve(); });
    expect(container.textContent).toContain('The quick brown fox jumps over the lazy dog');
    expect(fixture.registered.has(secondFace)).toBe(true);

    await act(async () => root.unmount());
    expect(fixture.registered.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    await fixture.restore();
  }
});

test('shows the translated load failure after FontFace rejects', async () => {
  const fixture = installDOM();
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<I18nProvider><FontArtifact src="/bad-font.woff2" name="Broken font" sizeBytes={null} /></I18nProvider>);
    });
    expect(fixture.created).toHaveLength(1);
    const face = fixture.created[0];
    expect(fixture.registered.has(face)).toBe(true);
    await act(async () => { face.reject(); });
    expect(container.textContent).toContain('This font could not be loaded.');
    expect(container.querySelector('.animate-spin')).toBeNull();

    await act(async () => root.unmount());
    expect(fixture.registered.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    await fixture.restore();
  }
});
