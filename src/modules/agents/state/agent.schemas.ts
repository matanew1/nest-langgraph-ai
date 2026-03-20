import { z } from 'zod';

export const supervisorOutputSchema = z
  .object({
    status: z.enum(['ok', 'reject']),
    mode: z.enum(['agent', 'chat']).optional(),
    objective: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    missing_capabilities: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === 'ok' && !val.objective) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'objective is required when status=ok',
        path: ['objective'],
      });
    }
    if (val.status === 'reject' && !val.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'message is required when status=reject',
        path: ['message'],
      });
    }
  });

export const planStepSchema = z
  .object({
    step_id: z.number().int().positive(),
    description: z.string().min(1),
    tool: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    parallel_group: z.number().int().positive().optional(),
  })
  .strict();

export const plannerOutputSchema = z
  .object({
    objective: z.string().min(1),
    steps: z.array(planStepSchema).min(1),
    expected_result: z.string().min(1),
  })
  .strict();

export const criticDecisionSchema = z
  .object({
    decision: z.enum(['advance', 'retry_step', 'replan', 'complete', 'fatal']),
    reason: z.string().min(1),
    finalAnswer: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.decision === 'complete' && !val.finalAnswer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'finalAnswer is required when decision=complete',
        path: ['finalAnswer'],
      });
    }
    if (val.decision === 'fatal' && !val.finalAnswer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'finalAnswer is required when decision=fatal',
        path: ['finalAnswer'],
      });
    }
  });

export type SupervisorOutput = z.infer<typeof supervisorOutputSchema>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type CriticDecision = z.infer<typeof criticDecisionSchema>;
