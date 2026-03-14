import { researcherNode } from '../nodes/researcher.node';
import { AgentState } from '../state/agent.state';

const mockTreeInvoke = jest.fn();
const mockGitInvoke = jest.fn();

jest.mock('../tools/index', () => ({
  toolRegistry: {
    get: jest.fn((name: string) => {
      if (name === 'tree_dir') return { invoke: mockTreeInvoke };
      if (name === 'git_info') return { invoke: mockGitInvoke };
      return undefined;
    }),
  },
}));

const baseState: Partial<AgentState> = {
  input: 'test',
  attempts: [],
};

describe('researcherNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns projectContext with file tree and git status', async () => {
    mockTreeInvoke.mockResolvedValue('src/\n  index.ts');
    mockGitInvoke.mockResolvedValue('On branch main\nnothing to commit');

    const result = await researcherNode(baseState as AgentState);

    expect(result.projectContext).toContain('Project file tree');
    expect(result.projectContext).toContain('src/');
    expect(result.projectContext).toContain('Git status');
    expect(result.projectContext).toContain('On branch main');
  });

  it('includes (unavailable) sections when tools throw', async () => {
    mockTreeInvoke.mockRejectedValue(new Error('fs error'));
    mockGitInvoke.mockRejectedValue(new Error('git error'));

    const result = await researcherNode(baseState as AgentState);

    expect(result.projectContext).toContain('(unavailable)');
  });

  it('truncates long file trees to 80 lines', async () => {
    const longTree = Array.from({ length: 100 }, (_, i) => `file${i}.ts`).join(
      '\n',
    );
    mockTreeInvoke.mockResolvedValue(longTree);
    mockGitInvoke.mockResolvedValue('clean');

    const result = await researcherNode(baseState as AgentState);

    const treeSection = result.projectContext ?? '';
    expect(treeSection).toContain('more entries');
  });

  it('skips gathering when projectContext already exists', async () => {
    const stateWithContext = {
      ...baseState,
      projectContext: 'already gathered',
    } as AgentState;

    const result = await researcherNode(stateWithContext);

    expect(result).toEqual({});
    expect(mockTreeInvoke).not.toHaveBeenCalled();
    expect(mockGitInvoke).not.toHaveBeenCalled();
  });
});
