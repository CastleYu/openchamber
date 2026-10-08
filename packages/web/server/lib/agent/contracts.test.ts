import { expectTypeOf, it } from 'vitest';
import { AGENT_FEATURE, AGENT_OPERATION, AGENT_PART, AGENT_TOOL_STATE } from './constants.js';
import { createAgentDispatcher, type AgentAvailability, type AgentInputs, type AgentMessage, type AgentOperation, type AgentOutputs, type AgentPart, type AgentPermission, type AgentRuntime, type AgentSession } from './dispatcher.js';
import { createAgentAuthority, type AgentApproval, type AgentSelection } from './authority.js';
import { agentArtifactDigest, verifyAgentArtifacts, type AgentArtifactFile, type AgentArtifactManifest } from './artifacts.js';
import { agentApprovalName, createAgentApprovals } from './approvals.js';
import { createAgentFeatures, type AgentFeature, type AgentFeatureSnapshot, type AgentHostSupport } from './features.js';

it('keeps current host feature support and exact feature keys typed', () => {
  const dispatcher = createAgentDispatcher({ getBinding: () => null });
  const features = createAgentFeatures({ getRuntime: dispatcher.describeRuntime,
    getHostSupport: (): AgentHostSupport | null => null });
  expectTypeOf(features.describe).returns.toEqualTypeOf<AgentFeatureSnapshot>();
  expectTypeOf<keyof AgentFeatureSnapshot['features']>().toEqualTypeOf<AgentFeature>();
  expectTypeOf(features.requireFeature).parameter(1).toEqualTypeOf<import('./dispatcher.js').AgentIdentity>();
  const check = () => {
    // @ts-expect-error Arbitrary candidate actions cannot create a host feature.
    features.requireFeature('candidateAction', dispatcher.captureIdentity());
    // @ts-expect-error Feature authorization requires an exact expected identity.
    features.requireFeature(AGENT_FEATURE.PROMPT);
  };
  expectTypeOf(check).toBeFunction();
});

it('keeps the protected approval reader synchronous and host-owned', () => {
  const reader = createAgentApprovals({ directory: 'protected-approvals' });
  expectTypeOf(reader.read).parameter(0).toEqualTypeOf<AgentSelection>();
  expectTypeOf(reader.read).returns.toEqualTypeOf<AgentApproval | null>();
  expectTypeOf(agentApprovalName).returns.toBeString();
  const check = () => {
    // @ts-expect-error The approval reader exposes no candidate-controlled write port.
    reader.write({});
    // @ts-expect-error A candidate family alone is not an authorized current selection.
    reader.read({ family: 'cagent' });
  };
  expectTypeOf(check).toBeFunction();
});

it('keeps protected artifact manifests and verification results typed', () => {
  expectTypeOf(agentArtifactDigest).parameter(0).toEqualTypeOf<readonly AgentArtifactFile[]>();
  expectTypeOf<AgentArtifactManifest['version']>().toEqualTypeOf<1>();
  expectTypeOf(verifyAgentArtifacts).returns.resolves.toEqualTypeOf<Readonly<{ artifactDigest: string; files: number }>>();
  const check = () => {
    // @ts-expect-error A candidate digest alone does not describe the protected files.
    verifyAgentArtifacts({ directory: 'snapshot', manifest: { version: 1, artifactDigest: 'digest' } });
    // @ts-expect-error Artifact byte lengths must be numeric.
    agentArtifactDigest([{ path: 'adapter.js', bytes: '1', digest: 'digest' }]);
  };
  expectTypeOf(check).toBeFunction();
});

