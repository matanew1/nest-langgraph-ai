import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATES_DIR = join(__dirname, 'templates');

const promptTemplates = {
  supervisor: readFileSync(join(TEMPLATES_DIR, 'supervisor.txt'), 'utf-8'),
  planner: readFileSync(join(TEMPLATES_DIR, 'planner.txt'), 'utf-8'),
  critic: readFileSync(join(TEMPLATES_DIR, 'critic.txt'), 'utf-8'),
} as const;

export type PromptTemplateName = keyof typeof promptTemplates;

export function getPromptTemplate(name: PromptTemplateName): string {
  return promptTemplates[name];
}

export function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}
