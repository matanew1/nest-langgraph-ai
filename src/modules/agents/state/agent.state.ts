import { Annotation } from '@langchain/langgraph';
import type { ToolResult } from '../tools/tool-result';

export interface PlanStep {
  step_id: number;
  description: string;
  tool: string;
  input: Record<string, unknown>;
}

export type AgentPhase =
  | 'supervisor'
  | 'research'
  | 'plan'
  | 'validate_plan'
  | 'execute'
  | 'normalize_tool_result'
  | 'judge'
  | 'route'
  | 'complete'
  | 'fatal';

export interface AgentCounters {
  turn: number;
  toolCalls: number;
  replans: number;
  stepRetries: number;
}

export interface AgentError {
  code: 'invariant_violation' | 'json_invalid' | 'tool_error' | 'timeout' | 'unknown';
  message: string;
  atPhase: AgentPhase;
  details?: Record<string, unknown>;
}

export interface Attempt {
  tool: string;
  step: number;
  params: Record<string, unknown>;
  result: ToolResult;
}

export interface JsonRepairRequest {
  /** Which phase produced the invalid JSON */
  fromPhase: AgentPhase;
  /** Raw LLM output to repair */
  raw: string;
  /** A compact schema string the repair node should enforce */
  schema: string;
}

export interface CriticDecisionState {
  decision: 'advance' | 'retry_step' | 'replan' | 'complete' | 'fatal';
  reason: string;
  finalAnswer?: string;
  suggestedPlanFix?: string;
}

export const AgentStateAnnotation = Annotation.Root({
  /** Original user request */
  input: Annotation<string>,
  /** Current phase (single driver of routing) */
  phase: Annotation<AgentPhase>({
    reducer: (_, curr) => curr,
    default: () => 'supervisor',
  }),
  /** Normalized objective derived by supervisor */
  objective: Annotation<string | undefined>,
  /** Multi-step execution plan created by the planner */
  plan: Annotation<PlanStep[]>({
    reducer: (_, curr) => curr,
    default: () => [],
  }),
  /** Index of the current step being executed (0-based) */
  currentStep: Annotation<number>({
    reducer: (_, curr) => curr,
    default: () => 0,
  }),
  /** What success looks like for this plan (set by planner) */
  expectedResult: Annotation<string | undefined>,
  /** Name of the tool selected for the current step */
  selectedTool: Annotation<string | undefined>,
  /** Structured params object passed directly to tool.invoke() */
  toolParams: Annotation<Record<string, unknown> | undefined>,
  /** Raw string output returned by the tool (executor output) */
  toolResultRaw: Annotation<string | undefined>,
  /** Normalized tool result envelope (stable contract for critic) */
  toolResult: Annotation<ToolResult | undefined>,
  /** Final synthesised answer written by the critic */
  finalAnswer: Annotation<string | undefined>,
  /** Project context gathered by the researcher node (file tree, git status) */
  projectContext: Annotation<string | undefined>,
  /** Bounded counters to prevent deadlocks and infinite loops */
  counters: Annotation<AgentCounters>({
    reducer: (_, curr) => curr,
    default: () => ({ turn: 0, toolCalls: 0, replans: 0, stepRetries: 0 }),
  }),
  /** Structured error history (bounded) */
  errors: Annotation<AgentError[]>({
    reducer: (prev, curr) => [...prev, ...curr].slice(-20),
    default: () => [],
  }),
  /** When set, the workflow routes to json repair */
  jsonRepair: Annotation<JsonRepairRequest | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /** Repaired JSON string output (for the originating node to parse) */
  jsonRepairResult: Annotation<string | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /** Critic decision output passed to router */
  criticDecision: Annotation<CriticDecisionState | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /** Full history of every tool call; reducer appends each new entry (capped at 10 to prevent bloat) */
  attempts: Annotation<Attempt[]>({
    reducer: (prev, curr) => [...prev, ...curr].slice(-10),
    default: () => [],
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
