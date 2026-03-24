import { START, StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation } from '../state/agent.state';
import {
  AGENT_GRAPH_NODE_HANDLERS,
  AGENT_GRAPH_NODES,
  ROUTER_RETURN_NODES,
  resolveRouterTarget,
} from './agent-topology';

/**
 * Phase-driven graph:
 * START -> SUPERVISOR -> ROUTER -> ... -> END
 *
 * All routing happens via ROUTER based on state.phase + flags.
 */
const graph = new StateGraph(AgentStateAnnotation) as any;

for (const [node, handler] of Object.entries(AGENT_GRAPH_NODE_HANDLERS)) {
  graph.addNode(node, handler);
}

graph.addEdge(START, AGENT_GRAPH_NODES.SUPERVISOR);

for (const node of ROUTER_RETURN_NODES) {
  graph.addEdge(node, AGENT_GRAPH_NODES.ROUTER);
}

// Fan-in join edges: both research branches feed into research_join.
// LangGraph waits for ALL incoming edges before executing research_join.
graph.addEdge(AGENT_GRAPH_NODES.RESEARCH_FS, AGENT_GRAPH_NODES.RESEARCH_JOIN);
graph.addEdge(
  AGENT_GRAPH_NODES.RESEARCH_VECTOR,
  AGENT_GRAPH_NODES.RESEARCH_JOIN,
);

graph.addConditionalEdges(AGENT_GRAPH_NODES.ROUTER, resolveRouterTarget);

export const agentWorkflow = graph;
