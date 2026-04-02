import { isLikelyMermaid } from './mermaid.util';

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
