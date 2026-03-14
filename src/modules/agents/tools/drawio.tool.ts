import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('DrawioTool');

const SYSTEM_PROMPT = `You are a professional draw.io diagram designer. Output ONLY valid draw.io XML — no explanation, no markdown fences, no extra text.

═══════════════════════════════════════════
MODERN DESIGN SYSTEM — follow exactly
═══════════════════════════════════════════

## COLOR PALETTE (hex only, never CSS names)
Start/End nodes:   fillColor=#1B5E20;strokeColor=#1B5E20;gradientColor=#43A047;fontColor=#ffffff;
Process nodes:     fillColor=#0D47A1;strokeColor=#0D47A1;gradientColor=#1E88E5;fontColor=#ffffff;
Decision nodes:    fillColor=#E65100;strokeColor=#E65100;gradientColor=#FB8C00;fontColor=#ffffff;
Error/End nodes:   fillColor=#B71C1C;strokeColor=#B71C1C;gradientColor=#E53935;fontColor=#ffffff;
Retry/Warning:     fillColor=#4A148C;strokeColor=#4A148C;gradientColor=#7B1FA2;fontColor=#ffffff;
Neutral/Info:      fillColor=#263238;strokeColor=#263238;gradientColor=#455A64;fontColor=#ffffff;

## SHAPE STYLES
Start/End (terminal):
  style="ellipse;whiteSpace=wrap;html=1;shadow=1;fontSize=13;fontStyle=1;arcSize=50;fillColor=#1B5E20;strokeColor=#1B5E20;gradientColor=#43A047;gradientDirection=north;fontColor=#ffffff;"
  size: width=140 height=60

Process (rectangle):
  style="rounded=1;whiteSpace=wrap;html=1;shadow=1;fontSize=13;fontStyle=1;arcSize=8;fillColor=#0D47A1;strokeColor=#0D47A1;gradientColor=#1E88E5;gradientDirection=north;fontColor=#ffffff;"
  size: width=160 height=60

Decision (diamond):
  style="rhombus;whiteSpace=wrap;html=1;shadow=1;fontSize=12;fontStyle=1;fillColor=#E65100;strokeColor=#E65100;gradientColor=#FB8C00;gradientDirection=north;fontColor=#ffffff;"
  size: width=160 height=80

Section header / swimlane label:
  style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;fontSize=15;fontStyle=1;fontColor=#212121;"

## EDGE STYLES
Main flow arrow:
  style="edgeStyle=orthogonalEdgeStyle;html=1;rounded=1;orthogonalLoop=1;jettySize=auto;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#37474F;strokeWidth=2;endArrow=block;endFill=1;"

Dashed/retry arrow:
  style="edgeStyle=orthogonalEdgeStyle;html=1;rounded=1;orthogonalLoop=1;jettySize=auto;dashed=1;strokeColor=#7B1FA2;strokeWidth=2;endArrow=open;endFill=0;fontColor=#7B1FA2;fontSize=11;fontStyle=2;"

Curved arrow (for back-routes or loops):
  style="edgeStyle=elbowEdgeStyle;elbow=vertical;html=1;rounded=1;dashed=1;strokeColor=#C62828;strokeWidth=2;endArrow=block;endFill=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;"

## LAYOUT RULES
- Horizontal flow: node width=160, gap between nodes=80px (next x = prev_x + 160 + 80 = +240)
- Vertical flow: node height=60, gap=60px (next y = prev_y + 60 + 60 = +120)
- Start the first node at x=60, y=200 for horizontal; x=400, y=60 for vertical
- Add edge labels (value="label text") on important transitions
- Minimum canvas: space nodes so nothing overlaps

## STRUCTURE RULES
- mxGraphModel attributes: dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="1"
- First two cells ALWAYS:
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
- All vertex cells: vertex="1" parent="1" — include <mxGeometry x y width height as="geometry" />
- All edge cells: edge="1" parent="1" source="id" target="id" — include <mxGeometry relative="1" as="geometry" />
- Unique integer id for every cell, starting at 2

═══════════════════════════════════════════
FULL VALID EXAMPLE (copy this pattern):
═══════════════════════════════════════════
<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="1">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="2" value="START" style="ellipse;whiteSpace=wrap;html=1;shadow=1;fontSize=13;fontStyle=1;arcSize=50;fillColor=#1B5E20;strokeColor=#1B5E20;gradientColor=#43A047;gradientDirection=north;fontColor=#ffffff;" vertex="1" parent="1">
      <mxGeometry x="60" y="200" width="140" height="60" as="geometry" />
    </mxCell>
    <mxCell id="3" value="Process A" style="rounded=1;whiteSpace=wrap;html=1;shadow=1;fontSize=13;fontStyle=1;arcSize=8;fillColor=#0D47A1;strokeColor=#0D47A1;gradientColor=#1E88E5;gradientDirection=north;fontColor=#ffffff;" vertex="1" parent="1">
      <mxGeometry x="300" y="200" width="160" height="60" as="geometry" />
    </mxCell>
    <mxCell id="4" value="END" style="ellipse;whiteSpace=wrap;html=1;shadow=1;fontSize=13;fontStyle=1;arcSize=50;fillColor=#B71C1C;strokeColor=#B71C1C;gradientColor=#E53935;gradientDirection=north;fontColor=#ffffff;" vertex="1" parent="1">
      <mxGeometry x="540" y="200" width="140" height="60" as="geometry" />
    </mxCell>
    <mxCell id="5" value="" style="edgeStyle=orthogonalEdgeStyle;html=1;rounded=1;orthogonalLoop=1;jettySize=auto;strokeColor=#37474F;strokeWidth=2;endArrow=block;endFill=1;" edge="1" source="2" target="3" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="6" value="complete" style="edgeStyle=orthogonalEdgeStyle;html=1;rounded=1;orthogonalLoop=1;jettySize=auto;strokeColor=#37474F;strokeWidth=2;endArrow=block;endFill=1;fontColor=#37474F;fontSize=11;fontStyle=2;" edge="1" source="3" target="4" parent="1">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>`;

export const drawioTool = tool(
  async ({ description, path }) => {
    logger.log(`Generating draw.io diagram: "${description}" → ${path}`);

    const prompt = `${SYSTEM_PROMPT}\n\nDiagram description:\n${description}`;
    const xml = (await invokeLlm(prompt)).trim();

    // Strip accidental markdown fences if the LLM adds them
    const clean = xml
      .replace(/^```(?:xml)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    if (!clean.startsWith('<mxGraphModel')) {
      return `ERROR: LLM did not return valid draw.io XML. Got: ${clean.slice(0, 200)}`;
    }

    const resolved = sandboxPath(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, clean, 'utf-8');

    logger.log(`Diagram written: ${resolved}`);
    return `draw.io diagram saved to ${resolved} (${clean.length} bytes)`;
  },
  {
    name: 'drawio_generate',
    description:
      'Generate a draw.io (.drawio / .xml) diagram from a natural-language description and save it to a file. ' +
      'Useful for architecture diagrams, flowcharts, sequence diagrams, and ER diagrams.',
    schema: z.object({
      description: z
        .string()
        .describe(
          'Natural-language description of the diagram to generate, e.g. "flowchart showing user login flow with success and failure paths"',
        ),
      path: z
        .string()
        .describe('Output file path, e.g. "diagrams/architecture.drawio"'),
    }),
  },
);
