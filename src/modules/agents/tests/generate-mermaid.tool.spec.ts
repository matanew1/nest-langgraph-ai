import { generateMermaidTool } from '../tools/generate-mermaid.tool';

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
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

import { invokeLlm } from '@llm/llm.provider';
import { mkdir, writeFile } from 'node:fs/promises';

const mockedInvokeLlm = invokeLlm as jest.MockedFunction<typeof invokeLlm>;
const mockedMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

const VALID_MERMAID = `flowchart LR
  A[Start] --> B[End]`;

describe('generateMermaidTool', () => {
  afterEach(() => jest.clearAllMocks());

  describe('happy path', () => {
    it('invokes LLM, strips fences, writes .mmd file and returns success message', async () => {
      mockedInvokeLlm.mockResolvedValue(
        '```mermaid\n' + VALID_MERMAID + '\n```',
      );

      const result = await generateMermaidTool.invoke({
        description: 'Simple flowchart',
        path: '/tmp/diagram.mmd',
      });

      expect(result).toContain('mermaid diagram saved to');
      expect(result).toContain('/tmp/diagram.mmd');
      expect(mockedMkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/tmp/diagram.mmd',
        expect.stringContaining('flowchart LR'),
        'utf-8',
      );
    });

    it('handles LLM output without markdown fences', async () => {
      mockedInvokeLlm.mockResolvedValue(VALID_MERMAID);

      const result = await generateMermaidTool.invoke({
        description: 'Simple flowchart',
        path: '/tmp/diagram.mmd',
      });

      expect(result).toContain('mermaid diagram saved to');
    });

    it('passes source text to LLM prompt when provided', async () => {
      mockedInvokeLlm.mockResolvedValue(VALID_MERMAID);

      await generateMermaidTool.invoke({
        description: 'Agent architecture',
        source: 'graph.ts source code here',
        path: '/tmp/agent.mmd',
      });

      const promptArg = mockedInvokeLlm.mock.calls[0][0];
      expect(promptArg).toContain('graph.ts source code here');
    });

    it('ensures file ends with newline', async () => {
      mockedInvokeLlm.mockResolvedValue(VALID_MERMAID); // no trailing \n

      await generateMermaidTool.invoke({
        description: 'flowchart',
        path: '/tmp/out.mmd',
      });

      const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
      expect(writtenContent.endsWith('\n')).toBe(true);
    });
  });

  describe('sanitizeMermaid', () => {
    it('rewrites "graph -->" node id to avoid reserved word collision', async () => {
      const raw = 'flowchart LR\n  graph --> B';
      mockedInvokeLlm.mockResolvedValue(raw);

      await generateMermaidTool.invoke({
        description: 'test',
        path: '/tmp/x.mmd',
      });

      const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).not.toContain('graph -->');
      expect(writtenContent).toContain('G -->');
    });
  });

  describe('error paths', () => {
    it('returns ERROR when path does not end with .mmd', async () => {
      const result = await generateMermaidTool.invoke({
        description: 'test',
        path: '/tmp/diagram.png',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('.mmd');
      expect(mockedInvokeLlm).not.toHaveBeenCalled();
    });

    it('returns ERROR when LLM returns non-Mermaid output', async () => {
      mockedInvokeLlm.mockResolvedValue(
        'Here is a description of your diagram without any Mermaid syntax.',
      );

      const result = await generateMermaidTool.invoke({
        description: 'test',
        path: '/tmp/diagram.mmd',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('Mermaid syntax');
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('returns ERROR when LLM returns code-listing style diagram', async () => {
      const codeListing = `flowchart LR
  A --> B
  const graph = new StateGraph()`;
      mockedInvokeLlm.mockResolvedValue(codeListing);

      const result = await generateMermaidTool.invoke({
        description: 'architecture overview',
        path: '/tmp/diagram.mmd',
      });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('code-listing');
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it('does NOT flag code-listing when description explicitly mentions it', async () => {
      const codeListing = `flowchart LR
  A --> B
  const graph = new StateGraph()`;
      mockedInvokeLlm.mockResolvedValue(codeListing);

      const result = await generateMermaidTool.invoke({
        description: 'Show a code listing diagram of the graph',
        path: '/tmp/code-listing.mmd',
      });

      // Should succeed (write file) since description includes "code listing"
      expect(result).toContain('mermaid diagram saved to');
      expect(mockedWriteFile).toHaveBeenCalled();
    });
  });
});
