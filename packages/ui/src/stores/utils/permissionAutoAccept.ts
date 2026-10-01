import type { Session } from "@/lib/opencode/model";
import { z } from 'zod';

export type PermissionAutoAcceptMap = Record<string, boolean>;
export type PermissionMode = 'ask' | 'safety' | 'auto';
export type PermissionModeMap = Record<string, PermissionMode>;

export const permissionModeSchema = z.enum(['ask', 'safety', 'auto']);
export const permissionPolicyWireSchema = z.object({
  sessions: z.record(z.string().min(1), z.boolean()),
  modes: z.record(z.string().min(1), permissionModeSchema).optional(),
  revision: z.number().int().nonnegative().optional(),
});

export const policySnapshotFromWire = (wire: z.infer<typeof permissionPolicyWireSchema>) => ({
  sessions: wire.sessions,
  modes: wire.modes ?? Object.fromEntries(Object.entries(wire.sessions).map(([id, enabled]) => [id, enabled ? 'auto' as const : 'ask' as const])),
  revision: wire.revision,
});

export const displayedPermissionMode = (mode: PermissionMode, safetyAvailable: boolean): PermissionMode =>
  mode === 'safety' && !safetyAvailable ? 'ask' : mode;

export const nextPermissionMode = (mode: PermissionMode, safetyAvailable: boolean): PermissionMode => {
  const shown = displayedPermissionMode(mode, safetyAvailable);
  if (shown === 'ask') return safetyAvailable ? 'safety' : 'auto';
  return shown === 'safety' ? 'auto' : 'ask';
};

const buildSessionMap = (sessions: Session[]): Map<string, Session> => {
  const map = new Map<string, Session>();
  for (const session of sessions) {
    map.set(session.id, session);
  }
  return map;
};

const resolveLineage = (
  sessionID: string,
  sessions: Session[],
  sessionById?: ReadonlyMap<string, Session>,
): string[] => {
  const map = sessionById ?? buildSessionMap(sessions);
  const result: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = sessionID;

  while (current && !seen.has(current)) {
    seen.add(current);
    result.push(current);
    current = map.get(current)?.parentID;
  }

  return result;
};

export const autoRespondsPermission = (input: {
  autoAccept: PermissionAutoAcceptMap;
  sessions: Session[];
  sessionById?: ReadonlyMap<string, Session>;
  sessionID: string;
}): boolean => {
  const { autoAccept, sessions, sessionById, sessionID } = input;
  if (Object.keys(autoAccept).length === 0) return false;
  const lineage = resolveLineage(sessionID, sessions, sessionById);

  for (const id of lineage) {
    if (!Object.prototype.hasOwnProperty.call(autoAccept, id)) {
      continue;
    }
    return autoAccept[id] === true;
  }

  return false;
};

export const resolvePermissionMode = (input: {
  modes: PermissionModeMap;
  sessions: Session[];
  sessionById?: ReadonlyMap<string, Session>;
  sessionID: string;
}): PermissionMode | null => {
  const { modes, sessions, sessionById, sessionID } = input;
  for (const id of resolveLineage(sessionID, sessions, sessionById)) {
    if (Object.prototype.hasOwnProperty.call(modes, id)) return modes[id];
  }
  return null;
};
