import { isLikelyMermaid, sanitizeMermaid } from './mermaid.util';

describe('isLikelyMermaid', () => {
  it('accepts all known Mermaid diagram type keywords', () => {
    const validDiagrams = [
      'flowchart LR\nA --> B',
      'graph TD\nA --> B',
      'sequenceDiagram\nAlice->>Bob: Hello',
      'classDiagram\nclass Animal',
      'stateDiagram-v2\n[*] --> Active',
      'erDiagram\nCUSTOMER ||--o{ ORDER : places',
      'gantt\ntitle A Gantt Diagram',
      'pie title Pets\n"Dogs" : 386',
      'gitGraph\ncommit',
      'mindmap\nroot((mindmap))',
      'timeline\ntitle History',
      'xychart-beta\nxAxis [jan, feb]',
    ];
    for (const diagram of validDiagrams) {
      expect(isLikelyMermaid(diagram)).toBe(true);
    }
  });

  it('rejects non-Mermaid text', () => {
    expect(isLikelyMermaid('Hello world')).toBe(false);
    expect(isLikelyMermaid('const x = 1;')).toBe(false);
    expect(isLikelyMermaid('')).toBe(false);
  });

  it('returns false when only blank lines precede non-Mermaid content', () => {
    expect(isLikelyMermaid('\n\nconst x = 1;')).toBe(false);
  });
});

describe('sanitizeMermaid – classDiagram colon fixes', () => {
  it('removes colon from field type annotation (+name: Type → +name Type)', () => {
    const input = 'classDiagram\n  class Foo {\n    +imports: ConfigModule\n    -count: number\n  }';
    const result = sanitizeMermaid(input);
    expect(result).not.toContain('+imports: ConfigModule');
    expect(result).toContain('+imports ConfigModule');
    expect(result).not.toContain('-count: number');
    expect(result).toContain('-count number');
  });

  it('swaps param name and type inside method parens (+method(name: Type) → +method(Type name))', () => {
    const input = 'classDiagram\n  class AppModule {\n    +configure(consumer: MiddlewareConsumer)\n  }';
    const result = sanitizeMermaid(input);
    expect(result).not.toContain('consumer: MiddlewareConsumer');
    expect(result).toContain('configure(MiddlewareConsumer consumer)');
  });

  it('leaves flowchart node labels untouched (no false positives)', () => {
    const input = 'flowchart LR\n  A["label: value"] --> B';
    const result = sanitizeMermaid(input);
    // quoted flowchart label should be unchanged — the colon is inside quotes, not a member line
    expect(result).toContain('A["label: value"]');
  });

  it('rewrites reserved "graph -->" node id (existing behaviour preserved)', () => {
    const input = 'flowchart LR\n  graph --> B';
    expect(sanitizeMermaid(input)).toContain('G -->');
    expect(sanitizeMermaid(input)).not.toContain('graph -->');
  });
});
