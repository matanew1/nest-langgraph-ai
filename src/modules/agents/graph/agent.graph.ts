import { START, END, StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation } from '../state/agent.state';
import { supervisorNode } from '../nodes/supervisor.node';
import { researcherNode } from '../nodes/researcher.node';
import { plannerNode } from '../nodes/planner.node';
import { executionNode } from '../nodes/execution.node';
import { criticNode } from '../nodes/critic.node';
import { env } from '@config/env';

const MAX_ITERATIONS = env.agentMaxIterations;
const MAX_RETRIES = env.agentMaxRetries;

enum Nodes {
  SUPERVISOR = 'supervisor',
  RESEARCHER = 'researcher',
  PLANNER = 'planner',
  EXECUTE = 'execute',
  CRITIC = 'critic',
}

/**
 * Graph flow:
 *
 *   START → SUPERVISOR → RESEARCHER → PLANNER → EXECUTE → CRITIC
 *                ↑                       ↑                    |
 *                |                       └────────────────────┘  (next step in plan)
 *                └────────────────────────────────────────────┘  (retry / re-plan)
 *                                                             → END (complete / error / max iterations)
 */
const graph = new StateGraph(AgentStateAnnotation)
  .addNode(Nodes.SUPERVISOR, supervisorNode)
  .addNode(Nodes.RESEARCHER, researcherNode)
  .addNode(Nodes.PLANNER, plannerNode)
  .addNode(Nodes.EXECUTE, executionNode)
  .addNode(Nodes.CRITIC, criticNode)
  .addEdge(START, Nodes.SUPERVISOR)
  .addConditionalEdges(Nodes.SUPERVISOR, (state) => {
    if (state.done) return END;
    return Nodes.RESEARCHER;
  })
  .addEdge(Nodes.RESEARCHER, Nodes.PLANNER)
  .addConditionalEdges(Nodes.PLANNER, (state) => {
    if (state.done) return END;
    return Nodes.EXECUTE;
  })
  .addEdge(Nodes.EXECUTE, Nodes.CRITIC)
  .addConditionalEdges(Nodes.CRITIC, (state) => {
    if (state.done) return END;
    if ((state.iteration ?? 0) >= MAX_ITERATIONS) return END;
    if ((state.consecutiveRetries ?? 0) >= MAX_RETRIES) return END;

    if (state.status === 'running') return Nodes.EXECUTE;
    return Nodes.PLANNER; // Changed this from Nodes.SUPERVISOR to Nodes.PLANNER
  });

export const agentGraph = graph.compile();
