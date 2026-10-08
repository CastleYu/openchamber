import { expectTypeOf, it } from 'vitest';
import { AGENT_OPERATION } from './constants.js';
import { createAgentDispatcher, type AgentInputs, type AgentOperation, type AgentOutputs, type AgentSession } from './dispatcher.js';

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
