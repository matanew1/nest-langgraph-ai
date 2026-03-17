import * as t from '@babel/types';

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

export function extractStateGraphNodes(
  init: t.CallExpression,
  code: string,
): AstChunk[] {
  const chunks: AstChunk[] = [];
  let chain: t.Expression = init;

  // Traverse the fluent chain collecting .addNode calls
  while (
    t.isCallExpression(chain) &&
    t.isMemberExpression(chain.callee) &&
    t.isIdentifier(chain.callee.property) &&
    chain.callee.property.name === 'addNode'
  ) {
    const arg = chain.arguments[0];
    let nodeName = 'unknown';
    if (t.isMemberExpression(arg) && t.isIdentifier(arg.property)) {
      nodeName = arg.property.name;
    } else if (t.isIdentifier(arg)) {
      nodeName = arg.name!;
    } else if (t.isStringLiteral(arg)) {
      nodeName = arg.value;
    }
    if (chain.loc && chain.loc.start && chain.loc.end) {
      const snippet = code.slice(chain.start!, chain.end!);
      chunks.unshift({
        chunk_id: `state_node_${chunks.length}`,
        type: 'state_node',
        name: nodeName,
        summary: `StateGraph.addNode(${nodeName})`,
        code_snippet:
          snippet.slice(0, 500) + (snippet.length > 500 ? '...' : ''),
        loc: {
          start: chain.loc.start,
          end: chain.loc.end,
        },
      });
    }
    chain = chain.callee.object;
  }

  // Validate the chain starts with new StateGraph(...)
  if (
    t.isCallExpression(chain) &&
    chain.callee.type === 'NewExpression' &&
    t.isIdentifier(chain.callee.callee) &&
    chain.callee.callee.name === 'StateGraph'
  ) {
    return chunks;
  }
  return [];
}
