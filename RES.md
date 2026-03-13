## ./test/app.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});

## ./src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: env.corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Return consistent JSON error envelopes for all unhandled exceptions
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nest LangGraph AI')
    .setDescription('AI Agent API powered by LangGraph')
    .setVersion('1.0')

## ./src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './modules/health/health.module';
import { LlmModule } from './modules/llm/llm.module';
import { RedisModule } from './modules/redis/redis.module';
import { VectorModule } from './modules/vector-db/vector.module';
import { AgentsModule } from './modules/agents/agents.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),

    LlmModule,
    RedisModule,
    AgentsModule,
    HealthModule,
    VectorModule,
  ],
})
export class AppModule {}

## ./src/common/dto/error-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 500 })
  statusCode: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/agents/run' })
  path: string;

  @ApiProperty({ example: 'Internal server error' })
  message: string | object;
}

## ./src/common/filters/http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Global exception filter.
 * Catches every unhandled exception and returns a consistent JSON error envelope
 * instead of leaking internal stack traces to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    this.logger.error(
      `${request.method} ${request.url} → ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json({

## ./src/common/config/env.ts
import * as dotenv from 'dotenv';
import * as Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  PORT: Joi.number().default(3000),
  GROQ_API_KEY: Joi.string().required(),
  GROQ_MODEL: Joi.string().default('meta-llama/llama-4-scout-17b-16e-instruct'),
  GROQ_TIMEOUT_MS: Joi.number().default(30_000),
  TAVILY_API_KEY: Joi.string().required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().required(),
  CORS_ORIGIN: Joi.string().default('*'),
  AGENT_MAX_ITERATIONS: Joi.number().integer().min(1).max(10).default(3),
  TOOL_TIMEOUT_MS: Joi.number().default(15_000),
  AGENT_WORKING_DIR: Joi.string().default(process.cwd()),
  CACHE_TTL_SECONDS: Joi.number().default(60),
  CRITIC_RESULT_MAX_CHARS: Joi.number().default(8_000),
  PROMPT_MAX_ATTEMPTS: Joi.number().default(5),
  QDRANT_URL: Joi.string().default('http://localhost:6333'),
  QDRANT_COLLECTION: Joi.string().default('agent_vectors'),
  QDRANT_VECTOR_SIZE: Joi.number().integer().min(1).default(1536),
}).unknown(true);

interface EnvVariables {
  PORT: number;
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  GROQ_TIMEOUT_MS: number;
  TAVILY_API_KEY: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  CORS_ORIGIN: string;
  AGENT_MAX_ITERATIONS: number;
  TOOL_TIMEOUT_MS: number;
  AGENT_WORKING_DIR: string;
  CACHE_TTL_SECONDS: number;
  CRITIC_RESULT_MAX_CHARS: number;
  PROMPT_MAX_ATTEMPTS: number;

## ./src/common/utils/path.util.ts
import { env } from '@config/env';
import { resolve } from 'node:path';

/**
 * Resolve `inputPath` and verify it sits inside `AGENT_WORKING_DIR`.
 * Throws a descriptive error if the path escapes the sandbox — this prevents
 * the LLM from accidentally (or maliciously) reading /etc/passwd, SSH keys, etc.
 *
 * @returns The resolved absolute path if it is safe.
 */
export function sandboxPath(inputPath: string): string {
  const root = resolve(env.agentWorkingDir);
  const target = resolve(inputPath);

  // A valid path must be the root itself OR start with "root/"
  if (target !== root && !target.startsWith(root + '/')) {
    throw new Error(
      `Access denied: "${inputPath}" resolves to "${target}", which is outside ` +
        `the allowed working directory "${root}". ` +
        `Set AGENT_WORKING_DIR to expand the sandbox.`,
    );
  }

  return target;
}

## ./src/common/utils/json.util.ts
/**
 * Replace literal newlines inside JSON string values with their escape sequences.
 * LLMs frequently return JSON with unescaped newlines in string values,
 * which makes the JSON invalid for JSON.parse.
 */
function sanitizeJsonNewlines(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
    match.replace(/\n/g, '\\n').replace(/\r/g, '\\r'),
  );
}

function tryParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Attempt to extract a JSON object from a string that may contain
 * surrounding prose, markdown fences, or literal newlines inside string values.
 */
export function extractJson<T>(raw: string): T {
  // 1. Try plain parse first (fastest path)
  let result = tryParse<T>(raw);
  if (result !== undefined) return result;

  // 2. Fix literal newlines in JSON string values (common LLM issue)
  result = tryParse<T>(sanitizeJsonNewlines(raw));
  if (result !== undefined) return result;

  // 3. Strip markdown code fences and try again
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const content = fenceMatch[1].trim();
    result = tryParse<T>(content) ?? tryParse<T>(sanitizeJsonNewlines(content));
    if (result !== undefined) return result;
  }


## ./src/modules/llm/llm.provider.ts
import { ChatGroq } from '@langchain/groq';
import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('LlmProvider');

export const llm = new ChatGroq({
  apiKey: env.groqKey,
  model: env.groqModel,
  temperature: 0,
});

/**
 * Invoke the LLM with a hard timeout.
 * Throws an Error if the call takes longer than `timeoutMs` milliseconds,
 * preventing the agent graph from hanging indefinitely on network issues.
 */
export async function invokeLlm(
  prompt: string,
  timeoutMs: number = env.groqTimeoutMs,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await llm.invoke(prompt, { signal: controller.signal });
    return res.content as string;
  } catch (err) {
    if (controller.signal.aborted) {
      logger.error(`LLM call timed out after ${timeoutMs}ms`);
      throw new Error(`LLM call timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

## ./src/modules/llm/llm.module.ts
import { Global, Module } from '@nestjs/common';
import { llm } from './llm.provider';

export const LLM_CLIENT = 'LLM_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      useValue: llm,
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}

