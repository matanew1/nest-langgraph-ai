import { Annotation } from '@langchain/langgraph';

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
  /** Name of the tool selected by the supervisor */
  selectedTool: Annotation<string | undefined>,
  /** Human-readable string of the params (for logging/display only) */
  toolInput: Annotation<string | undefined>,
  /** Structured params object passed directly to tool.invoke() */
  toolParams: Annotation<Record<string, unknown> | undefined>,
  /** Raw string output returned by the tool */
  toolResult: Annotation<string | undefined>,
  /** One-line planner reasoning summary */
  executionPlan: Annotation<string | undefined>,
  /** Final synthesised answer written by the critic */
  finalAnswer: Annotation<string | undefined>,
  /** True once the critic is satisfied — terminates the loop */
  done: Annotation<boolean | undefined>,
  /** How many supervisor→planner→execute→critic cycles have run */
  iteration: Annotation<number | undefined>,
  /** True when the last tool call threw an error */
  lastToolErrored: Annotation<boolean | undefined>,
  /** Full history of every tool call; reducer appends each new entry */
  attempts: Annotation<Attempt[]>({
    reducer: (prev, curr) => [...prev, ...curr],
    default: () => [],
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
