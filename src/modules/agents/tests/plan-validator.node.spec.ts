import { planValidatorNode } from '../nodes/plan-validator.node';
import { AgentState, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools/index';

// Use a mutable env object so tests can override requirePlanReview
const mockEnv = {
  agentWorkingDir: '/tmp',
  toolTimeoutMs: 5000,
  requirePlanReview: false,
};

jest.mock('@config/env', () => ({
  get env() {
    return mockEnv;
  },
}));

jest.mock('../tools/index', () => ({
  toolRegistry: {
    get: jest.fn(),
    getNames: jest
      .fn()
      .mockReturnValue([
        'search',
        'read_file',
        'file_patch',
        'stat_path',
        'grep_search',
        'file_write',
        'run_command',
      ]),
  },
}));

jest.mock('../graph/agent.config', () => ({
  AGENT_PLAN_LIMITS: { maxSteps: 20 },
  getAgentLimits: jest.fn().mockReturnValue({
    turns: 3,
    toolCalls: 15,
    replans: 3,
    stepRetries: 3,
    supervisorFallbacks: 3,
  }),
}));

const mockedToolRegistry = jest.mocked(toolRegistry);

const makeSteps = (count: number): PlanStep[] =>
  Array.from({ length: count }, (_, i) => ({
    step_id: i + 1,
    description: `Step ${i + 1}`,
    tool: 'search',
    input: { query: `query ${i + 1}` },
  }));

const validPlan: PlanStep[] = [
  {
    step_id: 1,
    description: 'Search for files',
    tool: 'search',
    input: { query: 'test' },
  },
  {
    step_id: 2,
    description: 'Read a file',
    tool: 'read_file',
    input: { path: 'file.txt' },
  },
];

const baseState: Partial<AgentState> = {
  input: 'do something',
  plan: validPlan,
  currentStep: 0,
  attempts: [],
  errors: [],
  counters: {
    turn: 0,
    toolCalls: 0,
    replans: 0,
    stepRetries: 0,
    supervisorFallbacks: 0,
  },
};

describe('planValidatorNode', () => {
  afterEach(() => jest.clearAllMocks());

  describe('valid plan', () => {
    it('transitions to execute when plan is valid and no destructive tools', async () => {
      mockedToolRegistry.get.mockImplementation((name: string) => {
        if (name === 'search' || name === 'read_file') {
          return { invoke: jest.fn() };
        }
        return undefined;
      });

      const result = await planValidatorNode(baseState as AgentState);

      expect(result.phase).toBe('execute');
      expect(result.selectedTool).toBe('search');
      expect(result.currentStep).toBe(0);
    });

    it('sets selectedTool and toolParams from first step', async () => {
      mockedToolRegistry.get.mockReturnValue({ invoke: jest.fn() });

      const result = await planValidatorNode(baseState as AgentState);

      expect(result.selectedTool).toBe('search');
      expect(result.toolParams).toEqual({ query: 'test' });
    });
  });

  describe('empty plan', () => {
    it('transitions to fatal when plan is empty', async () => {
      const emptyPlanState: Partial<AgentState> = {
        ...baseState,
        plan: [],
      };

      const result = await planValidatorNode(emptyPlanState as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('empty plan');
    });
  });

  describe('plan too long', () => {
    it('transitions to fatal when plan has more than 20 steps', async () => {
      const longPlanState: Partial<AgentState> = {
        ...baseState,
        plan: makeSteps(21),
      };

      const result = await planValidatorNode(longPlanState as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('21 steps');
    });

    it('accepts a plan with exactly 20 steps', async () => {
      mockedToolRegistry.get.mockReturnValue({ invoke: jest.fn() });

      const maxPlanState: Partial<AgentState> = {
        ...baseState,
        plan: makeSteps(20),
      };

      const result = await planValidatorNode(maxPlanState as AgentState);

      expect(result.phase).toBe('execute');
    });
  });

  describe('unknown tool', () => {
    it('transitions to fatal when a step references an unregistered tool', async () => {
      mockedToolRegistry.get.mockImplementation((name: string) => {
        if (name === 'search') return { invoke: jest.fn() };
        return undefined; // read_file not found
      });

      const result = await planValidatorNode(baseState as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('Unknown tool');
      expect(result.finalAnswer).toContain('read_file');
    });
  });

  describe('non-sequential step IDs', () => {
    it('transitions to fatal when step IDs are not sequential', async () => {
      const badSteps: PlanStep[] = [
        {
          step_id: 1,
          description: 'Step 1',
          tool: 'search',
          input: { query: 'q' },
        },
        {
          step_id: 3,
          description: 'Step 3',
          tool: 'read_file',
          input: { path: 'f.txt' },
        },
      ];

      const result = await planValidatorNode({
        ...baseState,
        plan: badSteps,
      } as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('Non-sequential');
    });
  });

  describe('Zod schema validation', () => {
    it('transitions to fatal when tool params fail schema validation', async () => {
      const { z } = jest.requireActual('zod') as typeof import('zod');
      const schema = z.object({ query: z.string().min(1) }).strict();

      mockedToolRegistry.get.mockImplementation((name: string) => {
        if (name === 'search') {
          return { invoke: jest.fn(), schema };
        }
        return { invoke: jest.fn() };
      });

      const badParamsState: Partial<AgentState> = {
        ...baseState,
        plan: [
          {
            step_id: 1,
            description: 'Search with bad params',
            tool: 'search',
            input: { wrongField: 'value' }, // missing required 'query'
          },
        ],
      };

      const result = await planValidatorNode(badParamsState as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('Invalid params');
    });

    it('passes when tool params match schema', async () => {
      const { z } = jest.requireActual('zod') as typeof import('zod');
      const schema = z.object({ query: z.string().min(1) });

      mockedToolRegistry.get.mockReturnValue({ invoke: jest.fn(), schema });

      const goodParamsState: Partial<AgentState> = {
        ...baseState,
        plan: [
          {
            step_id: 1,
            description: 'Search with correct params',
            tool: 'search',
            input: { query: 'test' },
          },
        ],
      };

      const result = await planValidatorNode(goodParamsState as AgentState);

      expect(result.phase).toBe('execute');
    });
  });

  describe('file_patch validation', () => {
    const filePatchPlan: PlanStep[] = [
      {
        step_id: 1,
        description: 'Patch a file',
        tool: 'file_patch',
        input: {
          path: '/tmp/test.ts',
          find: 'old content',
          replace: 'new content',
        },
      },
    ];

    it('passes file_patch validation when file exists and anchor is found', async () => {
      const mockStatInvoke = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ exists: true, type: 'file' }));
      const mockGrepInvoke = jest.fn().mockResolvedValue('Found 1 match');

      mockedToolRegistry.get.mockImplementation((name: string) => {
        if (name === 'stat_path') return { invoke: mockStatInvoke };
        if (name === 'grep_search') return { invoke: mockGrepInvoke };
        if (name === 'file_patch') return { invoke: jest.fn() };
        return undefined;
      });

      const result = await planValidatorNode({
        ...baseState,
        plan: filePatchPlan,
      } as AgentState);

      expect(result.phase).toBe('execute');
    });

    it('transitions to fatal when file_patch step is missing path', async () => {
      const badFilePatchPlan: PlanStep[] = [
        {
          step_id: 1,
          description: 'Bad patch step',
          tool: 'file_patch',
          input: { find: 'old content' }, // missing path
        },
      ];

      const result = await planValidatorNode({
        ...baseState,
        plan: badFilePatchPlan,
      } as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('Invalid file_patch params');
    });

    it('transitions to fatal when file_patch step is missing find', async () => {
      const badFilePatchPlan: PlanStep[] = [
        {
          step_id: 1,
          description: 'Bad patch step',
          tool: 'file_patch',
          input: { path: '/tmp/test.ts' }, // missing find
        },
      ];

      const result = await planValidatorNode({
        ...baseState,
        plan: badFilePatchPlan,
      } as AgentState);

      expect(result.phase).toBe('fatal');
    });

    it('transitions to fatal when stat_path tool is missing', async () => {
      mockedToolRegistry.get.mockImplementation((name: string) => {
        if (name === 'file_patch') return { invoke: jest.fn() };
        return undefined; // stat_path not found
      });

      const result = await planValidatorNode({
        ...baseState,
        plan: filePatchPlan,
      } as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('file_patch plan invalid');
    });

    it('transitions to fatal when file does not exist', async () => {
      const mockStatInvoke = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ exists: false, type: null }));

      mockedToolRegistry.get.mockImplementation((name: string) => {
        if (name === 'stat_path') return { invoke: mockStatInvoke };
        if (name === 'file_patch') return { invoke: jest.fn() };
        return undefined;
      });

      const result = await planValidatorNode({
        ...baseState,
        plan: filePatchPlan,
      } as AgentState);

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('file_patch plan invalid');
    });

    it('transitions to fatal when anchor text is not found in file', async () => {
      const mockStatInvoke = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ exists: true, type: 'file' }));
      const mockGrepInvoke = jest.fn().mockResolvedValue('Found 0 matches');

      mockedToolRegistry.get.mockImplementation((name: string) => {
        if (name === 'stat_path') return { invoke: mockStatInvoke };
        if (name === 'grep_search') return { invoke: mockGrepInvoke };
        if (name === 'file_patch') return { invoke: jest.fn() };
        return undefined;
      });

      const result = await planValidatorNode({
        ...baseState,
        plan: filePatchPlan,
      } as AgentState);

      expect(result.phase).toBe('fatal');
    });
  });

  describe('plan review', () => {
    afterEach(() => {
      // Reset requirePlanReview to false after each test in this block
      mockEnv.requirePlanReview = false;
    });

    it('transitions to await_plan_review when requirePlanReview is true and destructive tool exists', async () => {
      mockEnv.requirePlanReview = true;
      mockedToolRegistry.get.mockReturnValue({ invoke: jest.fn() });

      const destructivePlan: PlanStep[] = [
        {
          step_id: 1,
          description: 'Write a file',
          tool: 'file_write',
          input: { path: '/tmp/out.txt', content: 'hello' },
        },
      ];

      const stateWithSession: Partial<AgentState> = {
        ...baseState,
        plan: destructivePlan,
        sessionId: 'session-123',
        objective: 'Write output',
      };

      const result = await planValidatorNode(stateWithSession as AgentState);

      expect(result.phase).toBe('await_plan_review');
    });

    it('does not pause for review for read-only tools', async () => {
      mockEnv.requirePlanReview = false;
      mockedToolRegistry.get.mockReturnValue({ invoke: jest.fn() });

      const result = await planValidatorNode({
        ...baseState,
        plan: validPlan, // search and read_file are read-only
        sessionId: 'session-123',
      } as AgentState);

      // read-only tools bypass review even when sessionId is set
      expect(result.phase).toBe('execute');
    });

    it('does not pause for review even with destructive tool when requirePlanReview is false', async () => {
      mockEnv.requirePlanReview = false;
      mockedToolRegistry.get.mockReturnValue({ invoke: jest.fn() });

      const destructivePlan: PlanStep[] = [
        {
          step_id: 1,
          description: 'Write a file',
          tool: 'file_write',
          input: { path: '/tmp/out.txt', content: 'hello' },
        },
      ];

      const result = await planValidatorNode({
        ...baseState,
        plan: destructivePlan,
        sessionId: 'session-123',
      } as AgentState);

      expect(result.phase).toBe('execute');
    });
  });
});
