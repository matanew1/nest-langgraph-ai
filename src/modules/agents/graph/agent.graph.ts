import { END, START, StateGraph } from '@langchain/langgraph';
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

// Researcher fan-out: coordinator triggers both branches in parallel.
graph.addEdge(
  AGENT_GRAPH_NODES.RESEARCHER_COORDINATOR,
  AGENT_GRAPH_NODES.RESEARCH_FS,
);
graph.addEdge(
  AGENT_GRAPH_NODES.RESEARCHER_COORDINATOR,
  AGENT_GRAPH_NODES.RESEARCH_VECTOR,
);

// Fan-in join edges: both research branches feed into research_join.
// LangGraph waits for ALL incoming edges before executing research_join.
graph.addEdge(AGENT_GRAPH_NODES.RESEARCH_FS, AGENT_GRAPH_NODES.RESEARCH_JOIN);
graph.addEdge(
  AGENT_GRAPH_NODES.RESEARCH_VECTOR,
  AGENT_GRAPH_NODES.RESEARCH_JOIN,
);

graph.addConditionalEdges(AGENT_GRAPH_NODES.ROUTER, resolveRouterTarget);

// Generator fan-out: after synthesis, route to ROUTER (→ END) and
// persist memory as a non-blocking side-effect in parallel.
graph.addEdge(AGENT_GRAPH_NODES.GENERATOR, AGENT_GRAPH_NODES.ROUTER);
graph.addEdge(AGENT_GRAPH_NODES.GENERATOR, AGENT_GRAPH_NODES.MEMORY_PERSIST);

// memory_persist is a terminal side-effect node — it always goes to END.
graph.addEdge(AGENT_GRAPH_NODES.MEMORY_PERSIST, END);

export const agentWorkflow = graph;
