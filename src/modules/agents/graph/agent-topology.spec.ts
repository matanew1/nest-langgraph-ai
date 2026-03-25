jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    promptMaxAttempts: 5,
    agentWorkingDir: '/tmp',
    promptMaxSummaryChars: 2000,
    tavilyApiKey: 'mock-tavily-key',
    mistralApiKey: 'mock-mistral-key',
  },
}));

jest.mock('@llm/llm.provider', () => ({
  llm: {},
  invokeLlm: jest.fn(),
}));

jest.mock('../nodes/supervisor.node', () => ({ supervisorNode: jest.fn() }));
jest.mock('../nodes/researcher-coordinator.node', () => ({
  researcherCoordinatorNode: jest.fn(),
}));
jest.mock('../nodes/research-fs.node', () => ({ researchFsNode: jest.fn() }));
jest.mock('../nodes/research-vector.node', () => ({
  researchVectorNode: jest.fn(),
}));
jest.mock('../nodes/research-join.node', () => ({
  researchJoinNode: jest.fn(),
}));
jest.mock('../nodes/planner.node', () => ({ plannerNode: jest.fn() }));
jest.mock('../nodes/plan-validator.node', () => ({
  planValidatorNode: jest.fn(),
}));
jest.mock('../nodes/await-plan-review.node', () => ({
  awaitPlanReviewNode: jest.fn(),
}));
jest.mock('../nodes/execution.node', () => ({ executionNode: jest.fn() }));
jest.mock('../nodes/parallel-execution.node', () => ({
  parallelExecutionNode: jest.fn(),
}));
jest.mock('../nodes/tool-result-normalizer.node', () => ({
  toolResultNormalizerNode: jest.fn(),
}));
jest.mock('../nodes/critic.node', () => ({ criticNode: jest.fn() }));
jest.mock('../nodes/generator.node', () => ({ generatorNode: jest.fn() }));
jest.mock('../nodes/chat.node', () => ({ chatNode: jest.fn() }));
jest.mock('../nodes/terminal-response.node', () => ({
  terminalResponseNode: jest.fn(),
}));
jest.mock('../nodes/decision-router.node', () => ({
  decisionRouterNode: jest.fn(),
}));

import { END } from '@langchain/langgraph';
import {
  AGENT_GRAPH_NODES,
  ROUTER_RETURN_NODES,
  resolveRouterTarget,
} from './agent-topology';

describe('agent-topology', () => {
  it('routes completion directly to END', () => {
    expect(resolveRouterTarget({ phase: 'complete' })).toBe(END);
  });

  it('routes fatal states to fatal recovery', () => {
    expect(resolveRouterTarget({ phase: 'fatal' })).toBe(
      AGENT_GRAPH_NODES.TERMINAL_RESPONSE,
    );
  });

  it('routes non-progress fallback phases to supervisor', () => {
    expect(resolveRouterTarget({ phase: 'route' })).toBe(
      AGENT_GRAPH_NODES.SUPERVISOR,
    );
  });

  it('returns every non-router node back to the router', () => {
    expect(ROUTER_RETURN_NODES).toContain(AGENT_GRAPH_NODES.TERMINAL_RESPONSE);
    expect(ROUTER_RETURN_NODES).not.toContain(AGENT_GRAPH_NODES.ROUTER);
  });

  it('excludes fan-out and fan-in source nodes from ROUTER_RETURN_NODES', () => {
    // Coordinator uses Send() — no static edge to router
    expect(ROUTER_RETURN_NODES).not.toContain(
      AGENT_GRAPH_NODES.RESEARCHER_COORDINATOR,
    );
    // Sub-nodes have static edges → research_join, not router
    expect(ROUTER_RETURN_NODES).not.toContain(AGENT_GRAPH_NODES.RESEARCH_FS);
    expect(ROUTER_RETURN_NODES).not.toContain(
      AGENT_GRAPH_NODES.RESEARCH_VECTOR,
    );
  });

  it('includes research_join in ROUTER_RETURN_NODES', () => {
    expect(ROUTER_RETURN_NODES).toContain(AGENT_GRAPH_NODES.RESEARCH_JOIN);
  });

  it('routes research phase to researcher_coordinator', () => {
    expect(resolveRouterTarget({ phase: 'research' })).toBe(
      AGENT_GRAPH_NODES.RESEARCHER_COORDINATOR,
    );
  });

  it('routes research_join phase to research_join node', () => {
    expect(resolveRouterTarget({ phase: 'research_join' })).toBe(
      AGENT_GRAPH_NODES.RESEARCH_JOIN,
    );
  });
});
