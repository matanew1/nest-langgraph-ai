import { START, END, StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation } from '../state/agent.state';
import { supervisorNode } from '../nodes/supervisor.node';
import { plannerNode } from '../nodes/planner.node';
import { executionNode } from '../nodes/execution.node';
import { criticNode } from '../nodes/critic.node';
import { env } from '../../config/env';

const MAX_ITERATIONS = env.agentMaxIterations;

enum Nodes {
  SUPERVISOR = 'supervisor',
  PLANNER = 'planner',
  EXECUTE = 'execute',
  CRITIC = 'critic',
}

const graph = new StateGraph(AgentStateAnnotation)
  .addNode(Nodes.SUPERVISOR, supervisorNode)
  .addNode(Nodes.PLANNER, plannerNode)
  .addNode(Nodes.EXECUTE, executionNode)
  .addNode(Nodes.CRITIC, criticNode)
  .addEdge(START, Nodes.SUPERVISOR)
  .addEdge(Nodes.SUPERVISOR, Nodes.PLANNER)
  .addEdge(Nodes.PLANNER, Nodes.EXECUTE)
  .addEdge(Nodes.EXECUTE, Nodes.CRITIC)
  .addConditionalEdges(Nodes.CRITIC, (state) => {
    if (state.done) return END;
    if ((state.iteration ?? 0) >= MAX_ITERATIONS) return END;
    return Nodes.SUPERVISOR;
  });

export const agentGraph = graph.compile();
