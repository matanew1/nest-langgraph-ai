export const AGENT_PHASES = {
  SUPERVISOR: 'supervisor',
  RESEARCH: 'research',
  PLAN: 'plan',
  VALIDATE_PLAN: 'validate_plan',
  EXECUTE: 'execute',
  NORMALIZE_TOOL_RESULT: 'normalize_tool_result',
  JUDGE: 'judge',
  ROUTE: 'route',
  COMPLETE: 'complete',
  FATAL: 'fatal',
  FATAL_RECOVERY: 'fatal_recovery',
  CLARIFICATION: 'clarification',
} as const;

export type AgentPhase =
  (typeof AGENT_PHASES)[keyof typeof AGENT_PHASES];

export const ROUTABLE_AGENT_PHASES = [
  AGENT_PHASES.SUPERVISOR,
  AGENT_PHASES.RESEARCH,
  AGENT_PHASES.PLAN,
  AGENT_PHASES.VALIDATE_PLAN,
  AGENT_PHASES.EXECUTE,
  AGENT_PHASES.NORMALIZE_TOOL_RESULT,
  AGENT_PHASES.JUDGE,
  AGENT_PHASES.FATAL_RECOVERY,
  AGENT_PHASES.CLARIFICATION,
] as const;

export type RoutableAgentPhase = (typeof ROUTABLE_AGENT_PHASES)[number];
