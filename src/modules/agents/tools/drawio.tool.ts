import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { tool } from "@langchain/core/tools";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";

import { invokeLlm } from "@llm/llm.provider";
import { sandboxPath } from "@utils/path.util";

const logger = new Logger("DrawioTool");
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `
You are an expert system architect and professional draw.io diagram designer.

Your job:
Convert a natural language description into a high-quality draw.io XML diagram.

OUTPUT RULES:
- Output ONLY valid draw.io XML
- Never output explanations
- Never output markdown
- Never output code fences
- The root element MUST be <mxGraphModel>

LAYOUT & DESIGN:
- Automatically detect diagram type: Flowchart, System Architecture, Microservices, Sequence, ERD, Network, State Machine, Data Pipeline, Agent Architecture
- Horizontal flow → width 160, gap 80
- Vertical flow → height 60, gap 60
- Start nodes: ellipse;fillColor=#77DD77;strokeColor=#000000;fontColor=#ffffff;
- Process nodes: rounded=1;fillColor=#77AADD;strokeColor=#000000;fontColor=#ffffff;
- Decision nodes: rhombus;fillColor=#E65100;strokeColor=#000000;fontColor=#ffffff;
- Error nodes: ellipse;fillColor=#FF7777;strokeColor=#000000;fontColor=#ffffff;
- Edges: edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#37474F;endArrow=block;
- Multi-point or curved edges must use <Array as="points"><mxPoint x="…" y="…"/></Array>
- Add meaningful labels for transitions: success, failure, retry, timeout
- Unique integer id for every cell, vertices must contain mxGeometry, edges must contain mxGeometry relative="1"
`;

function cleanXml(raw: string): string {
  return raw.replace(/^```(?:xml)?/i, "").replace(/```$/, "").trim();
}

function validateXml(xml: string): boolean {
  try {
    const parser = new XMLParser();
    parser.parse(xml);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures all multi-point edges use <Array as="points"> format.
 */
function fixEdgePoints(xml: string): string {
  return xml.replace(
    /<mxGeometryPoints>([\s\S]*?)<\/mxGeometryPoints>/g,
    (_match, points) => {
      const pointMatches = [...points.matchAll(/<mxPoint\s+x="(\d+)"\s+y="(\d+)"\s*\/>/g)];
      const pointsXml = pointMatches
        .map((m) => `<mxPoint x="${m[1]}" y="${m[2]}"/>`)
        .join("");
      return `<Array as="points">${pointsXml}</Array>`;
    }
  );
}

async function generateDiagramXml(description: string): Promise<string> {
  const prompt = `${SYSTEM_PROMPT}\n\nDiagram description:\n${description}`;
  let lastOutput = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.log(`LLM attempt ${attempt}`);
    const raw = await invokeLlm(prompt);
    let xml = cleanXml(raw);
    xml = fixEdgePoints(xml);

    lastOutput = xml;

    if (!xml.startsWith("<mxGraphModel")) {
      logger.warn("LLM output missing <mxGraphModel>");
      continue;
    }

    if (!validateXml(xml)) {
      logger.warn("Generated XML failed validation");
      continue;
    }

    return xml;
  }

  throw new Error(
    `Failed to generate valid draw.io XML after ${MAX_RETRIES} attempts.\nPreview:\n${lastOutput.slice(
      0,
      200
    )}`
  );
}

export const drawioTool = tool(
  async ({ description, path }) => {
    logger.log(`Generating diagram → ${path}`);
    logger.log(`Description: ${description}`);

    try {
      const xml = await generateDiagramXml(description);

      const resolved = sandboxPath(path);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, xml, "utf-8");

      logger.log(`Diagram saved → ${resolved}`);
      return `draw.io diagram saved to ${resolved} (${xml.length} bytes)`;
    } catch (err) {
      logger.error(`Diagram generation failed`, err as Error);
      return `ERROR: ${(err as Error).message}`;
    }
  },
  {
    name: "drawio_generate",
    description:
      "Generate a professional draw.io diagram from a natural-language description. Supports architecture diagrams, flowcharts, ER diagrams, sequence diagrams, network diagrams, and system designs.",
    schema: z.object({
      description: z.string().describe("Natural-language description of the diagram to generate."),
      path: z
        .string()
        .describe('Output file path such as "diagrams/system-architecture.drawio"'),
    }),
  }
);