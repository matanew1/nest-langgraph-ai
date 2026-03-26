import type { AgentState } from '../state/agent.state';
import { AGENT_PHASES } from '../state/agent-phase';
import {
  beginExecutionStep,
  failAgentRun,
  requestPlanReview,
  transitionToPhase,
} from '../state/agent-transition.util';
import { env } from '@config/env';
import { toolRegistry } from '../tools';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { AGENT_PLAN_LIMITS } from '../graph/agent.config';
import { Logger } from '@nestjs/common';
import { basename, dirname } from 'node:path';

const logger = new Logger('PlanValidator');

function failValidation(
  finalAnswer: string,
  message: string,
): Partial<AgentState> {
  return failAgentRun(finalAnswer, {
    code: 'invariant_violation',
    message,
    atPhase: AGENT_PHASES.VALIDATE_PLAN,
  });
}

/**
 * Validates the planner output before any tool execution happens.
 */
export async function planValidatorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('PLAN_VALIDATOR', `steps=${state.plan?.length ?? 0}`);

  const steps = state.plan ?? [];
  if (steps.length === 0) {
    logPhaseEnd('PLAN_VALIDATOR', 'FAILED: empty plan', elapsed());
    return failValidation('Planner produced an empty plan.', 'Empty plan');
  }

  if (steps.length > AGENT_PLAN_LIMITS.maxSteps) {
    logPhaseEnd('PLAN_VALIDATOR', 'FAILED: too many steps', elapsed());
    return failValidation(
      `Plan is too long (${steps.length} steps).`,
      'Plan too long',
    );
  }

  // Rule A: Reject parallel-group steps that use __PREVIOUS_RESULT__
  for (const step of steps) {
    if (step.parallel_group !== undefined) {
      for (const value of Object.values(step.input)) {
        if (
          typeof value === 'string' &&
          value.includes('__PREVIOUS_RESULT__')
        ) {
          logPhaseEnd(
            'PLAN_VALIDATOR',
            `FAILED: parallel step ${step.step_id} uses __PREVIOUS_RESULT__`,
            elapsed(),
          );
          return failValidation(
            `Parallel group step ${step.step_id} cannot use __PREVIOUS_RESULT__ (steps run concurrently).`,
            `Parallel group step ${step.step_id} uses __PREVIOUS_RESULT__`,
          );
        }
      }
    }
  }

  // Rule B: Validate parallel groups are contiguous
  const groupIndices = new Map<number, number[]>();
  for (let i = 0; i < steps.length; i++) {
    const g = steps[i].parallel_group;
    if (g !== undefined) {
      const list = groupIndices.get(g) ?? [];
      list.push(i);
      groupIndices.set(g, list);
    }
  }
  for (const [groupId, indices] of groupIndices) {
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) {
        logPhaseEnd(
          'PLAN_VALIDATOR',
          `FAILED: non-contiguous parallel group ${groupId}`,
          elapsed(),
        );
        return failValidation(
          `Parallel group ${groupId} has non-contiguous steps — all steps in a group must be adjacent.`,
          `Non-contiguous parallel group ${groupId}`,
        );
      }
    }
  }

  // Verify file_patch steps before execution
  for (const step of steps) {
    if (step.tool === 'file_patch') {
      const input = step.input as {
        path: string;
        find: string;
        replace?: string;
      };

      if (!input.path || !input.find) {
        logPhaseEnd(
          'PLAN_VALIDATOR',
          `FAILED: invalid file_patch params (step ${step.step_id})`,
          elapsed(),
        );
        return failValidation(
          `Invalid file_patch params in step ${step.step_id}.`,
          'Missing params',
        );
      }

      // Skip grep verification when find/replace use __PREVIOUS_RESULT__ —
      // the placeholder is resolved at execution time, so there is nothing to
      // verify against the actual file content at plan-validation time.
      if (
        input.find.includes('__PREVIOUS_RESULT__') ||
        (input.replace && input.replace.includes('__PREVIOUS_RESULT__'))
      ) {
        logger.log(
          `⏭ Skipping anchor verification for step ${step.step_id} (uses __PREVIOUS_RESULT__)`,
        );
        continue;
      }

      logger.log(`Verifying file_patch step ${step.step_id}: ${input.path}`);

      try {
        // 1. Check file existence
        const statTool = toolRegistry.get('stat_path');
        if (!statTool) throw new Error('stat_path tool missing');
        const statResult = (await statTool.invoke({
          path: input.path,
        })) as string;
        const stat = JSON.parse(statResult);
        if (!stat.exists || stat.type !== 'file') {
          throw new Error(`File not found: ${input.path}`);
        }

        // 2. Grep verification - Only verify the first line to avoid multi-line grep issues
        // This solves the "247 matches" bug caused by escaping newlines in a shell command
        const lines = input.find.split('\n').filter((l) => l.trim().length > 0);
        const searchAnchor = lines[0] || '';
        const escapedAnchor = searchAnchor.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );

        const grepTool = toolRegistry.get('grep_search');
        if (!grepTool) throw new Error('grep_search tool missing');

        const grepResult = (await grepTool.invoke({
          pattern: escapedAnchor,
          path: dirname(input.path),
          glob: basename(input.path),
        })) as string;

        const matchCountMatch = grepResult.match(/Found (\d+) match/);
        const matchCount = matchCountMatch
          ? parseInt(matchCountMatch[1], 10)
          : 0;

        if (matchCount === 0) {
          throw new Error(
            `Could not find anchor "${searchAnchor}" in ${input.path}`,
          );
        }

        // Note: We allow > 1 matches here because multiple sections might have same headers,
        // but the actual file_patch tool will handle the specific multi-line replacement.
        logger.log(`✅ Verified anchor for step ${step.step_id}`);
      } catch (verifyError) {
        const errMsg =
          verifyError instanceof Error
            ? verifyError.message
            : String(verifyError);
        logPhaseEnd(
          'PLAN_VALIDATOR',
          `FAILED: step ${step.step_id}: ${errMsg}`,
          elapsed(),
        );
        return failValidation(`file_patch plan invalid: ${errMsg}`, errMsg);
      }
    }
  }

  // Validate step ID sequence
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]?.step_id !== i + 1) {
      logPhaseEnd(
        'PLAN_VALIDATOR',
        'FAILED: non-sequential step_id',
        elapsed(),
      );
      return failValidation(
        'Non-sequential step IDs.',
        'Non-sequential step IDs',
      );
    }
  }

  // Validate tool existence and schema
  for (const step of steps) {
    const tool = toolRegistry.get(step.tool);
    if (!tool) {
      logPhaseEnd(
        'PLAN_VALIDATOR',
        `FAILED: unknown tool "${step.tool}"`,
        elapsed(),
      );
      return failValidation(
        `Unknown tool: ${step.tool}`,
        `Unknown tool: ${step.tool}`,
      );
    }

    const schema: any = (tool as any).schema;
    if (schema?.safeParse) {
      // Skip schema validation when any input value contains a placeholder that
      // will be resolved at execution time — the actual type may differ from the
      // placeholder string (e.g. paths: "__PREVIOUS_RESULT__" vs string[]).
      const PLACEHOLDERS = ['__PREVIOUS_RESULT__', '__INLINE_CONTENT__'];
      const hasPlaceholder = Object.values(step.input).some(
        (v) =>
          typeof v === 'string' && PLACEHOLDERS.some((p) => v.includes(p)),
      );
      if (!hasPlaceholder) {
        const parsed = schema.safeParse(step.input);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map(
              (i: { path: (string | number)[]; message: string }) =>
                `${i.path.join('.')}: ${i.message}`,
            )
            .join('; ');
          const detail = `Invalid params for ${step.tool}: ${issues}`;
          logPhaseEnd('PLAN_VALIDATOR', `FAILED: ${detail}`, elapsed());
          return failValidation(detail, detail);
        }
      }
    }
  }

  const first = steps[0];
  logPhaseEnd('PLAN_VALIDATOR', 'OK', elapsed());

  // Only pause for human review when the plan contains destructive/irreversible tools.
  // Read-only operations (search, stat_path, read_file, etc.) run without review.
  const DESTRUCTIVE_TOOLS = new Set([
    'write_file',
    'file_patch',
    'file_append',
    'run_command',
  ]);
  const hasDestructiveTool = steps.some((s) => DESTRUCTIVE_TOOLS.has(s.tool));

  if (env.requirePlanReview && state.sessionId && hasDestructiveTool) {
    logPhaseEnd('PLAN_VALIDATOR', 'AWAIT_PLAN_REVIEW', elapsed());
    return requestPlanReview(state.sessionId, state);
  }

  if (first.parallel_group !== undefined) {
    return transitionToPhase(AGENT_PHASES.EXECUTE_PARALLEL, { currentStep: 0 });
  }
  return beginExecutionStep(first, 0);
}
