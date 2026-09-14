import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const Status = { ok: 200, badRequest: 400, notFound: 404, unavailable: 503 };
const Header = { type: 'Content-Type', cache: 'Cache-Control', csp: 'Content-Security-Policy' };
const INDEX = 'index.html';
const RECOVERY = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>OpenChamber</title><body><main><h1>OpenChamber</h1>
<p>Application files are missing or unreadable. Close OpenChamber and launch the portable executable again, or restore the application files. Your chats and settings have not been reset.</p>
<p lang="zh">应用文件缺失或无法读取。请关闭 OpenChamber 后重新运行便携版程序，或恢复应用文件。聊天和设置未被重置。</p>
<a href="">Retry / 重试</a></main></body></html>`;

// The recovery document lives in the main bundle, so it needs no web assets.
export const createPackagedUiHandler = ({ getDistPath, injectHtml, fetchFile, log }) => async (request) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response(null, { status: Status.badRequest });
  }
  const dist = getDistPath();
  const segments = pathname.replace(/\\/g, '/').split('/');
  if (segments.includes('..') || pathname.includes('\0') || pathname.includes(':')) {
    return new Response(null, { status: Status.badRequest });
  }
  const file = path.resolve(dist, '.' + '/' + segments.filter(Boolean).join('/'));
  const relative = path.relative(dist, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return new Response(null, { status: Status.badRequest });
  }
  const document = !relative || relative.endsWith('.html') || (request.mode === 'navigate' && !path.extname(relative));
  if (!document) {
    try {
      const response = await fetchFile(pathToFileURL(file).toString());
      if (response.ok) return response;
      await response.body?.cancel();
    } catch {
      // Missing subresources must not receive the SPA HTML as JavaScript/media.
    }
    return new Response(null, { status: Status.notFound, headers: { [Header.cache]: 'no-store' } });
  }
  try {
    const html = await readFile(relative.endsWith('.html') ? file : path.join(dist, INDEX), 'utf8');
    return new Response(injectHtml(html), {
      status: Status.ok,
      headers: { [Header.type]: 'text/html; charset=utf-8', [Header.cache]: 'no-store' },
    });
  } catch (error) {
    log.error('[electron] packaged UI unavailable', { code: error?.code || 'UI_LOAD_FAILED' });
    return new Response(RECOVERY, {
      status: Status.unavailable,
      headers: {
        [Header.type]: 'text/html; charset=utf-8', [Header.cache]: 'no-store',
        [Header.csp]: "default-src 'none'; frame-ancestors 'self'; base-uri 'none'",
      },
    });
  }
};
