import type { Message as LegacyMessage, Part as LegacyPart, Session as LegacySession } from '@opencode-ai/sdk/v2';
import { z } from 'zod';
import { compact, type Message, type Metadata, type Part, type Session, type ToolState } from '../model';

const jsonRecord = z.record(z.string(), z.json());

const record = (value: NonNullable<LegacySession['metadata']>): Metadata => jsonRecord.parse(value);

/** OC1 ids and optional records retain their server-assigned values. */
export const projectLegacySession = (info: LegacySession): Session => compact({
  ...info,
  metadata: info.metadata ? record(info.metadata) : undefined,
});

export const projectLegacyMessage = (info: LegacyMessage): Message => {
  if (info.role === 'user') {
    return compact({
      ...info,
      format: info.format?.type === 'json_schema'
        ? { ...info.format, schema: record(info.format.schema) }
        : info.format,
    });
  }
  const error = info.error?.name === 'MessageOutputLengthError'
    ? { ...info.error, data: record(info.error.data) }
    : info.error;
  return compact({
    ...info,
    error,
    structured: info.structured === undefined ? undefined : z.json().parse(info.structured),
  });
};

const projectState = (state: Extract<LegacyPart, { type: 'tool' }>['state']): ToolState => {
  switch (state.status) {
    case 'pending': return { ...state, input: record(state.input) };
    case 'running': return compact({
      ...state, input: record(state.input), metadata: state.metadata ? record(state.metadata) : undefined,
    });
    case 'completed': return {
      ...state, input: record(state.input), metadata: record(state.metadata),
      attachments: state.attachments?.map((part) => ({ ...part })),
    };
    case 'error': return compact({
      ...state, input: record(state.input), metadata: state.metadata ? record(state.metadata) : undefined,
    });
  }
};

export const projectLegacyPart = (part: LegacyPart): Part => {
  switch (part.type) {
    case 'text':
    case 'reasoning': return compact({ ...part, metadata: part.metadata ? record(part.metadata) : undefined });
    case 'tool': return compact({ ...part, state: projectState(part.state), metadata: part.metadata ? record(part.metadata) : undefined });
    default: return { ...part };
  }
};

export const projectLegacyMessages = (records: Array<{ info: LegacyMessage; parts: LegacyPart[] }>): Array<{ info: Message; parts: Part[] }> =>
  records.map(({ info, parts }) => ({ info: projectLegacyMessage(info), parts: parts.map(projectLegacyPart) }));
