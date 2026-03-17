import { interrupt } from '@langchain/langgraph';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import type { AgentState } from '../state/agent.state';

/**
 * Pauses graph execution for human plan review.
 *
 * LangGraph's interrupt() persists state and halts until the app is resumed
 * via app.invoke(null, config) after app.updateState() sets the next phase.
 *
 * Endpoints that drive resumption:
 *   POST /agents/session/:id/approve  → beginExecutionStep(first, 0)
 *   POST /agents/session/:id/reject   → failAgentRun(...)
 *   POST /agents/session/:id/replan   → transitionToPhase(RESEARCH, ...)
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function awaitPlanReviewNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('AWAIT_PLAN_REVIEW', `steps=${state.plan?.length ?? 0}`);

  interrupt({
    type: 'plan_review',
    reviewRequest: state.reviewRequest,
  });

  // Only reached when the graph is resumed after updateState().
  logPhaseEnd('AWAIT_PLAN_REVIEW', 'RESUMED', elapsed());
  return {};
}
