import { Annotation } from '@langchain/langgraph';

export interface PlanStep {
  step_id: number;
  description: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface Attempt {
  tool: string;
  /** JSON-stringified params for display/logging in prompts */
  input: string;
  /** Structured params that were passed to tool.invoke() */
  params?: Record<string, unknown>;
  result: string;
  error: boolean;
}

export const AgentStateAnnotation = Annotation.Root({
  /** Original user request */
  input: Annotation<string>,
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
  /** Workflow status: idle | plan_required | running | complete | retry | error */
  status: Annotation<string>({
    reducer: (_, curr) => curr,
    default: () => 'idle',
  }),
  /** What success looks like for this plan (set by planner) */
  expectedResult: Annotation<string | undefined>,
  /** Name of the tool selected for the current step */
  selectedTool: Annotation<string | undefined>,
  /** Human-readable string of the params (for logging/display only) */
  toolInput: Annotation<string | undefined>,
  /** Structured params object passed directly to tool.invoke() */
  toolParams: Annotation<Record<string, unknown> | undefined>,
  /** Raw string output returned by the tool */
  toolResult: Annotation<string | undefined>,
  /** Cleaned objective from supervisor / planner reasoning */
  executionPlan: Annotation<string | undefined>,
  /** Final synthesised answer written by the critic */
  finalAnswer: Annotation<string | undefined>,
  /** True once the task is complete or unresolvable — terminates the loop */
  done: Annotation<boolean | undefined>,
  /** How many supervisor→planner cycles have run */
  iteration: Annotation<number | undefined>,
  /** True when the last tool call threw an error */
  lastToolErrored: Annotation<boolean | undefined>,
  /** Project context gathered by the researcher node (file tree, git status) */
  projectContext: Annotation<string | undefined>,
  /** Full history of every tool call; reducer appends each new entry (capped at 10 to prevent bloat) */
  attempts: Annotation<Attempt[]>({
    reducer: (prev, curr) => [...prev, ...curr].slice(-10),
    default: () => [],
  }),

  /** Circuit breaker: consecutive retries on same step */
  consecutiveRetries: Annotation<number>({
    reducer: (_, curr) => curr,
    default: () => 0,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