## ./src/modules/redis/redis.module.ts
import { Global, Module, OnModuleInit } from '@nestjs/common';
import { redis } from './redis.provider';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

export { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useValue: redis,
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnModuleInit {
  async onModuleInit() {
    await redis.connect();
  }
}

## ./src/modules/redis/redis.provider.ts
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('RedisProvider');

export const redis = new Redis({
  host: env.redisHost,
  port: env.redisPort,
  // Don't establish the connection immediately — connect only on first use
  lazyConnect: true,
  // Exponential backoff: 200ms, 400ms, 800ms then give up
  retryStrategy: (times) => {
    if (times > 3) {
      logger.error('Redis max reconnect attempts reached — giving up');
      return null;
    }
    return Math.min(times * 200, 800);
  },
});

redis.on('connect', () => logger.log('Redis connected'));
redis.on('ready', () => logger.log('Redis ready'));
redis.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
redis.on('close', () => logger.warn('Redis connection closed'));
redis.on('reconnecting', () => logger.warn('Redis reconnecting…'));

## ./src/modules/redis/redis.constants.ts
export const REDIS_CLIENT = 'REDIS_CLIENT';

## ./src/modules/redis/redis.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Failed to parse JSON for key "${key}"`);
      return null;
    }

## ./src/modules/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}

## ./src/modules/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { redis } from '@redis/redis.provider';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async check(): Promise<{ status: string; redis: string; timestamp: string }> {
    let redisStatus = 'ok';
    try {
      await redis.ping();
    } catch {
      redisStatus = 'unavailable';
    }

    return {
      status: 'ok',
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  }
}

## ./src/modules/agents/tools/search.tool.ts
import { tavily } from '@tavily/core';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';

const logger = new Logger('SearchTool');

const client = tavily({ apiKey: env.tavilyKey });

