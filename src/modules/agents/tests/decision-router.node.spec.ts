import { decisionRouterNode } from '@nodes/decision-router.node';
import type { AgentState } from '@state/agent.state';
import type { PlanStep } from '@state/agent.state';

jest.mock('@config/env', () => ({
  env: { agentMaxIterations: 3, agentMaxRetries: 3 },
}));

// Explicitly mock agent.config to guarantee deterministic limits regardless of
// module evaluation order (AGENT_LIMITS is computed from env at import time).
jest.mock('@graph/agent.config', () => ({
  AGENT_LIMITS: {
    turns: 25,
    toolCalls: 50,
    replans: 5,
    stepRetries: 5,
    supervisorFallbacks: 5,
  },
  AGENT_PLAN_LIMITS: { maxSteps: 20 },
  getAgentLimits: () => ({
    turns: 25,
    toolCalls: 50,
    replans: 5,
    stepRetries: 5,
    supervisorFallbacks: 5,
  }),
}));

const plan: PlanStep[] = [
  { step_id: 1, description: 's1', tool: 'search', input: { query: 'q' } },
  { step_id: 2, description: 's2', tool: 'read_file', input: { path: 'f' } },
];

const baseState: Partial<AgentState> = {
  phase: 'route',
  plan,
  currentStep: 0,
  counters: {
    turn: 0,
    toolCalls: 0,
    replans: 0,
    stepRetries: 0,
    supervisorFallbacks: 0,
  },
};

describe('decisionRouterNode', () => {
  it('returns complete on last step with complete decision', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      currentStep: 1,
      criticDecision: {
        decision: 'complete',
        reason: 'done',
        finalAnswer: 'the answer',
      },
    };
    const result = await decisionRouterNode(state as AgentState);
    expect(result.phase).toBe('generate');
  });

  it('advances to next step on advance decision', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      criticDecision: { decision: 'advance', reason: 'step ok' },
    };
    const result = await decisionRouterNode(state as AgentState);
    expect(result.phase).toBe('execute');
    expect(result.currentStep).toBe(1);
    expect(result.selectedTool).toBe('read_file');
  });

  it('does not consume the recovery-turn budget on normal plan progress', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      counters: {
        turn: 24,
        toolCalls: 1,
        replans: 0,
        stepRetries: 0,
        supervisorFallbacks: 0,
      },
      criticDecision: { decision: 'advance', reason: 'step ok' },
    };

    const result = await decisionRouterNode(state as AgentState);

    expect(result.phase).toBe('execute');
    expect(result.counters).toBeUndefined();
  });

  it('routes to replan and clears projectContext', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      projectContext: 'old context',
      memoryContext: 'old memory context',
      criticDecision: { decision: 'replan', reason: 'bad plan' },
    };
    const result = await decisionRouterNode(state as AgentState);
    expect(result.phase).toBe('research');
    expect(result.projectContext).toBeUndefined();
    expect(result.memoryContext).toBeUndefined();
  });

  it('terminates as fatal when max recovery turns exceeded', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      counters: {
        turn: 999,
        toolCalls: 0,
        replans: 0,
        stepRetries: 0,
        supervisorFallbacks: 0,
      },
    };
    const result = await decisionRouterNode(state as AgentState);
    expect(result.phase).toBe('fatal');
    expect(result.finalAnswer).toContain('max recovery turns');
  });

  it('routes to originating phase when jsonRepairResult is set', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      jsonRepairResult: '{\"status\":\"ok\",\"objective\":\"test\"}',
      jsonRepairFromPhase: 'supervisor',
    };
    const result = await decisionRouterNode(state as AgentState);
    expect(result.phase).toBe('supervisor');
    expect(result.jsonRepairFromPhase).toBeUndefined();
  });
});
