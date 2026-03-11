import { Annotation } from '@langchain/langgraph';

export interface Attempt {
  tool: string;
  input: string;
  result: string;
  error: boolean;
}

export interface Step {
  tool: string;
  params: Record<string, string>;
  goal: string;
}

export const AgentStateAnnotation = Annotation.Root({
  input: Annotation<string>,
  selectedTool: Annotation<string | undefined>,
  toolInput: Annotation<string | undefined>,
  toolParams: Annotation<string | undefined>,
  toolResult: Annotation<string | undefined>,
  executionPlan: Annotation<string | undefined>,
  steps: Annotation<Step[] | undefined>,
  currentStep: Annotation<number | undefined>,
  finalAnswer: Annotation<string | undefined>,
  done: Annotation<boolean | undefined>,
  iteration: Annotation<number | undefined>,
  lastToolErrored: Annotation<boolean | undefined>,
  attempts: Annotation<Attempt[]>({
    reducer: (prev, curr) => [...prev, ...curr],
    default: () => [],
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
