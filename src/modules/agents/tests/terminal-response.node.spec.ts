import { terminalResponseNode } from '../nodes/terminal-response.node';
import { AGENT_PHASES } from '../state/agent-phase';
import type { AgentState } from '../state/agent.state';

describe('terminalResponseNode', () => {
  it('builds a clarification response from supervisor rejection metadata', async () => {
    const result = await terminalResponseNode({
      phase: AGENT_PHASES.CLARIFICATION,
      errors: [
        {
          code: 'unknown',
          message: 'Missing capability',
          atPhase: AGENT_PHASES.SUPERVISOR,
          details: { missing_capabilities: ['memory recall'] },
        },
      ],
    } as AgentState);

    expect(result.phase).toBe(AGENT_PHASES.COMPLETE);
    expect(result.finalAnswer).toContain('memory recall');
    expect(result.errors).toEqual([]);
  });

  it('builds a fatal response from the last error', async () => {
    const result = await terminalResponseNode({
      phase: AGENT_PHASES.FATAL_RECOVERY,
      errors: [
        {
          code: 'timeout',
          message: 'Exceeded max recovery turns',
          atPhase: AGENT_PHASES.ROUTE,
        },
      ],
    } as AgentState);

    expect(result.phase).toBe(AGENT_PHASES.COMPLETE);
    expect(result.finalAnswer).toContain('Exceeded max recovery turns');
  });
});
