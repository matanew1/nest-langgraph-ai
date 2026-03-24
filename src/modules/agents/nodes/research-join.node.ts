import { Logger } from '@nestjs/common';
import { AGENT_PHASES } from '@state/agent-phase';
import { transitionToPhase } from '@state/agent-transition.util';
import type { AgentState } from '@state/agent.state';

const logger = new Logger('ResearchJoin');

/**
 * RESEARCH_JOIN node — waits for both research_fs and research_vector to complete,
 * then transitions the pipeline to the plan phase.
 *
 * LangGraph's fan-in semantics ensure this node only runs after BOTH
 * research_fs and research_vector have written their results to state.
 */
export function researchJoinNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(
    `Both research branches complete — transitioning to plan (phase was: ${state.phase})`,
  );
  return Promise.resolve(transitionToPhase(AGENT_PHASES.PLAN));
}
