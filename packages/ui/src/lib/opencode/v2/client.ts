import { OpenCode, type OpenCodeClient } from '@opencode/client';
import { createOpenCodeFetch } from '../transport';

const DIRECTORY_HEADER = 'x-opencode-directory';
const EVENT_CURSOR_HEADER = 'Last-Event-ID';

export type V2RuntimeClientConfig = {
  baseUrl: string;
  directory?: string;
  requestTimeoutMs?: number;
  assertProtocol?: () => void;
  lastEventID?: string;
};

/** SDK2 joins `/api/*` onto the supplied root, unlike SDK1's mount URL. */
export const createV2RuntimeClient = (config: V2RuntimeClientConfig): OpenCodeClient => OpenCode.make({
  baseUrl: config.baseUrl.replace(/\/api\/*$/, '') || '/',
  headers: {
    ...(config.directory ? { [DIRECTORY_HEADER]: encodeURIComponent(config.directory) } : {}),
    ...(config.lastEventID ? { [EVENT_CURSOR_HEADER]: config.lastEventID } : {}),
  },
  fetch: createOpenCodeFetch(config),
});
