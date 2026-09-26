import type { opencodeClient } from '@/lib/opencode/client';
import type { Message, Part, Session } from '@/lib/opencode/model';
import { flattenAssistantTextParts } from '@/lib/messages/messageText';
import { getMultiRunIdentity, isFusionSource, type MultiRunIdentity } from './identity';
import type { MultiRunGeneration } from './createSession';

export type FusionSource = {
  session: Session;
  directory: string | null;
  projectDirectory: string | null;
  identity: MultiRunIdentity;
};

type FusionApi = Pick<typeof opencodeClient, 'getSession' | 'getSessionMessages'>;
type MessageRecord = { info: Message; parts: Part[] };

const latestAssistant = (records: MessageRecord[], generation: MultiRunGeneration): MessageRecord | undefined => {
  let selected: MessageRecord | undefined;
  for (const record of records) {
    if (record.info.role !== 'assistant') continue;
    if (!selected || record.info.time.created > selected.info.time.created
      || (record.info.time.created === selected.info.time.created && generation === 'oc1')) selected = record;
  }
  return selected;
};

/** Revalidate selected IDs before reading their output. A failed read is not an empty result. */
export async function loadFusionOutputs(
  api: FusionApi,
  sources: FusionSource[],
  anchor: MultiRunIdentity,
  generation: MultiRunGeneration,
  assertCurrent: () => void,
): Promise<Array<{ source: FusionSource; text: string }>> {
  const outputs = await Promise.all(sources.map(async (source) => {
    assertCurrent();
    const directory = source.directory ?? source.session.directory;
    const current = await api.getSession(source.session.id, directory);
    assertCurrent();
    if (!isFusionSource(anchor, getMultiRunIdentity(current, source.projectDirectory ?? current.directory))) {
      throw new Error('Fusion source membership changed');
    }
    const records = await api.getSessionMessages(source.session.id, 50, directory);
    assertCurrent();
    const answer = latestAssistant(records, generation);
    return { source: { ...source, session: current }, text: answer ? flattenAssistantTextParts(answer.parts).trim() : '' };
  }));
  assertCurrent();
  return outputs.filter((output) => output.text.length > 0);
}