export const searchTool = tool(
  async ({ query }) => {
    logger.log(`Executing with query: ${query}`);
    const response = await client.search(query, { maxResults: 5 });

    if (!response.results || response.results.length === 0) {
      return 'No search results found.';
    }

    return response.results
      .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.content}`)
      .join('\n\n');
  },
  {
    name: 'search',
    description:
      'Search the web for current information, articles, documentation, and general knowledge',
    schema: z.object({
      query: z.string(),
    }),
  },
);

## ./src/modules/agents/tools/write-file.tool.ts
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('WriteFileTool');

export const writeFileTool = tool(
  async ({ path, content }) => {
    const resolved = sandboxPath(path);
    logger.log(`Writing file: ${resolved}`);

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');

    return `File written successfully: ${resolved} (${content.length} bytes)`;
  },
  {
    name: 'write_file',
    description:
      'Write or create a file on the filesystem with the given content (creates parent directories if needed)',
    schema: z.object({
      path: z.string().describe('Absolute or relative path to the file'),
      content: z.string().describe('Content to write to the file'),
    }),
  },
);

## ./src/modules/agents/tools/tree-dir.tool.ts
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('TreeDirTool');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const MAX_DEPTH = 10;

async function buildTree(
  dirPath: string,
  prefix: string,
  depth: number,
): Promise<string[]> {
  if (depth > MAX_DEPTH) return [`${prefix}… (max depth reached)`];

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return [`${prefix}[unreadable]`];
  }

  entries.sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? prefix + '    ' : prefix + '│   ';
    const fullPath = join(dirPath, name);

    let s;
    try {
      s = await stat(fullPath);
    } catch {

## ./src/modules/agents/tools/read-file.tool.ts
import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('ReadFileTool');

const MAX_SIZE = 100_000; // 100 KB limit to keep LLM context manageable

export const readFileTool = tool(
  async ({ path }) => {
    const resolved = sandboxPath(path);
    logger.log(`Reading file: ${resolved}`);

    const content = await readFile(resolved, 'utf-8');

    if (content.length > MAX_SIZE) {
      return (
        content.slice(0, MAX_SIZE) +
        `\n\n… [truncated – file is ${content.length} bytes]`
      );
    }

    return content;
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a file from the filesystem given its path',
    schema: z.object({
      path: z.string().describe('Absolute or relative path to the file'),
    }),
  },
);

## ./src/modules/agents/tools/shell-run.tool.ts
import { exec } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';

const logger = new Logger('ShellRunTool');

const MAX_OUTPUT = 50_000;

export const shellRunTool = tool(
  async ({ command }) => {
    logger.log(`Running command: ${command}`);

    return new Promise<string>((resolve) => {
      const child = exec(command, {
        cwd: env.agentWorkingDir,
        timeout: env.toolTimeoutMs,
        maxBuffer: MAX_OUTPUT,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: string) => (stdout += chunk));
      child.stderr?.on('data', (chunk: string) => (stderr += chunk));

      child.on('close', (code) => {
        const exitCode = code ?? 0;
        if (exitCode !== 0) {
          // Failure: include exit code and stderr so the agent knows what went wrong
          const err = (stderr || stdout || '(no output)').slice(0, MAX_OUTPUT);
          resolve(`ERROR (exit ${exitCode}):\n${err}`);
        } else {
          // Success: return clean stdout only — no prefix, so __PREVIOUS_RESULT__ is usable directly
          resolve((stdout || '(no output)').slice(0, MAX_OUTPUT));
        }
      });

      child.on('error', (err) => {

## ./src/modules/agents/tools/tool.registry.ts
import type { StructuredToolInterface } from '@langchain/core/tools';

class ToolRegistry {
  private readonly tools = new Map<string, StructuredToolInterface>();
  private readonly paramHints = new Map<string, string>();

  register(tool: StructuredToolInterface, paramHint?: string): void {
    this.tools.set(tool.name, tool);
    if (paramHint) this.paramHints.set(tool.name, paramHint);
  }

  get(name: string): StructuredToolInterface | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getDescriptions(): string {
    return Array.from(this.tools.values())
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');
  }

  getParamHint(name: string): string {
    return this.paramHints.get(name) ?? '';
  }

  getToolsWithParams(): string {
    return Array.from(this.tools.values())
      .map((t) => {
        const hint = this.paramHints.get(t.name);
        return `- ${t.name}: ${t.description}${hint ? `\n  params: ${hint}` : ''}`;
      })
      .join('\n');

## ./src/modules/agents/tools/llm-summarize.tool.ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { invokeLlm } from '@llm/llm.provider';
import { z } from 'zod';

/**
 * llm_summarize — feed content to the LLM and get an AI-generated analysis back.
 *
 * Use this when the plan needs to *understand*, *summarize*, or *explain* gathered
 * content rather than just copying it.  The result can then be piped into
 * write_file via __PREVIOUS_RESULT__.
 *
 * Example plan step:
 *   {"tool":"llm_summarize","input":{"content":"__PREVIOUS_RESULT__","instruction":"Summarize each TypeScript file…"}}
 */
export const llmSummarizeTool = new DynamicStructuredTool({
  name: 'llm_summarize',
  description:
    'Feed raw content to the LLM and return an AI-generated summary or analysis. ' +
    'Use when you need to summarize, explain, or transform gathered text with LLM intelligence.',
  schema: z.object({
    content: z.string().describe('The raw text content to summarize / analyse'),
    instruction: z
      .string()
      .describe(
        'What to do with the content, e.g. "Summarize each TypeScript file in 2-3 sentences"',
      ),
  }),
  func: async ({ content, instruction }): Promise<string> => {
    const prompt = `${instruction}\n\n---\n\n${content}`;
    return invokeLlm(prompt);
  },
});

## ./src/modules/agents/tools/index.ts
import { toolRegistry } from './tool.registry';
import { searchTool } from './search.tool';
import { readFileTool } from './read-file.tool';
import { writeFileTool } from './write-file.tool';
import { listDirTool } from './list-dir.tool';
import { treeDirTool } from './tree-dir.tool';
import { shellRunTool } from './shell-run.tool';
import { llmSummarizeTool } from './llm-summarize.tool';

// Param hints tell the LLM what JSON shape each tool expects so it can
// produce correctly-structured params in the supervisor/planner responses.
toolRegistry.register(searchTool, '{"query":"<search query string>"}');
toolRegistry.register(
  readFileTool,
  '{"path":"<absolute or relative file path>"}',
);
toolRegistry.register(
  writeFileTool,
  '{"path":"<file path>","content":"<full file content to write>"}',
);
toolRegistry.register(
  listDirTool,
  '{"path":"<absolute or relative directory path>"}',
);
toolRegistry.register(
  treeDirTool,
  '{"path":"<absolute or relative root directory path>"}',
);
toolRegistry.register(shellRunTool, '{"command":"<shell command to execute>"}');
toolRegistry.register(
  llmSummarizeTool,
  '{"content":"<text to analyse>","instruction":"<what to do with it>"}',
);

export { toolRegistry };

## ./src/modules/agents/tools/list-dir.tool.ts
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('ListDirTool');

export const listDirTool = tool(
  async ({ path }) => {
    const resolved = sandboxPath(path);
    logger.log(`Listing directory: ${resolved}`);

    const entries = await readdir(resolved);
    if (entries.length === 0) return 'Directory is empty.';

    // Stat all entries in parallel instead of sequentially
    const stats = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(resolved, entry);
        const s = await stat(fullPath);
        return {
          entry,
          type: s.isDirectory() ? 'dir' : 'file',
          size: s.isFile() ? s.size : null,
        };
      }),
    );

    return stats
      .map(
        ({ entry, type, size }) =>
          `[${type}] ${entry}${size !== null ? ` (${size} bytes)` : ''}`,
      )
      .join('\n');
  },
  {
    name: 'list_dir',
    description:

## ./src/modules/agents/nodes/execution.node.ts
import { Logger } from '@nestjs/common';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/index';
import { env } from '@config/env';

const logger = new Logger('ExecutionNode');

const ATTEMPT_PREVIEW_LENGTH = 300;

export async function executionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const toolName = state.selectedTool ?? '';
  const rawParams: Record<string, unknown> = state.toolParams ?? {
    query: state.toolInput ?? '',
  };

  // Substitute __PREVIOUS_RESULT__ placeholders with actual previous tool result
  const toolParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (value === '__PREVIOUS_RESULT__' && state.toolResult) {
      toolParams[key] = state.toolResult;
    } else {
      toolParams[key] = value;
    }
  }

  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logger.log(
    `Executing step ${stepNum}/${totalSteps}: tool="${toolName}" with params=${JSON.stringify(rawParams).slice(0, 200)}`,
  );

  const tool = toolRegistry.get(toolName);

  if (!tool) {
    const errorMsg = `Unknown tool "${toolName}". Available: ${toolRegistry.getNames().join(', ')}`;
    logger.warn(errorMsg);
    return {

## ./src/modules/agents/nodes/supervisor.node.ts
import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { extractJson } from '@utils/json.util';
import { buildSupervisorPrompt } from '../prompts/agent.prompts';
import { AgentState } from '../state/agent.state';

const logger = new Logger('SupervisorNode');

interface SupervisorDecision {
  status: string;
  task?: string;
  message?: string;
  suggestion?: string;
}

export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(`Received input: "${state.input}"`);

  const prompt = buildSupervisorPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  const iteration = (state.iteration ?? 0) + 1;

  try {
    const decision = extractJson<SupervisorDecision>(raw);

    if (decision.status === 'error') {
      logger.warn(`Task unsupported — ${decision.message}`);
      return {
        status: 'error',
        done: true,
        finalAnswer:
          decision.message ??
          'Task cannot be completed with available tools.',
        iteration,
      };

## ./src/modules/agents/nodes/critic.node.ts
import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { buildCriticPrompt } from '../prompts/agent.prompts';
import { extractJson } from '@utils/json.util';
import { AgentState } from '../state/agent.state';

const logger = new Logger('CriticNode');

interface CriticDecision {
  status: string;
  reason?: string;
  suggested_fix?: string;
  confidence?: number;
  summary?: string;
  message?: string;
}

export async function criticNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logger.log(
    `Evaluating step ${stepNum}/${totalSteps} for: "${state.input}"`,
  );

  const prompt = buildCriticPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  try {
    const decision = extractJson<CriticDecision>(raw);

    logger.log(`Decision → status="${decision.status}"`);

    if (decision.status === 'complete') {
      return {
        status: 'complete',

## ./src/modules/agents/nodes/planner.node.ts
import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { extractJson } from '@utils/json.util';
import { buildPlannerPrompt } from '../prompts/agent.prompts';
import { AgentState, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools';

const logger = new Logger('PlannerNode');

interface PlanDecision {
  objective: string;
  steps: PlanStep[];
  expected_result: string;
}

export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(`Planning for: "${state.executionPlan ?? state.input}"`);

  const prompt = buildPlannerPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  try {
    const plan = extractJson<PlanDecision>(raw);

    // Validate plan structure
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      logger.error('Planner returned empty or invalid steps');
      return {
        status: 'error',
        done: true,
        finalAnswer: 'Failed to create an execution plan.',
      };
    }

    // Validate all referenced tools exist
    for (const step of plan.steps) {

## ./src/modules/agents/graph/agent.graph.ts
import { START, END, StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation } from '../state/agent.state';
import { supervisorNode } from '../nodes/supervisor.node';
import { plannerNode } from '../nodes/planner.node';
import { executionNode } from '../nodes/execution.node';
import { criticNode } from '../nodes/critic.node';
import { env } from '@config/env';

const MAX_ITERATIONS = env.agentMaxIterations;

enum Nodes {
  SUPERVISOR = 'supervisor',
  PLANNER = 'planner',
  EXECUTE = 'execute',
  CRITIC = 'critic',
}

/**
 * Graph flow:
 *
 *   START → SUPERVISOR → PLANNER → EXECUTE → CRITIC
 *                ↑         ↑                    |
 *                |         └────────────────────┘  (next step in plan)
 *                └──────────────────────────────┘  (retry / re-plan)
 *                                               → END (complete / error / max iterations)
 */
const graph = new StateGraph(AgentStateAnnotation)
  .addNode(Nodes.SUPERVISOR, supervisorNode)
  .addNode(Nodes.PLANNER, plannerNode)
  .addNode(Nodes.EXECUTE, executionNode)
  .addNode(Nodes.CRITIC, criticNode)
  .addEdge(START, Nodes.SUPERVISOR)
  .addConditionalEdges(Nodes.SUPERVISOR, (state) => {
    if (state.done) return END;
    return Nodes.PLANNER;
  })
  .addConditionalEdges(Nodes.PLANNER, (state) => {
    if (state.done) return END;
    return Nodes.EXECUTE;
  })

## ./src/modules/agents/tests/agents.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AgentsService } from '../agents.service';

jest.mock('@config/env', () => ({
  env: {
    cacheTtlSeconds: 60,
    redisHost: 'localhost',
    redisPort: 6379,
  },
}));

jest.mock('@redis/redis.provider', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('@graph/agent.graph', () => ({
  agentGraph: {
    invoke: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { agentGraph } = require('@graph/agent.graph') as {
  agentGraph: { invoke: jest.Mock };
};

describe('AgentsService', () => {
  let service: AgentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentsService],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });


## ./src/modules/agents/tests/agents.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentsController } from '../agents.controller';
import { AgentsService } from '../agents.service';

jest.mock('@config/env', () => ({
  env: {
    cacheTtlSeconds: 60,
    redisHost: 'localhost',
    redisPort: 6379,
  },
}));

jest.mock('@redis/redis.provider', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('@graph/agent.graph', () => ({
  agentGraph: {
    invoke: jest.fn(),
    stream: jest.fn(),
  },
}));

describe('AgentsController', () => {
  let controller: AgentsController;

  const mockAgentsService = {
    run: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: AgentsService, useValue: mockAgentsService }],
    })
      .overrideGuard(ThrottlerGuard)

## ./src/modules/agents/state/agent.state.ts
import { Annotation } from '@langchain/langgraph';

export interface PlanStep {
  step_id: number;
  description: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface Attempt {
  tool: string;
  /** JSON-stringified params for display/logging in prompts */
  input: string;
  /** Structured params that were passed to tool.invoke() */
  params?: Record<string, unknown>;
  result: string;
  error: boolean;
}

export const AgentStateAnnotation = Annotation.Root({
  /** Original user request */
  input: Annotation<string>,
  /** Multi-step execution plan created by the planner */
  plan: Annotation<PlanStep[]>({
    reducer: (_, curr) => curr,
    default: () => [],
  }),
  /** Index of the current step being executed (0-based) */
  currentStep: Annotation<number>({
    reducer: (_, curr) => curr,
    default: () => 0,
  }),
  /** Workflow status: idle | plan_required | running | complete | retry | error */
  status: Annotation<string>({
    reducer: (_, curr) => curr,
    default: () => 'idle',
  }),
  /** What success looks like for this plan (set by planner) */
  expectedResult: Annotation<string | undefined>,
  /** Name of the tool selected for the current step */

## ./src/modules/agents/agents.dto.ts
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RunAgentDto {
  @ApiProperty({
    description: 'The prompt to send to the AI agent',
    example: 'Search for NestJS best practices',
    minLength: 1,
    maxLength: 4000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(4000)
  prompt: string;
}

export class RunAgentResponseDto {
  @ApiProperty({
    description: 'The result returned by the AI agent',
    example: 'Here are some best practices for NestJS: ...',
  })
  result: string;
}

## ./src/modules/agents/agents.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { redis } from '@redis/redis.provider';
import { env } from '@config/env';
import { agentGraph } from './graph/agent.graph';
import { AgentState } from './state/agent.state';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  private cacheKey(prompt: string): string {
    return `agent:cache:${createHash('sha256').update(prompt).digest('hex')}`;
  }

  async *stream(
    prompt: string,
  ): AsyncGenerator<{ node: string; data: unknown }> {
    this.logger.log(
      `Streaming agent for: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`,
    );
    try {
      const streamResult = await agentGraph.stream({
        input: prompt,
        iteration: 0,
      } as Partial<AgentState>);

      for await (const chunk of streamResult) {
        for (const [node, data] of Object.entries(chunk)) {
          yield { node, data };
        }
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);

## ./src/modules/agents/agents.module.ts
import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';

@Module({
  providers: [AgentsService],
  controllers: [AgentsController],
  exports: [AgentsService],
})
export class AgentsModule {}

## ./src/modules/agents/prompts/agent.prompts.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '@config/env';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/tool.registry';

/* ------------------------------------------------------------------ */
/*  Template loader                                                     */
/* ------------------------------------------------------------------ */

const TEMPLATES_DIR = join(__dirname, 'templates');

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.txt`), 'utf-8');
}

