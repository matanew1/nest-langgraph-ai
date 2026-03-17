import type { AgentState, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { AGENT_PLAN_LIMITS } from '../graph/agent.config';
import { Logger } from '@nestjs/common';
import { basename, dirname } from 'node:path';

const logger = new Logger('PlanValidator');

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
    return {
      phase: 'fatal',
      finalAnswer: 'Planner produced an empty plan.',
      errors: [
        {
          code: 'invariant_violation',
          message: 'Empty plan',
          atPhase: 'validate_plan',
        },
      ],
    };
  }

  if (steps.length > AGENT_PLAN_LIMITS.maxSteps) {
    logPhaseEnd('PLAN_VALIDATOR', 'FAILED: too many steps', elapsed());
    return {
      phase: 'fatal',
      finalAnswer: `Plan is too long (${steps.length} steps).`,
      errors: [
        {
          code: 'invariant_violation',
          message: `Plan too long`,
          atPhase: 'validate_plan',
        },
      ],
    };
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
        return {
          phase: 'fatal',
          finalAnswer: `Invalid file_patch params in step ${step.step_id}.`,
          errors: [
            {
              code: 'invariant_violation',
              message: 'Missing params',
              atPhase: 'validate_plan',
            },
          ],
        };
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
        return {
          phase: 'fatal',
          finalAnswer: `file_patch plan invalid: ${errMsg}`,
          errors: [
            {
              code: 'invariant_violation',
              message: errMsg,
              atPhase: 'validate_plan',
            },
          ],
        };
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
      return {
        phase: 'fatal',
        finalAnswer: 'Non-sequential step IDs.',
        errors: [],
      };
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
      return {
        phase: 'fatal',
        finalAnswer: `Unknown tool: ${step.tool}`,
        errors: [],
      };
    }

    const schema: any = (tool as any).schema;
    if (schema?.safeParse) {
      const parsed = schema.safeParse(step.input);
      if (!parsed.success) {
        logPhaseEnd(
          'PLAN_VALIDATOR',
          `FAILED: invalid params for "${step.tool}"`,
          elapsed(),
        );
        return {
          phase: 'fatal',
          finalAnswer: `Invalid params for ${step.tool}`,
          errors: [],
        };
      }
    }
  }

  const first = steps[0];
  logPhaseEnd('PLAN_VALIDATOR', 'OK', elapsed());
  return {
    phase: 'execute',
    currentStep: 0,
    selectedTool: first.tool,
    toolParams: first.input,
  };
}
