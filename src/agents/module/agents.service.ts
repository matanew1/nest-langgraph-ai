import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { agentGraph } from '@graph/agent.graph';
import type { AgentState } from '@state/agent.state';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  async run(prompt: string): Promise<string> {
    this.logger.log(
      `Running agent for: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`,
    );

    try {
      // LangGraph compile() returns a Runnable whose generic params don't
      // perfectly match our AgentState shape, so we use a minimal cast here.
      const result = (await agentGraph.invoke({
        input: prompt,
        iteration: 0,
      } as Partial<AgentState>)) as AgentState;

      if (!result.finalAnswer) {
        this.logger.warn('Agent completed without producing a final answer');
        throw new InternalServerErrorException(
          'The agent could not produce an answer. Try rephrasing your prompt.',
        );
      }

      return result.finalAnswer;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent graph execution failed: ${message}`);
      throw new InternalServerErrorException(
        `Agent execution failed: ${message}`,
      );
    }
  }
}
