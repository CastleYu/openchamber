import { z } from 'zod';

import { spaceCreationStepSchema } from '@/lib/spaces/spaces-api';

const spaceId = z.string().regex(/^[0-9a-f]{12}$/);

const stream = z.object({
  type: z.literal('openchamber:space-stream'),
  properties: z.object({
    spaceId,
    status: z.enum(['connected', 'disconnected']),
    wasReady: z.boolean(),
  }),
});

const progress = z.object({
  type: z.literal('openchamber:space-progress'),
  properties: z.object({
    spaceId,
    step: z.union([spaceCreationStepSchema, z.literal('failed')]),
    failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  }),
});

const setup = z.object({
  type: z.literal('openchamber:space-setup'),
  properties: z.object({ spaceId }),
});

const announcement = z.discriminatedUnion('type', [stream, progress, setup]);

export type SpaceAnnouncement = z.infer<typeof announcement>;
export type SpaceProgress = z.infer<typeof progress>['properties'];

export const parseSpaceAnnouncement = (payload: z.infer<ReturnType<typeof z.json>>): SpaceAnnouncement | null => {
  const parsed = announcement.safeParse(payload);
  return parsed.success ? parsed.data : null;
};