// Load once at module initialisation — fast, synchronous, cached in memory
const templates = {
  supervisor: loadTemplate('supervisor'),
  planner: loadTemplate('planner'),
  critic: loadTemplate('critic'),
};

/**
 * Render a template by replacing every {{key}} placeholder with the
 * corresponding value from `vars`. Unknown keys are left as-is.
 */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/* ------------------------------------------------------------------ */
/*  Shared constants injected into every template                      */
/* ------------------------------------------------------------------ */

const JSON_ONLY =
  'CRITICAL: Your entire response must be a single JSON object. Start with { and end with }. No prose, no markdown, no code fences, no explanation outside the JSON.';


## ./src/modules/agents/agents.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AgentsService } from './agents.service';
import { RunAgentDto, RunAgentResponseDto } from './agents.dto';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '@common/dto/error-response.dto';

@ApiTags('Agents')
@Controller('agents')
@UseGuards(ThrottlerGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the AI agent with a natural-language prompt' })
  @ApiBody({ type: RunAgentDto })
  @ApiResponse({
    status: 200,
    type: RunAgentResponseDto,
    description: 'Agent answer',
  })
  @ApiResponse({
    status: 400,
    type: ErrorResponseDto,
    description: 'Invalid request body',
  })
  @ApiResponse({
    status: 429,
    type: ErrorResponseDto,
    description: 'Too many requests',

## ./src/modules/vector-db/vector.constants.ts
export const QDRANT_CLIENT = 'QDRANT_CLIENT';

## ./src/modules/vector-db/vector.service.ts
import { Inject, Injectable } from '@nestjs/common';
import type { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import { env } from '@config/env';
import { QDRANT_CLIENT } from './vector.constants';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class VectorService {
  constructor(
    @Inject(QDRANT_CLIENT) private readonly client: QdrantClient,
  ) {}

  async upsert(
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.client.upsert(env.qdrantCollection, {
      wait: true,
      points: [{ id, vector, payload: metadata }],
    });
  }

  async search(
    queryVector: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    const results = await this.client.search(env.qdrantCollection, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
    });

    return results.map((hit: Schemas['ScoredPoint']) => ({
      id: String(hit.id),

## ./src/modules/vector-db/qdrant.provider.ts
import { Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '@config/env';

const logger = new Logger('QdrantProvider');

export const qdrantClient = new QdrantClient({ url: env.qdrantUrl });

export async function connectQdrant(): Promise<void> {
  const collections = await qdrantClient.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === env.qdrantCollection,
  );

  if (!exists) {
    await qdrantClient.createCollection(env.qdrantCollection, {
      vectors: { size: env.qdrantVectorSize, distance: 'Cosine' },
    });
    logger.log(
      `Qdrant connected — collection '${env.qdrantCollection}' created (size=${env.qdrantVectorSize})`,
    );
  } else {
    logger.log(
      `Qdrant connected — collection '${env.qdrantCollection}' ready`,
    );
  }
}

## ./src/modules/vector-db/embedding.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class EmbeddingService {
  /**
   * Convert text into a numeric embedding vector.
   * TODO: integrate with an embedding model (e.g. Groq, OpenAI, HuggingFace).
   */
  async embed(_text: string): Promise<number[]> {
    throw new Error('EmbeddingService.embed() not yet implemented');
  }

  /**
   * Compute cosine similarity between two vectors.
   * Returns a value in [-1, 1]; higher means more similar.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return magA && magB ? dot / (magA * magB) : 0;
  }
}

## ./src/modules/vector-db/vector.module.ts
import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { VectorService } from './vector.service';
import { EmbeddingService } from './embedding.service';
import { qdrantClient, connectQdrant } from './qdrant.provider';
import { QDRANT_CLIENT } from './vector.constants';

export { QDRANT_CLIENT } from './vector.constants';

@Module({
  providers: [
    { provide: QDRANT_CLIENT, useValue: qdrantClient },
    VectorService,
    EmbeddingService,
  ],
  exports: [QDRANT_CLIENT, VectorService, EmbeddingService],
})
export class VectorModule implements OnModuleInit {
  private readonly logger = new Logger(VectorModule.name);

  async onModuleInit() {
    try {
      await connectQdrant();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Qdrant connection failed: ${message}`);
    }
  }
}

