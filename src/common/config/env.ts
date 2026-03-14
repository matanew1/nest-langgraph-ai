import * as dotenv from 'dotenv';
import * as Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  PORT: Joi.number().default(3000),
  GROQ_API_KEY: Joi.string().required(),
  GROQ_MODEL: Joi.string().default('llama-3.3-70b-versatile'),
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
  PROMPT_MAX_SUMMARY_CHARS: Joi.number().default(2000),
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
  PROMPT_MAX_SUMMARY_CHARS: number;
  QDRANT_URL: string;
  QDRANT_COLLECTION: string;
  QDRANT_VECTOR_SIZE: number;
}

const { error, value: validatedEnv } = envSchema.validate(process.env) as {
  error: Joi.ValidationError | undefined;
  value: EnvVariables;
};

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = {
  port: validatedEnv.PORT,
  groqKey: validatedEnv.GROQ_API_KEY,
  groqModel: validatedEnv.GROQ_MODEL,
  groqTimeoutMs: validatedEnv.GROQ_TIMEOUT_MS,
  tavilyKey: validatedEnv.TAVILY_API_KEY,
  redisHost: validatedEnv.REDIS_HOST,
  redisPort: validatedEnv.REDIS_PORT,
  corsOrigin: validatedEnv.CORS_ORIGIN,
  agentMaxIterations: validatedEnv.AGENT_MAX_ITERATIONS,
  toolTimeoutMs: validatedEnv.TOOL_TIMEOUT_MS,
  agentWorkingDir: validatedEnv.AGENT_WORKING_DIR,
  cacheTtlSeconds: validatedEnv.CACHE_TTL_SECONDS,
  criticResultMaxChars: validatedEnv.CRITIC_RESULT_MAX_CHARS,
  promptMaxAttempts: validatedEnv.PROMPT_MAX_ATTEMPTS,
  promptMaxSummaryChars: validatedEnv.PROMPT_MAX_SUMMARY_CHARS,
  qdrantUrl: validatedEnv.QDRANT_URL,
  qdrantCollection: validatedEnv.QDRANT_COLLECTION,
  qdrantVectorSize: validatedEnv.QDRANT_VECTOR_SIZE,
};
