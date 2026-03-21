import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { Logger } from '@nestjs/common';
import { AGENT_PHASES } from '../state/agent-phase';
import { completeAgentRun } from '../state/agent-transition.util';
import { AgentState } from '../state/agent.state';

const logger = new Logger('TerminalResponse');

/**
 * Build a concise, plain-language summary of what went wrong.
 * Strips internal details (JSON blobs, stack traces, phase names)
 * so the end-user gets a helpful response, not a debug dump.
 */
function humanizeError(raw: string): string {
  // Strip JSON blobs that sometimes leak into error messages
  const noJson = raw.replace(/\[?\{[\s\S]{20,}\}\]?/g, '').trim();
  // Truncate overly long messages
  const truncated = noJson.length > 300 ? `${noJson.slice(0, 300)}...` : noJson;
  return truncated || raw.slice(0, 200);
}

function buildClarificationMessage(state: AgentState): string {
  const lastError = state.errors?.[state.errors.length - 1];
  if (
    lastError &&
    lastError.atPhase === AGENT_PHASES.SUPERVISOR &&
    lastError.details &&
    Array.isArray(lastError.details.missing_capabilities)
  ) {
    const caps = lastError.details.missing_capabilities.join(', ');
    return `I don't have the right tools for that — specifically I'm missing: ${caps}. Could you try rephrasing or breaking it into smaller steps?`;
  }

  if (lastError) {
    const hint = humanizeError(lastError.message);
    return `I ran into a problem and need a bit more context: ${hint}\n\nCould you rephrase your request or give me more details?`;
  }

  return 'I need a bit more information to help you with that. Could you rephrase your request or add some details?';
}

function buildFatalMessage(state: AgentState): string {
  const lastError = state.errors?.[state.errors.length - 1];
  const objective = state.objective ?? state.input ?? '';

  if (!lastError) {
    return `Sorry, I wasn't able to complete the task${objective ? ` ("${objective.slice(0, 80)}")` : ''}. Something went wrong internally. You can try rephrasing your prompt — that often helps.`;
  }

  const hint = humanizeError(lastError.message);
  const phase = lastError.atPhase;

  // Provide context-specific guidance based on the failing phase
  if (phase === AGENT_PHASES.PLAN || phase === AGENT_PHASES.VALIDATE_PLAN) {
    return `I wasn't able to build a valid plan for your request: ${hint}\n\nTry breaking the task into smaller pieces, or be more specific about what you'd like me to do.`;
  }
  if (phase === AGENT_PHASES.EXECUTE) {
    return `I ran into an error while executing the plan: ${hint}\n\nThe task might need different tools or a simpler approach — try rephrasing your request.`;
  }
  if (phase === AGENT_PHASES.JUDGE) {
    return `I completed the steps but couldn't verify the results: ${hint}\n\nTry asking me again with a more specific goal.`;
  }

  // Generic fallback — still friendly
  return `Sorry, I hit a snag while working on your request: ${hint}\n\nYou can try rephrasing your prompt or simplifying the task.`;
}

export async function terminalResponseNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const mode =
    state.phase === AGENT_PHASES.CLARIFICATION
      ? 'CLARIFICATION'
      : 'FATAL_RECOVERY';

  logPhaseStart(mode, 'Preparing terminal response');

  const finalAnswer =
    state.phase === AGENT_PHASES.CLARIFICATION
      ? buildClarificationMessage(state)
      : buildFatalMessage(state);

  // Log the raw error for debugging (the user sees the friendly version)
  const lastError = state.errors?.[state.errors.length - 1];
  if (lastError) {
    logger.warn(
      `Terminal response for phase=${lastError.atPhase}: ${lastError.message}`,
    );
  }

  logPhaseEnd(mode, 'Prepared terminal response', elapsed());
  return completeAgentRun(finalAnswer, { errors: [] });
}
