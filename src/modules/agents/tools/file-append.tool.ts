import { readFile, writeFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('FileAppendTool');

export const fileAppendTool = tool(
  async ({ path, content: contentToAppend }) => {
    // If the LLM includes a markdown block, extract just the code.
    let finalContent = contentToAppend;
    const codeBlockMatch = contentToAppend.match(/```(?:\w*\n)?([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      logger.log('Code block found, extracting content for append operation.');
      finalContent = codeBlockMatch[1].trim();
    }

    const resolved = sandboxPath(path);
    logger.log(`Appending to "${resolved}": ${finalContent.length} chars`);

    let originalContent: string;
    try {
      originalContent = await readFile(resolved, 'utf-8');
    } catch {
      return `ERROR: file "${path}" does not exist or cannot be read.`;
    }

    const exportToken = 'export {};';
    const insertionPoint = originalContent.lastIndexOf(exportToken);

    let updatedContent: string;
    if (insertionPoint !== -1) {
      const before = originalContent.substring(0, insertionPoint);
      const after = originalContent.substring(insertionPoint);
      updatedContent = before + finalContent + '\n\n' + after;
    } else {
      updatedContent = originalContent + '\n' + finalContent;
    }

    await writeFile(resolved, updatedContent, 'utf-8');

    return `Appended to "${path}" successfully.`;
  },
  {
    name: 'file_append',
    description: 'Appends content to the end of a file, just before the final "export {}". Useful for adding new functions, classes, or other top-level constructs to a module.',
    schema: z.object({
      path: z.string().describe('Path to the file to append to.'),
      content: z.string().describe('The code content to append.'),
    }),
  },
);
