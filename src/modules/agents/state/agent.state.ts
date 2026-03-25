import { Annotation } from '@langchain/langgraph';
import type { ToolResult } from '../tools/tool-result';
import { DEFAULT_AGENT_COUNTERS } from './agent-state.helpers';
import type { AgentPhase } from './agent-phase';
import { AGENT_CONSTANTS } from '../graph/agent.config';

export interface PlanStep {
  step_id: number;
  description: string;
  tool: string;
  input: Record<string, unknown>;
  parallel_group?: number;
}

export interface AgentCounters {
  turn: number;
  toolCalls: number;
  replans: number;
  stepRetries: number;
  supervisorFallbacks: number;
}

export interface AgentError {
  code:
    | 'invariant_violation'
    | 'json_invalid'
    | 'tool_error'
    | 'timeout'
    | 'unknown';
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

export interface CriticDecisionState {
  decision: 'advance' | 'retry_step' | 'replan' | 'complete' | 'fatal';
  reason: string;
  finalAnswer?: string;
}

export interface ReviewRequest {
  sessionId: string;
  plan: PlanStep[];
  objective?: string;
}

export interface ImageAttachment {
  /** https:// URL or data:image/…;base64,… URL */
  url: string;
}

export interface AgentStateShape {
  input: string;
  phase: AgentPhase;
  sessionId?: string;
  objective?: string;
  reviewRequest?: ReviewRequest;
  plan: PlanStep[];
  currentStep: number;
  expectedResult?: string;
  selectedTool?: string;
  toolParams?: Record<string, unknown>;
  toolResultRaw?: string;
  toolResult?: ToolResult;
  finalAnswer?: string;
  projectContext?: string;
  memoryContext?: string;
  sessionMemory?: string;
  counters: AgentCounters;
  errors: AgentError[];
  criticDecision?: CriticDecisionState;
  attempts: Attempt[];
  /** True when toolResultRaw contains parallel execution results (JSON array) */
  parallelResult?: boolean;
  vectorMemoryIds?: string[];
  /** Images attached to the current user request (vision-capable models only) */
  images?: ImageAttachment[];
}

export const AgentStateAnnotation = Annotation.Root({
  /** Original user request */
  input: Annotation<string>,
  /** Current phase (single driver of routing) */
  phase: Annotation<AgentPhase>({
    reducer: (_, curr) => curr,
    default: () => 'supervisor',
  }),
  /** Session ID threaded into state so nodes can reference it */
  sessionId: Annotation<string | undefined>,
  /** Normalized objective derived by supervisor */
  objective: Annotation<string | undefined>,
  /** Set by plan-validator when REQUIRE_PLAN_REVIEW is enabled; cleared on resume */
  reviewRequest: Annotation<ReviewRequest | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
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
  /** Retrieved memory context for this run (session memory + vector recall) */
  memoryContext: Annotation<string | undefined>,
  /** Short deterministic cross-turn memory loaded from Redis */
  sessionMemory: Annotation<string | undefined>,
  /** Bounded counters to prevent deadlocks and infinite loops */
  counters: Annotation<AgentCounters>({
    reducer: (_, curr) => curr,
    default: () => ({ ...DEFAULT_AGENT_COUNTERS }),
  }),
  /** Structured error history (bounded) */
  errors: Annotation<AgentError[]>({
    reducer: (prev, curr) =>
      [...prev, ...curr].slice(-AGENT_CONSTANTS.errorsHistoryCap),
    default: () => [],
  }),
  /** Critic decision output passed to router */
  criticDecision: Annotation<CriticDecisionState | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /** Full history of every tool call; reducer appends each new entry (capped at 10 to prevent bloat) */
  attempts: Annotation<Attempt[]>({
    reducer: (prev, curr) =>
      [...prev, ...curr].slice(-AGENT_CONSTANTS.attemptsHistoryCap),
    default: () => [],
  }),
  /** Boolean flag to indicate if toolResultRaw contains multiple parallel results */
  parallelResult: Annotation<boolean | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /** Transient: vector memory IDs retrieved during research (for feedback loop) */
  vectorMemoryIds: Annotation<string[] | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /** Images attached to the user request (transient — not persisted across turns) */
  images: Annotation<ImageAttachment[] | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /**
   * Transient token callback for streaming — never checkpointed.
   * Functions cannot be serialised to JSON so this will always deserialise as
   * `undefined`; that is intentional: the callback is only meaningful during a
   * live `streamRun()` call and must be re-supplied on each invocation.
   */
  onToken: Annotation<((token: string) => void) | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
  /** Which phases should stream tokens (set at graph invocation time) */
  streamPhases: Annotation<string[] | undefined>({
    reducer: (_, curr) => curr,
    default: () => undefined,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State & AgentStateShape;
export type AgentStateUpdates = Omit<Partial<AgentStateShape>, 'phase'>;
export type { AgentPhase } from './agent-phase';
