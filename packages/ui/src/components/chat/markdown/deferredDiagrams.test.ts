import { afterAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createDeferredDiagrams } from './deferredDiagrams';

const window = new Window();
const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
afterAll(() => {
  if (previous) Object.defineProperty(globalThis, 'document', previous);
  else Reflect.deleteProperty(globalThis, 'document');
  window.happyDOM.abort();
});

const block = (source: string, language = 'mermaid') => ({ html: `<pre><code class="language-${language}">${source}</code></pre>` });

describe('deferred diagrams', () => {
  test('does not load engines for ordinary Markdown or beautiful-mermaid', () => {
    let loads = 0;
    const renderer = createDeferredDiagrams('openchamber', false, 'white', async () => {
      loads += 1;
      throw new Error('Unexpected engine load');
    });
    expect(renderer.prepare([block('graph LR; A-->B')])).toBeNull();
    expect(renderer.prepare([{ html: '<p>Plain text</p>' }])).toBeNull();
    expect(loads).toBe(0);
  });

  test('decodes sources, reuses unchanged results and drops removed sources', async () => {
    const calls: string[] = [];
    const render = async (source: string) => { calls.push(source); return `<svg>${source}</svg>`; };
    const renderer = createDeferredDiagrams('native', false, 'white', async () => ({ renderNativeMermaid: render, renderPlantUml: render }));
    const blocks = [block('A &lt; B'), block('@startuml\nAlice -> Bob\n@enduml', 'puml')];
    await renderer.prepare(blocks);
    await renderer.prepare(blocks);
    expect(calls).toEqual(['A < B', '@startuml\nAlice -> Bob\n@enduml']);
    expect(renderer.read('A < B', false).svg).toBe('<svg>A < B</svg>');
    await renderer.prepare([blocks[1]]);
    expect(renderer.read('A < B', false)).toEqual({ pending: true });
  });

  test('one failed diagram preserves unrelated successful diagrams', async () => {
    const renderer = createDeferredDiagrams('native', false, 'white', async () => ({
      renderNativeMermaid: async () => '<svg/>',
      renderPlantUml: async () => { throw new Error('Invalid source'); },
    }));
    await renderer.prepare([block('good'), block('bad', 'plantuml')]);
    expect(renderer.read('good', false).svg).toBe('<svg/>');
    expect(renderer.read('bad', true)).toEqual({ failed: true });
  });

  test('a cancelled render cannot overwrite a newer source or queue its remaining diagrams', async () => {
    let finish: ((svg: string) => void) | undefined;
    const slow = new Promise<string>((resolve) => { finish = resolve; });
    const calls: string[] = [];
    const render = async (source: string) => {
      calls.push(source);
      return source === 'old' ? slow : `<svg>${source}</svg>`;
    };
    const renderer = createDeferredDiagrams('native', false, 'white', async () => ({ renderNativeMermaid: render, renderPlantUml: render }));
    const stale = renderer.prepare([block('old'), block('never')]);
    await Promise.resolve();
    renderer.cancel();
    await renderer.prepare([block('latest')]);
    finish?.('<svg>old</svg>');
    await stale;
    expect(calls).toEqual(['old', 'latest']);
    expect(renderer.read('latest', false).svg).toBe('<svg>latest</svg>');
    expect(renderer.read('old', false)).toEqual({ pending: true });
  });
});
