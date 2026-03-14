import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { sandboxPath } from '@utils/path.util';
import * as parser from '@babel/parser';
import * as t from '@babel/types';
import { readFileSync } from 'node:fs';

const SUPPORTED_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx'];

interface AstChunk {
  chunk_id: string;
  type: string;
  name?: string;
  summary: string;
  code_snippet: string;
  loc: { start: { line: number; column: number }; end: { line: number; column: number } };
}

function extractAstChunks(path: string, maxChunks?: number): AstChunk[] {
  const fullPath = sandboxPath(path);
  const code = readFileSync(fullPath, 'utf-8');
  const ext = fullPath.split('.').pop()?.toLowerCase() || '';

  if (!SUPPORTED_EXTENSIONS.includes(`.${ext}`)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'decorators-legacy', 'exportDefaultFrom', 'exportNamespaceFrom'],
    tokens: false,
    ranges: true,
  }) as t.File;

  const chunks: AstChunk[] = [];
  let count = 0;

  function traverse(node: t.Node) {
    if (maxChunks && count >= maxChunks) return;

    if (!node.loc) return;

    const loc = node.loc;
    const snippet = code.slice(node.start!, node.end!);

    if (t.isFunctionDeclaration(node)) {
      const name = node.id?.name || `fn_${chunks.length}`;
      chunks.push({
        chunk_id: `fn_${chunks.length}`,
        type: 'function',
        name,
        summary: `${name}(): ${node.params.length} params, ${loc.end.line - loc.start.line + 1} lines`,
        code_snippet: snippet.slice(0, 400) + (snippet.length > 400 ? '...' : ''),
        loc: { start: loc.start, end: loc.end },
      });
      count++;
    } else if (t.isClassDeclaration(node)) {
      const name = node.id?.name || `class_${chunks.length}`;
      chunks.push({
        chunk_id: `class_${chunks.length}`,
        type: 'class',
        name,
        summary: `${name}: ${node.body.body.length} members, ${loc.end.line - loc.start.line + 1} lines`,
        code_snippet: snippet.slice(0, 400) + (snippet.length > 400 ? '...' : ''),
        loc: { start: loc.start, end: loc.end },
      });
      count++;
    } else if (t.isVariableDeclaration(node) && node.declarations.length > 0) {
      const ids = node.declarations.map(decl => {
        if (t.isIdentifier(decl.id)) return decl.id.name;
        if (t.isObjectPattern(decl.id) || t.isArrayPattern(decl.id)) return 'destructured';
        return 'complex';
      });
      chunks.push({
        chunk_id: `var_${chunks.length}`,
        type: 'variable',
        name: ids.join(', '),
        summary: `Vars: ${ids.join(', ')}`,
        code_snippet: snippet.slice(0, 200) + (snippet.length > 200 ? '...' : ''),
        loc: { start: loc.start, end: loc.end },
      });
      count++;
    }

    // Traverse children
    if (t.isProgram(node)) {
      node.body.forEach(child => traverse(child));
    } else if (t.isBlock(node)) {
      node.body.forEach(child => traverse(child));
    }
  }

  traverse(ast.program);

  return chunks.slice(0, maxChunks || Infinity);
}

export const astParseTool = new DynamicStructuredTool({
  name: 'ast_parse',
  description: 'Parse JS/TS file to semantic AST chunks (functions/classes/vars). Use for structural code analysis.',
  schema: z.object({
    path: z.string().describe('Path to JS/TS file'),
    maxChunks: z.number().int().min(1).max(50).optional().default(20).describe('Max chunks'),
  }),
  func: async ({ path, maxChunks }) => {
    try {
      const chunks = extractAstChunks(path, maxChunks);
      return `AST parsed: ${chunks.length} chunks from ${path}\n` + JSON.stringify(chunks, null, 2);
    } catch (error) {
      return `ERROR: ${(error as Error).message}`;
    }
  },
});

