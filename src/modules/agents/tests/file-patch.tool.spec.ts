import { filePatchTool } from '../tools/file-patch.tool';

jest.mock('@config/env', () => ({
  env: {
    agentWorkingDir: '/tmp',
    toolTimeoutMs: 5000,
  },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => {
    const { resolve } = require('node:path');
    const root = '/tmp';
    const target = resolve(p);
    if (target !== root && !target.startsWith(root + '/')) {
      throw new Error(`Access denied: "${p}" is outside the sandbox "${root}"`);
    }
    return target;
  },
}));

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

import { readFile, writeFile } from 'node:fs/promises';

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

describe('filePatchTool', () => {
  afterEach(() => jest.clearAllMocks());

  describe('happy path', () => {
    it('finds unique text and replaces it, then writes updated file', async () => {
      const originalContent = 'line one\nconst FOO = 1;\nline three';
      mockedReadFile.mockResolvedValue(originalContent as any);
      mockedWriteFile.mockResolvedValue(undefined);

      const result = await filePatchTool.invoke({
        path: '/tmp/src/test.ts',
        find: 'const FOO = 1;',
        replace: 'const FOO = 42;',
      });

      expect(result).toContain('Patched');
      expect(result).toContain('/tmp/src/test.ts');
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/tmp/src/test.ts',
        'line one\nconst FOO = 42;\nline three',
        'utf-8',
      );
    });

    it('reports the number of lines affected', async () => {
      mockedReadFile.mockResolvedValue('a\nb\nc' as any);
      mockedWriteFile.mockResolvedValue(undefined);

      const result = await filePatchTool.invoke({
        path: '/tmp/a.ts',
        find: 'a\nb',
        replace: 'x\ny',
      });

      // find has 2 lines → "2 lines affected"
      expect(result).toContain('2 lines');
    });
  });

  describe('error: pattern not found', () => {
    it('returns JSON with ok:false when find string is absent', async () => {
      mockedReadFile.mockResolvedValue('completely different content' as any);

      const result = await filePatchTool.invoke({
        path: '/tmp/a.ts',
        find: 'THIS_DOES_NOT_EXIST',
        replace: 'whatever',
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatch(/not found/i);
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('error: multiple occurrences', () => {
    it('returns JSON with ok:false when find string appears more than once', async () => {
      mockedReadFile.mockResolvedValue('dup\ndup\n' as any);

      const result = await filePatchTool.invoke({
        path: '/tmp/a.ts',
        find: 'dup',
        replace: 'unique',
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatch(/2 times/);
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('error: file does not exist', () => {
    it('returns ERROR prefix when readFile throws ENOENT', async () => {
      const notFound = Object.assign(new Error('ENOENT: no such file'), {
        code: 'ENOENT',
      });
      mockedReadFile.mockRejectedValue(notFound);

      const result = await filePatchTool.invoke({
        path: '/tmp/missing.ts',
        find: 'x',
        replace: 'y',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('missing.ts');
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('sandbox enforcement', () => {
    it('throws when path is outside agentWorkingDir', async () => {
      // sandboxPath throws synchronously before readFile is called
      await expect(
        filePatchTool.invoke({
          path: '/etc/passwd',
          find: 'root',
          replace: 'hacked',
        }),
      ).rejects.toThrow(/Access denied/);

      expect(mockedReadFile).not.toHaveBeenCalled();
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });
  });
});
