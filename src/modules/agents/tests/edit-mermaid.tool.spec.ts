import { editMermaidTool } from '../tools/edit-mermaid.tool';

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

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

import { invokeLlm } from '@llm/llm.provider';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const mockedInvokeLlm = invokeLlm as jest.MockedFunction<typeof invokeLlm>;
const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

const EXISTING_DIAGRAM = `flowchart LR
  A[Start] --> B[Process] --> C[End]`;

const UPDATED_DIAGRAM = `flowchart LR
  A[Start] --> B[Process] --> C[Review] --> D[End]`;

describe('editMermaidTool', () => {
  afterEach(() => jest.clearAllMocks());

  describe('happy path', () => {
    it('reads existing file, invokes LLM, writes updated diagram', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(UPDATED_DIAGRAM);

      const result = await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'Add a Review step before the End node',
      });

      expect(result).toContain('mermaid diagram updated at');
      expect(result).toContain('/tmp/diagram.mmd');
      expect(mockedReadFile).toHaveBeenCalledWith('/tmp/diagram.mmd', 'utf-8');
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/tmp/diagram.mmd',
        expect.stringContaining('flowchart LR'),
        'utf-8',
      );
    });

    it('strips markdown fences from LLM output before writing', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(
        '```mermaid\n' + UPDATED_DIAGRAM + '\n```',
      );

      const result = await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'Add Review step',
      });

      expect(result).toContain('mermaid diagram updated at');
      const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).not.toContain('```');
    });

    it('passes current diagram content to LLM prompt', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(UPDATED_DIAGRAM);

      await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'Add a node',
      });

      const promptArg = mockedInvokeLlm.mock.calls[0][0];
      expect(promptArg).toContain(EXISTING_DIAGRAM);
      expect(promptArg).toContain('Add a node');
    });

    it('ensures written file ends with newline', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(UPDATED_DIAGRAM); // no trailing \n

      await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'Add a node',
      });

      const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
      expect(writtenContent.endsWith('\n')).toBe(true);
    });
  });

  describe('sanitizeMermaid', () => {
    it('rewrites reserved "graph -->" id to avoid parser conflicts', async () => {
      const rawWithReserved = 'flowchart LR\n  graph --> B';
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(rawWithReserved);

      await editMermaidTool.invoke({
        path: '/tmp/x.mmd',
        instruction: 'some instruction',
      });

      const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).not.toContain('graph -->');
      expect(writtenContent).toContain('G -->');
    });
  });

  describe('error paths', () => {
    it('returns ERROR when path does not end with .mmd', async () => {
      const result = await editMermaidTool.invoke({
        path: '/tmp/diagram.png',
        instruction: 'Add a node',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('.mmd');
      expect(mockedReadFile).not.toHaveBeenCalled();
      expect(mockedInvokeLlm).not.toHaveBeenCalled();
    });

    it('throws/rejects when file cannot be read (not found)', async () => {
      const notFound = Object.assign(new Error('ENOENT: no such file'), {
        code: 'ENOENT',
      });
      mockedReadFile.mockRejectedValue(notFound);

      await expect(
        editMermaidTool.invoke({
          path: '/tmp/missing.mmd',
          instruction: 'Add a node',
        }),
      ).rejects.toThrow(/ENOENT/);

      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('returns ERROR when LLM returns empty output', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue('   '); // whitespace only

      const result = await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'Do something',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('empty');
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('returns ERROR when LLM returns non-Mermaid output', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(
        'Sorry, I cannot help with that. Here is my explanation...',
      );

      const result = await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'something',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('Mermaid syntax');
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('returns ERROR when LLM returns code-listing style output', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(
        'flowchart LR\n  A --> B\n  const graph = new StateGraph()',
      );

      const result = await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'update the diagram',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('code-listing');
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('does NOT flag code listing when instruction explicitly mentions it', async () => {
      mockedReadFile.mockResolvedValue(EXISTING_DIAGRAM as any);
      mockedInvokeLlm.mockResolvedValue(
        'flowchart LR\n  A --> B\n  const graph = new StateGraph()',
      );

      const result = await editMermaidTool.invoke({
        path: '/tmp/diagram.mmd',
        instruction: 'Show a code listing diagram',
      });

      expect(result).toContain('mermaid diagram updated at');
      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });

  describe('sandbox enforcement', () => {
    it('throws when path resolves outside agentWorkingDir', async () => {
      await expect(
        editMermaidTool.invoke({
          path: '/etc/hosts.mmd',
          instruction: 'Add a node',
        }),
      ).rejects.toThrow(/Access denied/);

      expect(mockedReadFile).not.toHaveBeenCalled();
    });
  });
});
