import { END } from '@langchain/langgraph';
import { criticNode } from '../nodes/critic.node';
import { decisionRouterNode } from '../nodes/decision-router.node';
import { executionNode } from '../nodes/execution.node';
import { jsonRepairNode } from '../nodes/json-repair.node';
import { planValidatorNode } from '../nodes/plan-validator.node';
import { plannerNode } from '../nodes/planner.node';
import { researcherNode } from '../nodes/researcher.node';
import { supervisorNode } from '../nodes/supervisor.node';
import { terminalResponseNode } from '../nodes/terminal-response.node';
import {
  AGENT_PHASES,
  ROUTABLE_AGENT_PHASES,
  type AgentPhase,
  type RoutableAgentPhase,
} from '../state/agent-phase';
import { toolResultNormalizerNode } from '../nodes/tool-result-normalizer.node';
import type { AgentState } from '../state/agent.state';

export const AGENT_GRAPH_NODES = {
  SUPERVISOR: 'supervisor',
  RESEARCHER: 'researcher',
  PLANNER: 'planner',
  PLAN_VALIDATOR: 'plan_validator',
  EXECUTE: 'execute',
  TOOL_RESULT_NORMALIZER: 'tool_result_normalizer',
  CRITIC: 'critic',
  JSON_REPAIR: 'json_repair',
  TERMINAL_RESPONSE: 'terminal_response',
  ROUTER: 'router',
} as const;

export type AgentGraphNodeName =
  (typeof AGENT_GRAPH_NODES)[keyof typeof AGENT_GRAPH_NODES];

type AgentNodeHandler = (
  state: AgentState,
) => Promise<Partial<AgentState>>;

export const AGENT_GRAPH_NODE_HANDLERS: Record<
  AgentGraphNodeName,
  AgentNodeHandler
> = {
  [AGENT_GRAPH_NODES.SUPERVISOR]: supervisorNode,
  [AGENT_GRAPH_NODES.RESEARCHER]: researcherNode,
  [AGENT_GRAPH_NODES.PLANNER]: plannerNode,
  [AGENT_GRAPH_NODES.PLAN_VALIDATOR]: planValidatorNode,
  [AGENT_GRAPH_NODES.EXECUTE]: executionNode,
  [AGENT_GRAPH_NODES.TOOL_RESULT_NORMALIZER]: toolResultNormalizerNode,
  [AGENT_GRAPH_NODES.CRITIC]: criticNode,
  [AGENT_GRAPH_NODES.JSON_REPAIR]: jsonRepairNode,
  [AGENT_GRAPH_NODES.TERMINAL_RESPONSE]: terminalResponseNode,
  [AGENT_GRAPH_NODES.ROUTER]: decisionRouterNode,
};

const ROUTABLE_PHASE_NODE_MAP: Record<
  RoutableAgentPhase,
  AgentGraphNodeName
> = {
  [AGENT_PHASES.SUPERVISOR]: AGENT_GRAPH_NODES.SUPERVISOR,
  [AGENT_PHASES.RESEARCH]: AGENT_GRAPH_NODES.RESEARCHER,
  [AGENT_PHASES.PLAN]: AGENT_GRAPH_NODES.PLANNER,
  [AGENT_PHASES.VALIDATE_PLAN]: AGENT_GRAPH_NODES.PLAN_VALIDATOR,
  [AGENT_PHASES.EXECUTE]: AGENT_GRAPH_NODES.EXECUTE,
  [AGENT_PHASES.NORMALIZE_TOOL_RESULT]:
    AGENT_GRAPH_NODES.TOOL_RESULT_NORMALIZER,
  [AGENT_PHASES.JUDGE]: AGENT_GRAPH_NODES.CRITIC,
  [AGENT_PHASES.FATAL_RECOVERY]: AGENT_GRAPH_NODES.TERMINAL_RESPONSE,
  [AGENT_PHASES.CLARIFICATION]: AGENT_GRAPH_NODES.TERMINAL_RESPONSE,
};

export const ROUTER_RETURN_NODES = (
  Object.values(AGENT_GRAPH_NODES) as AgentGraphNodeName[]
).filter((node) => node !== AGENT_GRAPH_NODES.ROUTER);

export function resolveRouterTarget(
  state: Pick<AgentState, 'phase' | 'jsonRepair'>,
): AgentGraphNodeName | typeof END {
  if (state.phase === AGENT_PHASES.COMPLETE) return END;
  if (state.jsonRepair) return AGENT_GRAPH_NODES.JSON_REPAIR;
  if (state.phase === AGENT_PHASES.FATAL) {
    return AGENT_GRAPH_NODES.TERMINAL_RESPONSE;
  }

  if (
    (ROUTABLE_AGENT_PHASES as readonly AgentPhase[]).includes(state.phase) &&
    state.phase in ROUTABLE_PHASE_NODE_MAP
  ) {
    return ROUTABLE_PHASE_NODE_MAP[
      state.phase as keyof typeof ROUTABLE_PHASE_NODE_MAP
    ];
  }

  return AGENT_GRAPH_NODES.SUPERVISOR;
}
