/**
 * Shared helpers for Mermaid diagram tools (generate + edit).
 */

export function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

const MERMAID_DIAGRAM_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'stateDiagram',
  'classDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'xychart',
  'journey',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
] as const;

export function isLikelyMermaid(text: string): boolean {
  // Find the first non-empty line and check if it starts with a known keyword
  const firstNonEmpty = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstNonEmpty) return false;
  return MERMAID_DIAGRAM_KEYWORDS.some((kw) => firstNonEmpty.startsWith(kw));
}

export function sanitizeMermaid(text: string): string {
  return text
    .replace(/(^|\n)\s*graph\s*\[/g, '$1G[')
    .replace(/(^|\n)\s*graph\s*-->/g, '$1G -->')
    .replace(/\bgraph\s*-->/g, 'G -->')
    .replace(/\bgraph\s*\[/g, 'G[');
}

export function looksLikeCodeListingDiagram(text: string): boolean {
  return (
    text.includes('.addNode(') ||
    text.includes('.addEdge(') ||
    text.includes('const graph =') ||
    text.includes('new StateGraph(')
  );
}

export const REFERENCE_STYLE = `flowchart LR
  %% Mirrors src/modules/agents/graph/agent.graph.ts (router-centric, phase-driven)

  START["START"]
  END["END"]

  SUPERVISOR["SUPERVISOR
nodes/supervisor.node.ts"]
  RESEARCHER["RESEARCHER
nodes/researcher.node.ts"]
  PLANNER["PLANNER
nodes/planner.node.ts"]
  PLAN_VALIDATOR["PLAN VALIDATOR
nodes/plan-validator.node.ts"]
  EXECUTE["EXECUTE
nodes/execution.node.ts"]
  TOOL_RESULT_NORMALIZER["TOOL RESULT NORMALIZER
nodes/tool-result-normalizer.node.ts"]
  CRITIC["CRITIC
nodes/critic.node.ts"]

  ROUTER["ROUTER
nodes/decision-router.node.ts
routes by state.phase"]

  %% Fixed edges (every node returns to ROUTER)
  START --> SUPERVISOR
  SUPERVISOR --> ROUTER
  RESEARCHER --> ROUTER
  PLANNER --> ROUTER
  PLAN_VALIDATOR --> ROUTER
  EXECUTE --> ROUTER
  TOOL_RESULT_NORMALIZER --> ROUTER
  CRITIC --> ROUTER

  %% Conditional edges from ROUTER
  ROUTER -->|phase = complete OR fatal| END

  ROUTER -->|phase = supervisor| SUPERVISOR
  ROUTER -->|phase = research| RESEARCHER
  ROUTER -->|phase = plan| PLANNER
  ROUTER -->|phase = validate_plan| PLAN_VALIDATOR
  ROUTER -->|phase = execute| EXECUTE
  ROUTER -->|phase = normalize_tool_result| TOOL RESULT NORMALIZER
  ROUTER -->|phase = judge| CRITIC

  %% Fallback (when phase is route/unknown and no other condition matched)
  ROUTER -->|phase = route / default fallback| SUPERVISOR`;
