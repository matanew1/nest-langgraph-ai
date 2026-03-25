import { Logger } from '@nestjs/common';
import type { AgentState } from '@state/agent.state';

const logger = new Logger('ResearcherCoordinator');

export async function researcherCoordinatorNode(
  _state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log('Fanning out to research_fs and research_vector in parallel');
  return {};
}
