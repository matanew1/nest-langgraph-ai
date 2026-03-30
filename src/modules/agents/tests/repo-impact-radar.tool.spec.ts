import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoImpactRadarTool } from '../tools/repo-impact-radar.tool';

const mockEnv = {
  agentWorkingDir: '',
};

jest.mock('@config/env', () => ({
  get env() {
    return mockEnv;
  },
}));

describe('repoImpactRadarTool', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'repo-impact-radar-'));
    mockEnv.agentWorkingDir = workspace;

    await mkdir(join(workspace, 'src/modules/metrics'), { recursive: true });

    await writeFile(
      join(workspace, 'src/modules/metrics/metrics.service.ts'),
      'export class MetricsService { trackMetric() {} }\n',
      'utf-8',
    );
    await writeFile(
      join(workspace, 'src/modules/metrics/metrics.controller.ts'),
      'import { MetricsService } from "./metrics.service";\n',
      'utf-8',
    );
    await writeFile(
      join(workspace, 'src/modules/metrics/metrics.service.spec.ts'),
      'describe("MetricsService", () => it("tracks metrics", () => {}));\n',
      'utf-8',
    );
    await writeFile(join(workspace, 'README.md'), '# Project\n', 'utf-8');
  });

  it('surfaces likely source files and tests from the objective', async () => {
    const result = (await repoImpactRadarTool.invoke({
      objective: 'Update metrics service behavior and related tests',
      hints: ['MetricsService'],
      maxResults: 3,
      includeTests: true,
    })) as string;

    expect(result).toContain('Likely source files');
    expect(result).toContain('src/modules/metrics/metrics.service.ts');
    expect(result).toContain('Likely tests');
    expect(result).toContain('src/modules/metrics/metrics.service.spec.ts');
  });

  it('returns a safe fallback when the objective has no strong signals', async () => {
    const result = (await repoImpactRadarTool.invoke({
      objective: 'do it',
      maxResults: 3,
      includeTests: true,
    })) as string;

    expect(result).toContain('No likely files identified');
  });
});
