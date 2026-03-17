import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { sandboxPath } from '@utils/path.util';
import * as parser from '@babel/parser';
import * as t from '@babel/types';
import { readFileSync } from 'node:fs';
import { extractStateGraphNodes } from './state-graph-extractor';

const SUPPORTED_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx'];

interface AstChunk {
  chunk_id: string;
  type: string;
  name?: string;
  summary: string;
  code_snippet: string;
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

function extractAstChunks(path: string, maxChunks?: number): AstChunk[] {
  const fullPath = sandboxPath(path);
  const code = readFileSync(fullPath, 'utf-8');
  const ext = fullPath.split('.').pop()?.toLowerCase() || '';

  if (!SUPPORTED_EXTENSIONS.includes(`.${ext}`)) {
    throw new Error(
      `Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }

  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: [
      'typescript',
      'jsx',
      'decorators-legacy',
      'exportDefaultFrom',
      'exportNamespaceFrom',
    ],
    tokens: false,
    ranges: true,
  }) as t.File;

  const chunks: AstChunk[] = [];
  let count = 0;

  function traverse(node: t.Node, parentClassName?: string) {
    if (maxChunks && count >= maxChunks) return;

    if (!node.loc) return;

    const loc = node.loc;
    const snippet = code.slice(node.start!, node.end!);

    if (t.isFunctionDeclaration(node)) {
      const name = node.id?.name || `fn_${chunks.length}`;
      const label = parentClassName ? `${parentClassName}.${name}` : name;
      chunks.push({
        chunk_id: `fn_${chunks.length}`,
        type: 'function',
        name: label,
        summary: `${label}(): ${node.params.length} params, ${loc.end.line - loc.start.line + 1} lines`,
        code_snippet:
          snippet.slice(0, 400) + (snippet.length > 400 ? '...' : ''),
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
        code_snippet:
          snippet.slice(0, 400) + (snippet.length > 400 ? '...' : ''),
        loc: { start: loc.start, end: loc.end },
      });
      count++;
      // Traverse class body to extract methods
      node.body.body.forEach((member) => traverse(member, name));
    } else if (t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
      const className = parentClassName ?? 'UnknownClass';
      const methodName = t.isIdentifier(node.key)
        ? node.key.name
        : t.isPrivateName(node.key)
          ? `#${node.key.id.name}`
          : `method_${chunks.length}`;
      const label = `${className}.${methodName}`;
      chunks.push({
        chunk_id: `method_${chunks.length}`,
        type: 'method',
        name: label,
        summary: `${label}(): ${node.params.length} params, ${loc.end.line - loc.start.line + 1} lines`,
        code_snippet:
          snippet.slice(0, 400) + (snippet.length > 400 ? '...' : ''),
        loc: { start: loc.start, end: loc.end },
      });
      count++;
    } else if (t.isExportNamedDeclaration(node) && node.declaration) {
      // Unwrap and process the inner declaration
      traverse(node.declaration, parentClassName);
    } else if (t.isExportDefaultDeclaration(node) && node.declaration) {
      traverse(node.declaration as t.Node, parentClassName);
    } else if (t.isVariableDeclaration(node) && node.declarations.length > 0) {
      // Check if any declarator has an arrow function initializer
      for (const decl of node.declarations) {
        if (
          t.isIdentifier(decl.id) &&
          decl.init &&
          (t.isArrowFunctionExpression(decl.init) ||
            t.isFunctionExpression(decl.init))
        ) {
          const name = decl.id.name;
          const label = parentClassName ? `${parentClassName}.${name}` : name;
          const declLoc = decl.loc ?? loc;
          const declSnippet = code.slice(decl.start!, decl.end!);
          chunks.push({
            chunk_id: `fn_${chunks.length}`,
            type: 'function',
            name: label,
            summary: `${label}(): ${decl.init.params.length} params, ${declLoc.end.line - declLoc.start.line + 1} lines`,
            code_snippet:
              declSnippet.slice(0, 400) +
              (declSnippet.length > 400 ? '...' : ''),
            loc: { start: declLoc.start, end: declLoc.end },
          });
          count++;
          if (maxChunks && count >= maxChunks) return;
        }
      }
      // Fall through to also emit a variable chunk for non-arrow declarators
      const nonFnIds = node.declarations
        .filter(
          (decl) =>
            !(
              t.isIdentifier(decl.id) &&
              decl.init &&
              (t.isArrowFunctionExpression(decl.init) ||
                t.isFunctionExpression(decl.init))
            ),
        )
        .map((decl) => {
          if (t.isIdentifier(decl.id)) return decl.id.name;
          if (t.isObjectPattern(decl.id) || t.isArrayPattern(decl.id))
            return 'destructured';
          return 'complex';
        });
      // Detect StateGraph fluent builders and extract .addNode calls
      for (const decl of node.declarations) {
        if (
          t.isIdentifier(decl.id) &&
          decl.init &&
          t.isCallExpression(decl.init)
        ) {
          const stateNodes = extractStateGraphNodes(decl.init, code);
          if (stateNodes.length > 0) {
            stateNodes.forEach((nodeChunk) => {
              chunks.push(nodeChunk);
              count++;
              if (maxChunks && count >= maxChunks) return;
            });
          }
        }
      }
      if (nonFnIds.length > 0 && !(maxChunks && count >= maxChunks)) {
        chunks.push({
          chunk_id: `var_${chunks.length}`,
          type: 'variable',
          name: nonFnIds.join(', '),
          summary: `Vars: ${nonFnIds.join(', ')}`,
          code_snippet:
            snippet.slice(0, 500) + (snippet.length > 500 ? '...' : ''),
          loc: { start: loc.start, end: loc.end },
        });
        count++;
      }
    }

    // Traverse children (only top-level program body; class body handled above)
    if (t.isProgram(node)) {
      node.body.forEach((child) => traverse(child));
    } else if (t.isBlock(node)) {
      node.body.forEach((child) => traverse(child));
    }
  }

  traverse(ast.program);

  return chunks.slice(0, maxChunks || Infinity);
}

export const astParseTool = new DynamicStructuredTool({
  name: 'ast_parse',
  description:
    'Parse JS/TS file to semantic AST chunks (functions/classes/methods/vars/StateGraph nodes). Use for structural code analysis, including LangGraph workflows.',
  schema: z.object({
    path: z.string().describe('Path to JS/TS file'),
    maxChunks: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe('Max chunks'),
  }),
  func: async ({ path, maxChunks }) => {
    try {
      const chunks = extractAstChunks(path, maxChunks);
      return (
        `AST parsed: ${chunks.length} chunks from ${path}\n` +
        JSON.stringify(chunks, null, 2)
      );
    } catch (error) {
      return `ERROR: ${(error as Error).message}`;
    }
  },
});
