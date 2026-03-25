import { Send } from '@langchain/langgraph';
import { Logger } from '@nestjs/common';
import { AGENT_GRAPH_NODES } from '@graph/agent-node-names';
import type { AgentState } from '@state/agent.state';

const logger = new Logger('ResearcherCoordinator');

export function researcherCoordinatorNode(state: AgentState) {
  logger.log('Fanning out to research_fs and research_vector in parallel');
  return [
    new Send(AGENT_GRAPH_NODES.RESEARCH_FS, state),
    new Send(AGENT_GRAPH_NODES.RESEARCH_VECTOR, state),
  ];
}
