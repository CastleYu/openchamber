import { expectTypeOf, it } from 'vitest';
import { AGENT_OPERATION, AGENT_PART, AGENT_TOOL_STATE } from './constants.js';
import { createAgentDispatcher, type AgentAvailability, type AgentInputs, type AgentMessage, type AgentOperation, type AgentOutputs, type AgentPart, type AgentPermission, type AgentRuntime, type AgentSession } from './dispatcher.js';
import { createAgentAuthority, type AgentApproval, type AgentSelection } from './authority.js';

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
