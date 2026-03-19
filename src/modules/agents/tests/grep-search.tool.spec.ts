import { grepSearchTool } from '../tools/grep-search.tool';

jest.mock('@config/env', () => ({
  env: {
    agentWorkingDir: '/tmp',
    toolTimeoutMs: 5000,
  },
}));

// sandboxPath depends on env.agentWorkingDir = '/tmp', so any path resolving
// inside /tmp will pass; paths outside /tmp will throw.
jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => {
    const { resolve } = require('node:path');
    const root = '/tmp';
    const target = p === '.' ? root : resolve(p);
    if (target !== root && !target.startsWith(root + '/')) {
      throw new Error(
        `Access denied: "${p}" is outside the sandbox "${root}"`,
      );
    }
    return target;
  },
}));

jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}));

import { execFile } from 'node:child_process';

const mockedExecFile = execFile as jest.MockedFunction<typeof execFile>;

function stubExecFile(
  stdout: string,
  stderr = '',
  error: (Error & { code?: number }) | null = null,
) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
    callback(error, stdout, stderr);
    return {} as any;
  });
}

describe('grepSearchTool', () => {
  afterEach(() => jest.clearAllMocks());

  describe('happy path', () => {
    it('returns matches with header when pattern is found', async () => {
      const grepOutput =
        '/tmp/src/foo.ts:10:  const x = 1;\n/tmp/src/bar.ts:20:  const x = 2;';
      stubExecFile(grepOutput);

      const result = await grepSearchTool.invoke({ pattern: 'const x' });

      expect(result).toContain('Found 2 matches:');
      expect(result).toContain('/tmp/src/foo.ts:10');
      expect(result).toContain('/tmp/src/bar.ts:20');
    });

    it('returns single match with singular "match"', async () => {
      stubExecFile('/tmp/src/foo.ts:5:  hello world');

      const result = await grepSearchTool.invoke({ pattern: 'hello' });

      expect(result).toContain('Found 1 match:');
    });

    it('passes glob filter to execFile', async () => {
      stubExecFile('/tmp/src/foo.ts:1:  match');

      await grepSearchTool.invoke({ pattern: 'match', glob: '*.ts' });

      expect(mockedExecFile).toHaveBeenCalledWith(
        'grep',
        expect.arrayContaining(['--include=*.ts']),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('defaults search path to resolved agentWorkingDir when path is omitted', async () => {
      stubExecFile('/tmp/file.ts:1:  match');

      await grepSearchTool.invoke({ pattern: 'match' });

      expect(mockedExecFile).toHaveBeenCalledWith(
        'grep',
        expect.arrayContaining(['/tmp']),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('no matches', () => {
    it('returns no-matches message when stdout is empty and exit code is 1 (grep convention)', async () => {
      const exitOneErr = Object.assign(new Error('grep exit 1'), { code: 1 });
      stubExecFile('', '', exitOneErr);

      const result = await grepSearchTool.invoke({ pattern: 'nope' });

      expect(result).toContain('No matches found');
      expect(result).toContain('nope');
    });

    it('returns no-matches when stdout is blank and no error', async () => {
      stubExecFile('   ', '', null);

      const result = await grepSearchTool.invoke({ pattern: 'nope' });

      expect(result).toContain('No matches found');
    });
  });

  describe('error handling', () => {
    it('returns ERROR when execFile fails with non-1 code', async () => {
      const fatalErr = Object.assign(new Error('permission denied'), {
        code: 2,
      });
      stubExecFile('', 'grep: /tmp/bad: Permission denied', fatalErr);

      const result = await grepSearchTool.invoke({ pattern: 'foo' });

      expect(result).toMatch(/^ERROR:/);
    });

    it('rejects path outside sandbox before calling execFile', async () => {
      // sandboxPath throws synchronously; the LangChain tool wrapper propagates
      // the error as a rejected promise (does not swallow it into a string result).
      await expect(
        grepSearchTool.invoke({
          pattern: 'secret',
          path: '/etc/passwd',
        }),
      ).rejects.toThrow(/Access denied/);

      expect(mockedExecFile).not.toHaveBeenCalled();
    });
  });
});
