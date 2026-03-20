import { jsonRepairNode } from '../nodes/json-repair.node';
import { AgentState, JsonRepairRequest } from '../state/agent.state';
import { invokeLlm } from '@llm/llm.provider';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

const mockedInvokeLlm = jest.mocked(invokeLlm);

const makeState = (
  jsonRepair?: JsonRepairRequest,
  extra: Partial<AgentState> = {},
): AgentState =>
  ({
    input: 'test',
    attempts: [],
    errors: [],
    plan: [],
    currentStep: 0,
    counters: {
      turn: 0,
      toolCalls: 0,
      replans: 0,
      stepRetries: 0,
      supervisorFallbacks: 0,
    },
    jsonRepair,
    ...extra,
  }) as AgentState;

describe('jsonRepairNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns empty object when jsonRepair is not set', async () => {
    const result = await jsonRepairNode(makeState(undefined));

    expect(result).toEqual({});
    expect(mockedInvokeLlm).not.toHaveBeenCalled();
  });

  describe('successful repair', () => {
    it('stores repaired JSON string in jsonRepairResult', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw: 'invalid json here {',
        schema: '{"objective":"string","steps":[],"expected_result":"string"}',
      };

      const repairedObj = {
        objective: 'Do something',
        steps: [
          {
            step_id: 1,
            description: 'step',
            tool: 'search',
            input: { query: 'q' },
          },
        ],
        expected_result: 'Done',
      };

      mockedInvokeLlm.mockResolvedValue(JSON.stringify(repairedObj));

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.jsonRepairResult).toBeDefined();
      expect(typeof result.jsonRepairResult).toBe('string');
      const parsed = JSON.parse(result.jsonRepairResult!);
      expect(parsed).toEqual(repairedObj);
    });

    it('clears jsonRepair after successful repair', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw: 'bad json',
        schema: '{"key":"string"}',
      };

      mockedInvokeLlm.mockResolvedValue('{"key":"value"}');

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.jsonRepair).toBeUndefined();
    });

    it('sets jsonRepairFromPhase to the original fromPhase', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw: 'bad json',
        schema: '{"key":"string"}',
      };

      mockedInvokeLlm.mockResolvedValue('{"key":"value"}');

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.jsonRepairFromPhase).toBe('plan');
    });

    it('correctly sets jsonRepairFromPhase for supervisor phase', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'supervisor',
        raw: 'truncated',
        schema: '{"status":"string"}',
      };

      mockedInvokeLlm.mockResolvedValue(
        '{"status":"ok","objective":"do task"}',
      );

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.jsonRepairFromPhase).toBe('supervisor');
    });

    it('handles repaired JSON wrapped in {"repaired": ...} envelope', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw: 'bad json',
        schema: '{"key":"string"}',
      };

      const innerObj = { key: 'value' };
      mockedInvokeLlm.mockResolvedValue(JSON.stringify({ repaired: innerObj }));

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.jsonRepairResult).toBeDefined();
      const parsed = JSON.parse(result.jsonRepairResult!);
      expect(parsed).toEqual(innerObj);
    });

    it('handles truncated/partial JSON that LLM can repair', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'judge',
        raw: '{"decision":"advance","reason":"good',
        schema: '{"decision":"string","reason":"string"}',
      };

      mockedInvokeLlm.mockResolvedValue(
        '{"decision":"advance","reason":"good result"}',
      );

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.jsonRepairResult).toBeDefined();
      expect(result.jsonRepairFromPhase).toBe('judge');
      expect(result.jsonRepair).toBeUndefined();
    });
  });

  describe('failed repair', () => {
    it('routes to fatal when LLM returns completely unrecoverable output', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw: 'completely garbage output with no JSON whatsoever',
        schema: '{"objective":"string","steps":[],"expected_result":"string"}',
      };

      mockedInvokeLlm.mockResolvedValue('I cannot repair this. Sorry.');

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.phase).toBe('fatal');
      expect(result.jsonRepairResult).toBeUndefined();
      expect(result.jsonRepair).toBeUndefined();
    });

    it('includes error details in fatal result', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw: 'no json here',
        schema: '{"key":"string"}',
      };

      mockedInvokeLlm.mockResolvedValue('still no json');

      const result = await jsonRepairNode(makeState(repairReq));

      expect(result.phase).toBe('fatal');
      expect(result.finalAnswer).toContain('Failed to repair invalid JSON');
    });

    it('handles LLM throwing an error during repair', async () => {
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw: 'bad json',
        schema: '{"key":"string"}',
      };

      mockedInvokeLlm.mockRejectedValue(new Error('LLM timeout'));

      await expect(jsonRepairNode(makeState(repairReq))).rejects.toThrow(
        'LLM timeout',
      );
    });
  });

  describe('prompt construction', () => {
    it('calls invokeLlm with a prompt containing the schema and raw output', async () => {
      const schema =
        '{"objective":"string","steps":[],"expected_result":"string"}';
      const raw = 'bad output';
      const repairReq: JsonRepairRequest = {
        fromPhase: 'plan',
        raw,
        schema,
      };

      mockedInvokeLlm.mockResolvedValue(
        '{"objective":"test","steps":[],"expected_result":"done"}',
      );

      await jsonRepairNode(makeState(repairReq));

      expect(mockedInvokeLlm).toHaveBeenCalledTimes(1);
      const promptArg = mockedInvokeLlm.mock.calls[0][0];
      expect(promptArg).toContain(schema);
      expect(promptArg).toContain(raw);
    });
  });
});
