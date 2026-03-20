import { Logger } from '@nestjs/common';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { buildSupervisorPrompt } from '../prompts/agent.prompts';
import { AGENT_PHASES } from '../state/agent-phase';
import {
  requestClarification,
  requestJsonRepair,
  transitionToPhase,
} from '../state/agent-transition.util';
import { AgentState } from '../state/agent.state';
import { supervisorOutputSchema } from '../state/agent.schemas';
import {
  getStructuredNodeRawResponse,
  parseStructuredNodeOutput,
} from './structured-output.util';

const logger = new Logger('Supervisor');

/**
 * Returns true when the input is clearly a short conversational message or
 * follow-up that should never be rejected — even if the LLM disagrees.
 */
function isObviouslyConversational(input: string): boolean {
  const words = input.trim().split(/\s+/);
  if (
    words.length <= 8 &&
    /\b(what|who|why|how|when|where|tell|show|explain|the|it|this|that|they|them|those|his|her|its)\b/i.test(
      input,
    )
  ) {
    return true;
  }
  // Greetings / single-word utterances
  if (words.length <= 3) return true;
  return false;
}

export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();

  logPhaseStart('SUPERVISOR', `input="${preview(state.input)}"`);

  // Fast-path: obvious follow-up or conversational message — skip LLM routing
  if (isObviouslyConversational(state.input) && state.sessionMemory) {
    logPhaseEnd(
      'SUPERVISOR',
      `FAST-PATH CHAT → "${preview(state.input)}"`,
      elapsed(),
    );
    return transitionToPhase(AGENT_PHASES.CHAT, {
      objective: state.input,
      jsonRepairResult: undefined,
    });
  }

  const raw = await getStructuredNodeRawResponse(state, logger, () =>
    buildSupervisorPrompt(state),
  );

  try {
    const decision = parseStructuredNodeOutput(raw, supervisorOutputSchema);

    if (decision.status === 'reject') {
      // If the LLM rejected something that looks conversational, override to chat
      if (isObviouslyConversational(state.input)) {
        logPhaseEnd('SUPERVISOR', `REJECT OVERRIDE → CHAT MODE`, elapsed());
        return transitionToPhase(AGENT_PHASES.CHAT, {
          objective: state.input,
          jsonRepairResult: undefined,
        });
      }
      logPhaseEnd('SUPERVISOR', `REJECTED: ${decision.message}`, elapsed());
      return requestClarification(
        {
          code: 'unknown',
          message: decision.message ?? 'Supervisor rejected the task.',
          atPhase: AGENT_PHASES.SUPERVISOR,
          details: {
            missing_capabilities: decision.missing_capabilities ?? [],
          },
        },
        { jsonRepairResult: undefined },
      );
    }

    const objective = decision.objective ?? state.input;

    // Default to chat when no mode specified and input looks conversational
    const isChatMode =
      decision.mode === 'chat' ||
      (!decision.mode && state.input.trim().split(/\s+/).length <= 5);

    if (isChatMode) {
      logPhaseEnd(
        'SUPERVISOR',
        `CHAT MODE → "${preview(objective)}"`,
        elapsed(),
      );
      return transitionToPhase(AGENT_PHASES.CHAT, {
        objective,
        jsonRepairResult: undefined,
      });
    }

    logPhaseEnd('SUPERVISOR', `APPROVED → "${preview(objective)}"`, elapsed());
    return transitionToPhase(AGENT_PHASES.RESEARCH, {
      objective,
      jsonRepairResult: undefined,
    });
  } catch (e) {
    logPhaseEnd('SUPERVISOR', 'PARSE FAILED → json_repair', elapsed());
    return requestJsonRepair({
      fromPhase: AGENT_PHASES.SUPERVISOR,
      raw,
      schema:
        '{"status":"ok|reject","mode?":"agent|chat","objective?":"string","message?":"string","missing_capabilities?":["string"]}',
      message: `Supervisor JSON invalid: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
