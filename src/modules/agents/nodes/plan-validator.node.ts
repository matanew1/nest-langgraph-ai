import type { AgentState, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { AGENT_PLAN_LIMITS } from '../graph/agent.config';
import { Logger } from '@nestjs/common';

const logger = new Logger('PlanValidator');

/**
 * Validates the planner output before any tool execution happens.
 *
 * Failing fast here avoids confusing tool errors and reduces the chance of
 * wasting turns on a malformed plan.
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
      finalAnswer: `Plan is too long (${steps.length} steps). Maximum is ${AGENT_PLAN_LIMITS.maxSteps}.`,
      errors: [
        {
          code: 'invariant_violation',
          message: `Plan too long: ${steps.length}`,
          atPhase: 'validate_plan',
        },
      ],
    };
  }

  // NEW: Verify file_patch steps before execution
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
          finalAnswer: `Invalid file_patch params in step ${step.step_id}: missing path or find.`,
          errors: [
            {
              code: 'invariant_violation',
              message: 'Missing file_patch params',
              atPhase: 'validate_plan',
              details: { step_id: step.step_id },
            },
          ],
        };
      }

      logger.log(
        `Verifying file_patch step ${step.step_id}: ${input.path} find="${input.find?.slice(0, 50)}..."`,
      );

      try {
        // 1. stat_path: check file exists
        const statTool = toolRegistry.get('stat_path');
        if (!statTool) throw new Error('stat_path tool missing');
        const statResult = (await statTool.invoke({
          path: input.path,
        })) as string;
        const stat = JSON.parse(statResult);
        if (!stat.exists || stat.type !== 'file') {
          throw new Error(`File not found or not a file: ${input.path}`);
        }

        // 2. grep_search: check exactly 1 match (escape regex chars)
        const escapedFind = input.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const grepTool = toolRegistry.get('grep_search');
        if (!grepTool) throw new Error('grep_search tool missing');
        const grepResult = (await grepTool.invoke({
          pattern: escapedFind,
          path: input.path,
          glob: '*',
        })) as string;

        const matchCountMatch = grepResult.match(/Found (\d+) match/);
        const matchCount = matchCountMatch
          ? parseInt(matchCountMatch[1], 10)
          : 0;
        if (matchCount !== 1) {
          throw new Error(
            `Find pattern matches ${matchCount} times in ${input.path} (requires exactly 1)`,
          );
        }

        logger.log(`✅ Verified file_patch step ${step.step_id}`);
      } catch (verifyError) {
        const errMsg =
          verifyError instanceof Error
            ? verifyError.message
            : String(verifyError);
        logPhaseEnd(
          'PLAN_VALIDATOR',
          `FAILED: file_patch verification (step ${step.step_id}): ${errMsg}`,
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
              details: {
                step_id: step.step_id,
                path: input.path,
                find_preview: input.find.slice(0, 50) + '...',
              },
            },
          ],
        };
      }
    }
  }

  // Step ids must be sequential starting at 1.
  for (let i = 0; i < steps.length; i++) {
    const expected = i + 1;
    if (steps[i]?.step_id !== expected) {
      logPhaseEnd(
        'PLAN_VALIDATOR',
        'FAILED: non-sequential step_id',
        elapsed(),
      );
      return {
        phase: 'fatal',
        finalAnswer: 'Plan step IDs must be sequential starting at 1 (1..N).',
        errors: [
          {
            code: 'invariant_violation',
            message: `Bad step_id at index ${i}: got ${steps[i]?.step_id}, expected ${expected}`,
            atPhase: 'validate_plan',
          },
        ],
      };
    }
  }

  // Validate tool exists (and if schema exists, validate params).
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
        finalAnswer: `Unknown tool in plan: "${step.tool}".`,
        errors: [
          {
            code: 'invariant_violation',
            message: `Unknown tool: ${step.tool}`,
            atPhase: 'validate_plan',
          },
        ],
      };
    }

    // StructuredToolInterface has a `schema` in most cases; validate if present.
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
          finalAnswer: `Invalid params for tool "${step.tool}" in step ${step.step_id}.`,
          errors: [
            {
              code: 'invariant_violation',
              message: `Invalid tool params for ${step.tool}`,
              atPhase: 'validate_plan',
              details: {
                step_id: step.step_id,
                issues: parsed.error.issues,
              },
            },
          ],
        };
      }
    }

    // Heuristic safety: prevent ungrounded Mermaid generation plans.
    // If planner tries to pass __PREVIOUS_RESULT__ as `description` for generate_mermaid
    // without using the dedicated `source` field, it tends to produce incorrect graphs
    // (looks plausible but not grounded).
    if (step.tool === 'generate_mermaid') {
      const input = step.input ?? {};
      const description =
        typeof input.description === 'string' ? input.description : '';
      const source =
        typeof input.source === 'string' ? input.source : undefined;

      if (description.includes('__PREVIOUS_RESULT__') && !source) {
        logPhaseEnd(
          'PLAN_VALIDATOR',
          `FAILED: generate_mermaid missing source (step ${step.step_id})`,
          elapsed(),
        );
        return {
          phase: 'fatal',
          finalAnswer:
            'Invalid plan: generate_mermaid must use `source="__PREVIOUS_RESULT__"` when basing a diagram on prior tool output.',
          errors: [
            {
              code: 'invariant_violation',
              message:
                'generate_mermaid missing source while using __PREVIOUS_RESULT__',
              atPhase: 'validate_plan',
              details: {
                step_id: step.step_id,
                hint: 'Set generate_mermaid.input.source="__PREVIOUS_RESULT__" and keep description concise.',
              },
            },
          ],
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
