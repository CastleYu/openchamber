import type { DiagnosticsAPI, LogsInfo } from '@openchamber/ui/lib/api/types';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';

export const createWebDiagnosticsAPI = (): DiagnosticsAPI => ({
  async getLogsInfo(): Promise<LogsInfo> {
    const response = await runtimeFetch('/api/logs/info');
    if (!response.ok) {
      throw new Error(`Failed to load log info: ${response.statusText}`);
    }
    // SAFETY: /api/logs/info is an OpenChamber route owned by this repo; the
    // JSON body is the contract produced by registerLogsRoutes in
    // server/lib/logs/routes.js.
    const info = (await response.json()) as Partial<LogsInfo> | null;
    if (!info?.directory) {
      throw new Error('Invalid logs info response');
    }
    return {
      directory: info.directory,
      current: info.current ?? null,
      files: Array.isArray(info.files) ? info.files : [],
    };
  },

  async downloadLogs(fileName?: string): Promise<{ fileName: string; content: string }> {
    const query = fileName ? `?file=${encodeURIComponent(fileName)}` : '';
    const response = await runtimeFetch(`/api/logs/download${query}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to download log file: ${response.statusText}`);
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    return {
      fileName: match?.[1] ?? fileName ?? 'openchamber.log',
      content: await response.text(),
    };
  },
});
