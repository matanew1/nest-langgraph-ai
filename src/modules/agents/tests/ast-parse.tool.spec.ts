import { astParseTool } from '../tools/ast-parse.tool';

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

jest.mock('node:fs', () => ({
  readFileSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ size: 1000 }), // default: small file, within limit
}));

// The state-graph-extractor is a local utility; mock it to avoid needing a
// real file-system based AST. It's an implementation detail tested separately.
jest.mock('../tools/state-graph-extractor', () => ({
  extractStateGraphNodes: jest.fn().mockReturnValue([]),
}));

import { readFileSync } from 'node:fs';

const mockedReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;

describe('astParseTool', () => {
  afterEach(() => jest.clearAllMocks());

  describe('happy path: TypeScript file', () => {
    it('parses a TypeScript file and returns functions/classes in JSON output', async () => {
      const tsSource = `
export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export class MyService {
  doWork() {
    return 42;
  }
}
`.trim();

      mockedReadFileSync.mockReturnValue(tsSource as any);

      const result = await astParseTool.invoke({ path: '/tmp/src/example.ts' });

      expect(result).toContain('AST parsed:');
      // Should identify the function and class
      expect(result).toContain('greet');
      expect(result).toContain('MyService');
      // Output should be JSON-parseable after the header line
      const jsonStart = result.indexOf('[');
      expect(jsonStart).toBeGreaterThan(-1);
      const chunks = JSON.parse(result.slice(jsonStart));
      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
      // Each chunk should have the expected shape
      for (const chunk of chunks) {
        expect(chunk).toHaveProperty('chunk_id');
        expect(chunk).toHaveProperty('type');
        expect(chunk).toHaveProperty('summary');
        expect(chunk).toHaveProperty('code_snippet');
        expect(chunk).toHaveProperty('loc');
      }
    });

    it('extracts arrow-function variables', async () => {
      const tsSource = `const add = (a: number, b: number) => a + b;`;
      mockedReadFileSync.mockReturnValue(tsSource as any);

      const result = await astParseTool.invoke({ path: '/tmp/src/utils.ts' });

      expect(result).toContain('add');
    });

    it('respects maxChunks limit', async () => {
      const tsSource = `
function fn1() {}
function fn2() {}
function fn3() {}
function fn4() {}
function fn5() {}
`.trim();

      mockedReadFileSync.mockReturnValue(tsSource as any);

      const result = await astParseTool.invoke({
        path: '/tmp/src/many.ts',
        maxChunks: 2,
      });

      const jsonStart = result.indexOf('[');
      const chunks = JSON.parse(result.slice(jsonStart));
      expect(chunks.length).toBeLessThanOrEqual(2);
    });
  });

  describe('error paths', () => {
    it('returns ERROR prefix for invalid syntax without throwing', async () => {
      // Completely invalid TypeScript source
      mockedReadFileSync.mockReturnValue('@@@ NOT VALID CODE @@@' as any);

      const result = await astParseTool.invoke({ path: '/tmp/src/broken.ts' });

      expect(result).toMatch(/^ERROR:/);
    });

    it('returns ERROR for unsupported file extension', async () => {
      mockedReadFileSync.mockReturnValue('body { color: red; }' as any);

      const result = await astParseTool.invoke({ path: '/tmp/src/styles.css' });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('Unsupported file type');
    });

    it('returns ERROR when readFileSync throws (file not found)', async () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const result = await astParseTool.invoke({ path: '/tmp/src/missing.ts' });

      expect(result).toMatch(/^ERROR:/);
      expect(result).toContain('ENOENT');
    });

    it('returns ERROR for path outside sandbox', async () => {
      // sandboxPath will throw for /etc paths
      const result = await astParseTool.invoke({ path: '/etc/passwd.ts' });

      expect(result).toMatch(/^ERROR:/);
      expect(mockedReadFileSync).not.toHaveBeenCalled();
    });
  });
});
