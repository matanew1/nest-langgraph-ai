jest.mock('@llm/llm.provider', () => ({
  llm: {},
  invokeLlm: jest.fn(),
}));

import { END } from '@langchain/langgraph';
import {
  AGENT_GRAPH_NODES,
  ROUTER_RETURN_NODES,
  resolveRouterTarget,
} from './agent-topology';

describe('agent-topology', () => {
  it('routes completion directly to END', () => {
    expect(
      resolveRouterTarget({ phase: 'complete', jsonRepair: undefined } as any),
    ).toBe(END);
  });

  it('routes fatal states to fatal recovery', () => {
    expect(
      resolveRouterTarget({ phase: 'fatal', jsonRepair: undefined } as any),
    ).toBe(AGENT_GRAPH_NODES.FATAL_RECOVERY);
  });

  it('prioritizes the json repair node when jsonRepair is set', () => {
    expect(
      resolveRouterTarget({
        phase: 'plan',
        jsonRepair: {
          fromPhase: 'plan',
          raw: 'broken',
          schema: '{}',
        },
      } as any),
    ).toBe(AGENT_GRAPH_NODES.JSON_REPAIR);
  });

  it('routes non-progress fallback phases to supervisor', () => {
    expect(
      resolveRouterTarget({ phase: 'route', jsonRepair: undefined } as any),
    ).toBe(AGENT_GRAPH_NODES.SUPERVISOR);
  });

  it('returns every non-router node back to the router', () => {
    expect(ROUTER_RETURN_NODES).toContain(AGENT_GRAPH_NODES.CLARIFICATION);
    expect(ROUTER_RETURN_NODES).toContain(AGENT_GRAPH_NODES.FATAL_RECOVERY);
    expect(ROUTER_RETURN_NODES).not.toContain(AGENT_GRAPH_NODES.ROUTER);
  });
});
