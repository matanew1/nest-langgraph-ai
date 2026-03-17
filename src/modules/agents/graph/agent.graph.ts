import { START, END, StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation } from '../state/agent.state';
import { supervisorNode } from '../nodes/supervisor.node';
import { researcherNode } from '../nodes/researcher.node';
import { plannerNode } from '../nodes/planner.node';
import { executionNode } from '../nodes/execution.node';
import { criticNode } from '../nodes/critic.node';
import { jsonRepairNode } from '../nodes/json-repair.node';
import { planValidatorNode } from '../nodes/plan-validator.node';
import { toolResultNormalizerNode } from '../nodes/tool-result-normalizer.node';
import { decisionRouterNode } from '../nodes/decision-router.node';

enum Nodes {
  SUPERVISOR = 'supervisor',
  RESEARCHER = 'researcher',
  PLANNER = 'planner',
  PLAN_VALIDATOR = 'plan_validator',
  EXECUTE = 'execute',
  TOOL_RESULT_NORMALIZER = 'tool_result_normalizer',
  CRITIC = 'critic',
  JSON_REPAIR = 'json_repair',
  ROUTER = 'router',
}

/**
 * Phase-driven graph:
 * START -> SUPERVISOR -> ROUTER -> ... -> END
 *
 * All routing happens via ROUTER based on state.phase + flags.
 */
const graph = new StateGraph(AgentStateAnnotation)
  // nodes
  .addNode(Nodes.SUPERVISOR, supervisorNode)
  .addNode(Nodes.RESEARCHER, researcherNode)
  .addNode(Nodes.PLANNER, plannerNode)
  .addNode(Nodes.PLAN_VALIDATOR, planValidatorNode)
  .addNode(Nodes.EXECUTE, executionNode)
  .addNode(Nodes.TOOL_RESULT_NORMALIZER, toolResultNormalizerNode)
  .addNode(Nodes.CRITIC, criticNode)
  .addNode(Nodes.JSON_REPAIR, jsonRepairNode)
  .addNode(Nodes.ROUTER, decisionRouterNode)
  // edges
  .addEdge(START, Nodes.SUPERVISOR)
  .addEdge(Nodes.SUPERVISOR, Nodes.ROUTER)
  .addEdge(Nodes.RESEARCHER, Nodes.ROUTER)
  .addEdge(Nodes.PLANNER, Nodes.ROUTER)
  .addEdge(Nodes.PLAN_VALIDATOR, Nodes.ROUTER)
  .addEdge(Nodes.EXECUTE, Nodes.ROUTER)
  .addEdge(Nodes.TOOL_RESULT_NORMALIZER, Nodes.ROUTER)
  .addEdge(Nodes.CRITIC, Nodes.ROUTER)
  .addEdge(Nodes.JSON_REPAIR, Nodes.ROUTER)
  .addConditionalEdges(Nodes.ROUTER, (state) => {
    if (state.phase === 'complete' || state.phase === 'fatal') return END;
    if (state.jsonRepair) return Nodes.JSON_REPAIR;
    switch (state.phase) {
      case 'supervisor':
        return Nodes.SUPERVISOR;
      case 'research':
        return Nodes.RESEARCHER;
      case 'plan':
        return Nodes.PLANNER;
      case 'validate_plan':
        return Nodes.PLAN_VALIDATOR;
      case 'execute':
        return Nodes.EXECUTE;
      case 'normalize_tool_result':
        return Nodes.TOOL_RESULT_NORMALIZER;
      case 'judge':
        return Nodes.CRITIC;
      case 'route':
      default:
        // If router didn't change phase, go back to supervisor as a safe fallback.
        return Nodes.SUPERVISOR;
    }
  });

export const agentWorkflow = graph;
