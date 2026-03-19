import { gitInfoTool } from '../tools/git-info.tool';

jest.mock('@config/env', () => ({
  env: {
    agentWorkingDir: '/tmp',
    toolTimeoutMs: 5000,
  },
}));

// We mock execFile at the child_process module level
jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}));

import { execFile } from 'node:child_process';

const mockedExecFile = execFile as jest.MockedFunction<typeof execFile>;

/** Helper: simulate execFile calling its callback */
function stubExecFile(stdout: string, stderr = '', error: Error | null = null) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
    callback(error, stdout, stderr);
    return {} as any;
  });
}

describe('gitInfoTool', () => {
  afterEach(() => jest.clearAllMocks());

  describe('action: status', () => {
    it('returns git status output on success', async () => {
      stubExecFile('M  src/foo.ts\n?? src/bar.ts');

      const result = await gitInfoTool.invoke({ action: 'status' });

      expect(result).toContain('M  src/foo.ts');
      expect(result).toContain('src/bar.ts');
      // Verify execFile was called with correct git args
      expect(mockedExecFile).toHaveBeenCalledWith(
        'git',
        ['status', '--short'],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('returns (no output) when stdout is empty', async () => {
      stubExecFile('');

      const result = await gitInfoTool.invoke({ action: 'status' });

      expect(result).toBe('(no output)');
    });
  });

  describe('action: log', () => {
    it('returns recent commits on success', async () => {
      stubExecFile('abc1234 feat: add new feature\ndef5678 fix: bug fix');

      const result = await gitInfoTool.invoke({ action: 'log' });

      expect(result).toContain('feat: add new feature');
      expect(result).toContain('fix: bug fix');
      expect(mockedExecFile).toHaveBeenCalledWith(
        'git',
        ['log', '--oneline', '-20'],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('passes extra args to log', async () => {
      stubExecFile('abc1234 some commit');

      await gitInfoTool.invoke({ action: 'log', args: '--author=Alice' });

      expect(mockedExecFile).toHaveBeenCalledWith(
        'git',
        ['log', '--oneline', '-20', '--author=Alice'],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('action: diff', () => {
    it('returns diff output', async () => {
      stubExecFile('diff --git a/foo.ts b/foo.ts\n+added line');

      const result = await gitInfoTool.invoke({ action: 'diff' });

      expect(result).toContain('+added line');
    });
  });

  describe('action: branch', () => {
    it('returns branch list', async () => {
      stubExecFile('* main\n  feature/new');

      const result = await gitInfoTool.invoke({ action: 'branch' });

      expect(result).toContain('* main');
    });
  });

  describe('action: show', () => {
    it('returns commit details', async () => {
      stubExecFile('commit abc1234\nAuthor: Test User');

      const result = await gitInfoTool.invoke({ action: 'show' });

      expect(result).toContain('abc1234');
    });
  });

  describe('error handling', () => {
    it('returns ERROR prefix when execFile yields an error', async () => {
      const err = new Error('not a git repository');
      stubExecFile('', 'fatal: not a git repo', err);

      const result = await gitInfoTool.invoke({ action: 'status' });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('fatal: not a git repo');
    });

    it('falls back to error.message when stderr is empty', async () => {
      const err = new Error('execFile failed');
      stubExecFile('', '', err);

      const result = await gitInfoTool.invoke({ action: 'status' });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('execFile failed');
    });

    it('returns ERROR for unknown action', async () => {
      // Unknown action check happens before execFile is called
      const result = await gitInfoTool.invoke({ action: 'unknown_action' });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('unknown action');
      expect(result).toContain('unknown_action');
    });
  });
});