it('preserves operation-specific inputs and results without SDK wire types', () => {
  const dispatcher = createAgentDispatcher({ getBinding: () => null });
  const request = { workspaceID: 'remote-workspace', sessionID: 'conversation' };
  expectTypeOf(request).toExtend<AgentInputs[typeof AGENT_OPERATION.GET_SESSION]>();
  expectTypeOf<AgentOutputs[typeof AGENT_OPERATION.GET_SESSION]>().toEqualTypeOf<AgentSession>();
  expectTypeOf<keyof AgentInputs>().toEqualTypeOf<AgentOperation>();
  expectTypeOf<keyof AgentOutputs>().toEqualTypeOf<AgentOperation>();

  // Compile-only calls verify that the operation selects its own contract.
  const check = () => {
    const result = dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, request);
    expectTypeOf(result).resolves.toHaveProperty('data').toEqualTypeOf<AgentSession>();
    // @ts-expect-error A conversation ID does not provide workspace ownership.
    dispatcher.dispatch(AGENT_OPERATION.GET_SESSION, { sessionID: 'conversation' });
    // @ts-expect-error Prompt dispatch requires durable request identity and text.
    dispatcher.dispatch(AGENT_OPERATION.SEND_PROMPT, request);
    // @ts-expect-error Unknown operation IDs cannot select a generic payload.
    dispatcher.dispatch('unregistered', request);
  };
  expectTypeOf(check).toEqualTypeOf<() => void>();
});

it('keeps selection and independent approval in typed host ports', () => {
  const authority = createAgentAuthority({
    registrations: [], getSelection: () => null,
    getAcceptance: (selection) => {
      expectTypeOf(selection).toEqualTypeOf<AgentSelection>();
      return null;
    },
  });
  const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
  expectTypeOf(dispatcher.describeRuntime).returns.toEqualTypeOf<AgentRuntime>();
  expectTypeOf<keyof AgentRuntime['operations']>().toEqualTypeOf<AgentOperation>();
  expectTypeOf<AgentRuntime['operations'][AgentOperation]>().toEqualTypeOf<AgentAvailability>();
  expectTypeOf(dispatcher.captureIdentity).returns.toHaveProperty('connectionID').toBeString();
  expectTypeOf<AgentApproval['operations'][number]['operation']>().toEqualTypeOf<AgentOperation>();
  const check = () => {
    // @ts-expect-error Selection must bind a tested server revision and readiness.
    createAgentAuthority({ registrations: [], getSelection: () => ({ family: 'cagent' }), getAcceptance: () => null });
    // @ts-expect-error Approval rows require independent evidence, not operation IDs alone.
    const operations: AgentApproval['operations'] = [AGENT_OPERATION.GET_SESSION];
    return operations;
  };
  expectTypeOf(check).toBeFunction();
});

it('preserves message parts and decision semantics without invented metadata', () => {
  expectTypeOf<AgentOutputs[typeof AGENT_OPERATION.GET_MESSAGE]>().toEqualTypeOf<AgentMessage>();
  expectTypeOf<AgentMessage['model']>().toEqualTypeOf<{ id: string; providerID?: string; variant?: string } | undefined>();
  expectTypeOf<AgentMessage['time']>().toEqualTypeOf<{ created?: number; completed?: number } | undefined>();
  expectTypeOf<AgentPermission['choices'][number]['scope']>().toEqualTypeOf<'once' | 'session' | 'persistent'>();
  const check = () => {
    // @ts-expect-error A completed tool must supply its result, including an explicit null result.
    const incomplete: AgentPart = { id: 'p', type: AGENT_PART.TOOL, callID: 'c', name: 'tool', state: { status: AGENT_TOOL_STATE.COMPLETE } };
    // @ts-expect-error A direct remote URL is not an owned attachment reference.
    const remote: AgentPart = { id: 'p', type: AGENT_PART.ATTACHMENT, assetID: 'a', mime: 'text/plain', url: 'https://example.invalid' };
    // @ts-expect-error Permission choices carry outcome and scope, not free strings.
    const permission: AgentPermission = { id: 'p', sessionID: 's', description: '', choices: ['allow'] };
    return [incomplete, remote, permission];
  };
  expectTypeOf(check).toBeFunction();
});
