import { researchFsNode } from '../nodes/research-fs.node';
import { AgentState } from '../state/agent.state';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    agentMaxRetries: 0,
    toolTimeoutMs: 5000,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('@vector-db/vector-memory.util', () => ({
  buildVectorResearchContext: jest.fn(),
}));

const mockTreeInvoke = jest.fn();
const mockGitInvoke = jest.fn();
const mockImpactRadarInvoke = jest.fn();

jest.mock('../tools/index', () => ({
  toolRegistry: {
    get: jest.fn((name: string) => {
      if (name === 'tree_dir') return { invoke: mockTreeInvoke };
      if (name === 'git_info') return { invoke: mockGitInvoke };
      if (name === 'repo_impact_radar') return { invoke: mockImpactRadarInvoke };
      return undefined;
    }),
  },
}));

const baseState: Partial<AgentState> = {
  input: 'test',
  phase: 'research',
  attempts: [],
};

describe('researchFsNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns projectContext with file tree and git status', async () => {
    mockTreeInvoke.mockResolvedValue('src/\n  index.ts');
    mockGitInvoke.mockResolvedValue('On branch main\nnothing to commit');
    mockImpactRadarInvoke.mockResolvedValue(
      'Impact radar for objective: test\n## Likely source files\n1. src/index.ts',
    );

    const result = await researchFsNode(baseState as AgentState);

    expect(result.projectContext).toContain('Project file tree');
    expect(result.projectContext).toContain('src/');
    expect(result.projectContext).toContain('Git status');
    expect(result.projectContext).toContain('On branch main');
    expect(result.projectContext).toContain('Impact radar');
  });

  it('does NOT set phase', async () => {
    mockTreeInvoke.mockResolvedValue('src/');
    mockGitInvoke.mockResolvedValue('clean');
    mockImpactRadarInvoke.mockResolvedValue('Impact radar');

    const result = await researchFsNode(baseState as AgentState);

    expect(result.phase).toBeUndefined();
  });

  it('does NOT write memoryContext or vectorMemoryIds', async () => {
    mockTreeInvoke.mockResolvedValue('src/');
    mockGitInvoke.mockResolvedValue('clean');
    mockImpactRadarInvoke.mockResolvedValue('Impact radar');

    const result = await researchFsNode(baseState as AgentState);

    expect(result.memoryContext).toBeUndefined();
    expect(result.vectorMemoryIds).toBeUndefined();
  });

  it('includes (unavailable) sections when tools throw', async () => {
    mockTreeInvoke.mockRejectedValue(new Error('fs error'));
    mockGitInvoke.mockRejectedValue(new Error('git error'));
    mockImpactRadarInvoke.mockRejectedValue(new Error('impact error'));

    const result = await researchFsNode(baseState as AgentState);

    expect(result.projectContext).toContain('(unavailable)');
  });

  it('truncates long file trees to researcherTreeMaxLines lines', async () => {
    const longTree = Array.from({ length: 100 }, (_, i) => `file${i}.ts`).join(
      '\n',
    );
    mockTreeInvoke.mockResolvedValue(longTree);
    mockGitInvoke.mockResolvedValue('clean');
    mockImpactRadarInvoke.mockResolvedValue('Impact radar');

    const result = await researchFsNode(baseState as AgentState);

    expect(result.projectContext).toContain('more entries');
  });

  it('reuses cached projectContext without calling tools', async () => {
    const stateWithContext = {
      ...baseState,
      projectContext: 'already gathered',
    } as AgentState;

    const result = await researchFsNode(stateWithContext);

    expect(result.projectContext).toBe('already gathered');
    expect(mockTreeInvoke).not.toHaveBeenCalled();
    expect(mockGitInvoke).not.toHaveBeenCalled();
    expect(mockImpactRadarInvoke).not.toHaveBeenCalled();
  });
});
