import { END, isGraphBubbleUp } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import { criticNode } from '../nodes/critic.node';
import { decisionRouterNode } from '../nodes/decision-router.node';
import { executionNode } from '../nodes/execution.node';
import { jsonRepairNode } from '../nodes/json-repair.node';
import { planValidatorNode } from '../nodes/plan-validator.node';
import { plannerNode } from '../nodes/planner.node';
import { researcherNode } from '../nodes/researcher.node';
import { supervisorNode } from '../nodes/supervisor.node';
import { terminalResponseNode } from '../nodes/terminal-response.node';
import { chatNode } from '../nodes/chat.node';
import { generatorNode } from '../nodes/generator.node';
import { awaitPlanReviewNode } from '../nodes/await-plan-review.node';
import {
  AGENT_PHASES,
  ROUTABLE_AGENT_PHASES,
  type AgentPhase,
  type RoutableAgentPhase,
} from '../state/agent-phase';
import { failAgentRun } from '../state/agent-transition.util';
import { toolResultNormalizerNode } from '../nodes/tool-result-normalizer.node';
import type { AgentState } from '../state/agent.state';

const topologyLogger = new Logger('AgentTopology');

export const AGENT_GRAPH_NODES = {
  SUPERVISOR: 'supervisor',
  RESEARCHER: 'researcher',
  PLANNER: 'planner',
  PLAN_VALIDATOR: 'plan_validator',
  AWAIT_PLAN_REVIEW: 'await_plan_review',
  EXECUTE: 'execute',
  TOOL_RESULT_NORMALIZER: 'tool_result_normalizer',
  CRITIC: 'critic',
  GENERATOR: 'generator',
  CHAT: 'chat',
  JSON_REPAIR: 'json_repair',
  TERMINAL_RESPONSE: 'terminal_response',
  ROUTER: 'router',
} as const;

export type AgentGraphNodeName =
  (typeof AGENT_GRAPH_NODES)[keyof typeof AGENT_GRAPH_NODES];

type AgentNodeHandler = (state: AgentState) => Promise<Partial<AgentState>>;

/**
 * Wrap a node handler in a try/catch that converts unhandled exceptions
 * into a FATAL phase transition instead of crashing the entire graph.
 * Router and terminal-response are excluded (they ARE the error recovery path).
 */
function safeNodeHandler(
  nodeName: string,
  handler: AgentNodeHandler,
): AgentNodeHandler {
  return async (state: AgentState) => {
    try {
      return await handler(state);
    } catch (error) {
      // LangGraph's interrupt() throws a GraphBubbleUp exception to pause the
      // graph.  We MUST re-throw it so the runtime can handle the interrupt
      // properly — catching it would silently convert pauses into fatal errors.
      if (isGraphBubbleUp(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      topologyLogger.error(`Unhandled error in node "${nodeName}": ${message}`);
      return failAgentRun(`Internal error in ${nodeName}: ${message}`, {
        code: 'unknown',
        message,
        atPhase: state.phase,
        details: {
          node: nodeName,
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  };
}

export const AGENT_GRAPH_NODE_HANDLERS: Record<
  AgentGraphNodeName,
  AgentNodeHandler
> = {
  [AGENT_GRAPH_NODES.SUPERVISOR]: safeNodeHandler('supervisor', supervisorNode),
  [AGENT_GRAPH_NODES.RESEARCHER]: safeNodeHandler('researcher', researcherNode),
  [AGENT_GRAPH_NODES.PLANNER]: safeNodeHandler('planner', plannerNode),
  [AGENT_GRAPH_NODES.PLAN_VALIDATOR]: safeNodeHandler(
    'plan_validator',
    planValidatorNode,
  ),
  [AGENT_GRAPH_NODES.AWAIT_PLAN_REVIEW]: safeNodeHandler(
    'await_plan_review',
    awaitPlanReviewNode,
  ),
  [AGENT_GRAPH_NODES.EXECUTE]: safeNodeHandler('execute', executionNode),
  [AGENT_GRAPH_NODES.TOOL_RESULT_NORMALIZER]: safeNodeHandler(
    'tool_result_normalizer',
    toolResultNormalizerNode,
  ),
  [AGENT_GRAPH_NODES.CRITIC]: safeNodeHandler('critic', criticNode),
  [AGENT_GRAPH_NODES.GENERATOR]: safeNodeHandler('generator', generatorNode),
  [AGENT_GRAPH_NODES.CHAT]: safeNodeHandler('chat', chatNode),
  [AGENT_GRAPH_NODES.JSON_REPAIR]: safeNodeHandler(
    'json_repair',
    jsonRepairNode,
  ),
  // Error recovery paths — NOT wrapped to avoid masking their own errors:
  [AGENT_GRAPH_NODES.TERMINAL_RESPONSE]: terminalResponseNode,
  [AGENT_GRAPH_NODES.ROUTER]: decisionRouterNode,
};

const ROUTABLE_PHASE_NODE_MAP: Record<RoutableAgentPhase, AgentGraphNodeName> =
  {
    [AGENT_PHASES.SUPERVISOR]: AGENT_GRAPH_NODES.SUPERVISOR,
    [AGENT_PHASES.RESEARCH]: AGENT_GRAPH_NODES.RESEARCHER,
    [AGENT_PHASES.PLAN]: AGENT_GRAPH_NODES.PLANNER,
    [AGENT_PHASES.VALIDATE_PLAN]: AGENT_GRAPH_NODES.PLAN_VALIDATOR,
    [AGENT_PHASES.AWAIT_PLAN_REVIEW]: AGENT_GRAPH_NODES.AWAIT_PLAN_REVIEW,
    [AGENT_PHASES.EXECUTE]: AGENT_GRAPH_NODES.EXECUTE,
    [AGENT_PHASES.NORMALIZE_TOOL_RESULT]: AGENT_GRAPH_NODES.TOOL_RESULT_NORMALIZER,
    [AGENT_PHASES.JUDGE]: AGENT_GRAPH_NODES.CRITIC,
    [AGENT_PHASES.GENERATE]: AGENT_GRAPH_NODES.GENERATOR,
    [AGENT_PHASES.CHAT]: AGENT_GRAPH_NODES.CHAT,
    [AGENT_PHASES.FATAL_RECOVERY]: AGENT_GRAPH_NODES.TERMINAL_RESPONSE,
    [AGENT_PHASES.CLARIFICATION]: AGENT_GRAPH_NODES.TERMINAL_RESPONSE,
    execute_parallel: 'supervisor'
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
