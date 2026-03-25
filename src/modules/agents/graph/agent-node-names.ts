// Leaf-level constants — no imports from nodes or topology
export const AGENT_GRAPH_NODES = {
  SUPERVISOR: 'supervisor',
  RESEARCHER_COORDINATOR: 'researcher_coordinator',
  RESEARCH_FS: 'research_fs',
  RESEARCH_VECTOR: 'research_vector',
  RESEARCH_JOIN: 'research_join',
  PLANNER: 'planner',
  PLAN_VALIDATOR: 'plan_validator',
  AWAIT_PLAN_REVIEW: 'await_plan_review',
  EXECUTE: 'execute',
  EXECUTE_PARALLEL: 'execute_parallel',
  TOOL_RESULT_NORMALIZER: 'tool_result_normalizer',
  CRITIC: 'critic',
  GENERATOR: 'generator',
  MEMORY_PERSIST: 'memory_persist',
  CHAT: 'chat',
  TERMINAL_RESPONSE: 'terminal_response',
  ROUTER: 'router',
} as const;

export type AgentGraphNodeName =
  (typeof AGENT_GRAPH_NODES)[keyof typeof AGENT_GRAPH_NODES];
