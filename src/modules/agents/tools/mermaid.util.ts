/**
 * Shared helpers for Mermaid diagram tools (generate + edit).
 */

export function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function isLikelyMermaid(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith('flowchart') ||
    t.startsWith('graph') ||
    t.startsWith('sequenceDiagram') ||
    t.startsWith('stateDiagram') ||
    t.startsWith('classDiagram') ||
    t.startsWith('erDiagram') ||
    t.startsWith('gantt') ||
    t.startsWith('journey') ||
    t.startsWith('mindmap') ||
    t.startsWith('timeline') ||
    t.startsWith('C4Context') ||
    t.startsWith('C4Container') ||
    t.startsWith('C4Component') ||
    t.startsWith('C4Dynamic') ||
    t.startsWith('C4Deployment')
  );
}

export function sanitizeMermaid(text: string): string {
  let sanitized = text
    .replace(/(^|\n)\s*graph\s*\[/g, '$1G[')
    .replace(/(^|\n)\s*graph\s*-->/g, '$1G -->')
    .replace(/\bgraph\s*-->/g, 'G -->')
    .replace(/\bgraph\s*\[/g, 'G[');

  // Fix invalid parallel 'A & B & C --> D' syntax to multiple arrows
  sanitized = sanitized.replace(/\s*([A-Z][A-Z0-9_]+(?:\s*&\s*[A-Z][A-Z0-9_]+)*)\s*-->\s*([A-Z][A-Z0-9_]+)/g, (fullMatch, sourcesStr, target) => {
    const sources = sourcesStr.split(/\s*&\s*/).filter(s => s.trim());
    return sources.map(source => `${source.trim()} --> ${target}`).join('\n');
  });

  // Auto-quote unquoted node labels containing parentheses () , @, :, etc.
  const lines = sanitized.split('\n');
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(/([a-zA-Z0-9_]+)\[([^\[\]" ]*(?:[\(\)\@\:\-\,][^\[\]" ]*[^\]]*))\]/g, (match, id, label) => {
      const safeLabel = label.trim().replace(/"/g, '\\"');
      return `${id}["${safeLabel}"]`;
    });
  }
  sanitized = lines.join('\n');

  // Quote link labels with special chars
  sanitized = sanitized.replace(/-->\|([^\|]*[\(\)\@\:\,] [^\|]*)\|/g, (match, label) => {
    const safeLabel = label.trim().replace(/"/g, '\\"');
    return `-->|"${safeLabel}"|`;
  });

  return sanitized;
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

  START((START))
  END((END))

  SUPERVISOR["SUPERVISOR\\nnodes/supervisor.node.ts"]
  RESEARCHER["RESEARCHER\\nnodes/researcher.node.ts"]
  PLANNER["PLANNER\\nnodes/planner.node.ts"]
  PLAN_VALIDATOR["PLAN_VALIDATOR\\nnodes/plan-validator.node.ts"]
  EXECUTE["EXECUTE\\nnodes/execution.node.ts"]
  TOOL_RESULT_NORMALIZER["TOOL_RESULT_NORMALIZER\\nnodes/tool-result-normalizer.node.ts"]
  CRITIC["CRITIC\\nnodes/critic.node.ts"]
  JSON_REPAIR["JSON_REPAIR\\nnodes/json-repair.node.ts"]

  ROUTER{"ROUTER\\nnodes/decision-router.node.ts\\nroutes by state.phase + flags"}

  %% Fixed edges (every node returns to ROUTER)
  START --> SUPERVISOR
  SUPERVISOR --> ROUTER
  RESEARCHER --> ROUTER
  PLANNER --> ROUTER
  PLAN_VALIDATOR --> ROUTER
  EXECUTE --> ROUTER
  TOOL_RESULT_NORMALIZER --> ROUTER
  CRITIC --> ROUTER
  JSON_REPAIR --> ROUTER

  %% Conditional edges from ROUTER
  ROUTER -->|"phase = complete OR fatal"| END
  ROUTER -->|"jsonRepair flag set"| JSON_REPAIR

  ROUTER -->|"phase = supervisor"| SUPERVISOR
  ROUTER -->|"phase = research"| RESEARCHER
  ROUTER -->|"phase = plan"| PLANNER
  ROUTER -->|"phase = validate_plan"| PLAN_VALIDATOR
  ROUTER -->|"phase = execute"| EXECUTE
  ROUTER -->|"phase = normalize_tool_result"| TOOL_RESULT_NORMALIZER
  ROUTER -->|"phase = judge"| CRITIC

  %% Fallback (when phase is route/unknown and no other condition matched)
  ROUTER -->|"phase = route / default fallback"| SUPERVISOR`;

