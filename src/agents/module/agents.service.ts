import { Injectable } from '@nestjs/common';
import { agentGraph } from '@graph/agent.graph';
import type { AgentState } from '@state/agent.state';

@Injectable()
export class AgentsService {
  async run(prompt: string): Promise<string | undefined> {
    const result = (await agentGraph.invoke({
      input: prompt,
      iteration: 0,
    } as unknown as Parameters<
      typeof agentGraph.invoke
    >[0])) as unknown as AgentState;

    return result.finalAnswer;
  }
}
