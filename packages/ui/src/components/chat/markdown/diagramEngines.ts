import DOMPurify from 'dompurify';
import { z } from 'zod';

type MermaidStyle = 'native' | 'forest' | 'neutral' | 'hand-drawn';

const importMermaid = () => import('mermaid');
type MermaidModule = Awaited<ReturnType<typeof importMermaid>>;

type PlantUmlModule = typeof import('@plantuml/core');

const MAX_SVG_SIZE = 8192;
const mermaidPalette = z.object({ background: z.string() });
const DISALLOWED_PLANTUML_DIRECTIVE = /^\s*!(?:include\w*|import)\b|^\s*!theme\s+\S+\s+from\b|%(?:load_json|load_yaml|load_xml)\s*\(|<img\s*:/im;

let queue: Promise<void> = Promise.resolve();
let mermaidPromise: Promise<MermaidModule> | null = null;
let plantUmlPromise: Promise<PlantUmlModule> | null = null;
let renderId = 0;

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const result = queue.then(task, task);
  queue = result.then(() => undefined, () => undefined);
  return result;
};

const hasExternalCss = (css: string): boolean => {
  if (/@import/i.test(css)) return true;
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) {
    if (!(match[1] ?? match[2] ?? match[3]).startsWith('#')) return true;
  }
  return false;
};

const sanitizeSvg = (svg: string, background: string): string => {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'image'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onanimationstart'],
    RETURN_TRUSTED_TYPE: false,
  });

  const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg') throw new Error('The renderer returned invalid SVG');
  const style = root.getAttribute('style') ?? '';
  if (!/(?:^|;)\s*background(?:-color)?\s*:/.test(style)) {
    root.setAttribute('style', `${style};background-color:${background}`);
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.tagName.toLowerCase() === 'style' && hasExternalCss(element.textContent ?? '')) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on')
        || ((name === 'src' || name === 'href' || name === 'xlink:href') && !attribute.value.startsWith('#'))
        || hasExternalCss(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(root);
};

const loadMermaid = async (): Promise<MermaidModule> => {
  mermaidPromise ??= importMermaid();
  return mermaidPromise;
};

const loadPlantUml = async (): Promise<PlantUmlModule> => {
  plantUmlPromise ??= (async () => {
    Object.assign(globalThis, {
      PLANTUML_STDLIB_BASE: '',
      PLANTUML_STDLIB_LOADER: (_url: string, _onSuccess: () => void, onError: (message: string) => void) => {
        onError('PlantUML external resources are unavailable in the local renderer.');
        return true;
      },
    });
    await Promise.all([import('@plantuml/core/viz-global.js'), import('@plantuml/core/themes.js')]);
    return import('@plantuml/core');
  })();
  return plantUmlPromise;
};

const renderMermaidNow = async (source: string, style: MermaidStyle, dark: boolean): Promise<string> => {
  const { default: mermaid } = await loadMermaid();
  const theme = style === 'native' ? (dark ? 'dark' : 'default') : style === 'hand-drawn' ? (dark ? 'dark' : 'default') : style;
  const config: Parameters<typeof mermaid.initialize>[0] = {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    secure: ['securityLevel', 'startOnLoad', 'secure', 'theme', 'look', 'htmlLabels', 'themeCSS', 'flowchart', 'suppressErrorRendering'],
    theme,
  };
  if (style === 'hand-drawn') config.look = 'handDrawn';
  mermaid.initialize(config);
  const result = await mermaid.render(`openchamber-diagram-${renderId += 1}`, source);
  return sanitizeSvg(result.svg, mermaidPalette.parse(mermaid.mermaidAPI.getConfig().themeVariables).background);
};

const renderPlantUmlNow = async (source: string, dark: boolean, background: string): Promise<string> => {
  if (DISALLOWED_PLANTUML_DIRECTIVE.test(source)) {
    throw new Error('PlantUML external includes, images, and data loads are unavailable in the local renderer.');
  }
  const { renderToString } = await loadPlantUml();
  return new Promise((resolve, reject) => {
    renderToString(
      source.split(/\r\n|\r|\n/),
      (svg: string) => {
        try { resolve(sanitizeSvg(svg, background)); } catch (error) { reject(error); }
      },
      (message: string) => reject(new Error(message)),
      { dark, maxSvgSize: MAX_SVG_SIZE },
    );
  });
};

export const renderNativeMermaid = (source: string, style: MermaidStyle, dark: boolean): Promise<string> => (
  enqueue(() => renderMermaidNow(source, style, dark))
);

export const renderPlantUml = (source: string, dark: boolean, background: string): Promise<string> => (
  enqueue(() => renderPlantUmlNow(source, dark, background))
);
