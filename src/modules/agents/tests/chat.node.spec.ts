import { chatNode } from '../nodes/chat.node';
import { AgentState } from '../state/agent.state';
import { invokeLlm } from '@llm/llm.provider';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    promptMaxSummaryChars: 2000,
    promptMaxAttempts: 5,
    agentWorkingDir: '/tmp',
    criticResultMaxChars: 8000,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('@utils/pretty-log.util', () => ({
  logPhaseStart: jest.fn(),
  logPhaseEnd: jest.fn(),
  startTimer: jest.fn(() => () => 0),
}));

// Prevent tools/index (and its dependencies like TAVILY_API_KEY) from loading
jest.mock('../tools/index', () => ({
  toolRegistry: {
    describeForPrompt: jest.fn(() => '- mock_tool: A mock tool'),
  },
}));

// Mock agent.prompts so buildChatPrompt returns a controllable string
jest.mock('../prompts/agent.prompts', () => ({
  buildChatPrompt: jest.fn((state: { input: string; sessionMemory?: string }) => {
    const memory = state.sessionMemory ? `\n\nConversation history:\n${state.sessionMemory}` : '';
    return `You are a helpful AI assistant.${memory}\nUser: ${state.input}\nAssistant:`;
  }),
}));

const mockedInvokeLlm = jest.mocked(invokeLlm);

const baseState: Partial<AgentState> = {
  input: 'Hello, how are you?',
  attempts: [],
  plan: [],
  errors: [],
  currentStep: 0,
  counters: {
    turn: 0,
    toolCalls: 0,
    replans: 0,
    stepRetries: 0,
    supervisorFallbacks: 0,
  },
};

describe('chatNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls invokeLlm and returns finalAnswer with phase=complete', async () => {
    mockedInvokeLlm.mockResolvedValue('  Hello! I am doing great.  ');

    const result = await chatNode(baseState as AgentState);

    expect(mockedInvokeLlm).toHaveBeenCalledTimes(1);
    expect(result.finalAnswer).toBe('Hello! I am doing great.');
    expect(result.phase).toBe('complete');
  });

  it('includes sessionMemory in prompt context when provided', async () => {
    mockedInvokeLlm.mockResolvedValue('Great, glad you asked!');

    const stateWithMemory: Partial<AgentState> = {
      ...baseState,
      sessionMemory:
        'User previously asked about NestJS and preferred TypeScript examples.',
    };

    const result = await chatNode(stateWithMemory as AgentState);

    expect(mockedInvokeLlm).toHaveBeenCalledTimes(1);
    // The prompt passed to invokeLlm should contain the session memory
    const promptArg = mockedInvokeLlm.mock.calls[0][0];
    expect(promptArg).toContain('NestJS');
    expect(result.finalAnswer).toBe('Great, glad you asked!');
    expect(result.phase).toBe('complete');
  });

  it('handles empty sessionMemory gracefully and still produces finalAnswer', async () => {
    mockedInvokeLlm.mockResolvedValue('Sure, I can help with that!');

    const stateNoMemory: Partial<AgentState> = {
      ...baseState,
      sessionMemory: undefined,
    };

    const result = await chatNode(stateNoMemory as AgentState);

    expect(result.finalAnswer).toBe('Sure, I can help with that!');
    expect(result.phase).toBe('complete');
  });

  it('trims whitespace from LLM response before setting finalAnswer', async () => {
    mockedInvokeLlm.mockResolvedValue('\n\n   Trimmed response.   \n');

    const result = await chatNode(baseState as AgentState);

    expect(result.finalAnswer).toBe('Trimmed response.');
  });

  it('returns finalAnswer as string type', async () => {
    mockedInvokeLlm.mockResolvedValue('I am a string response');

    const result = await chatNode(baseState as AgentState);

    expect(typeof result.finalAnswer).toBe('string');
  });

  it('propagates LLM errors', async () => {
    mockedInvokeLlm.mockRejectedValue(new Error('LLM timeout'));

    await expect(chatNode(baseState as AgentState)).rejects.toThrow(
      'LLM timeout',
    );
  });

  it('includes user input in the prompt sent to invokeLlm', async () => {
    mockedInvokeLlm.mockResolvedValue('Answer');

    const stateWithInput: Partial<AgentState> = {
      ...baseState,
      input: 'What is LangGraph?',
    };

    await chatNode(stateWithInput as AgentState);

    const promptArg = mockedInvokeLlm.mock.calls[0][0];
    expect(promptArg).toContain('What is LangGraph?');
  });
});
