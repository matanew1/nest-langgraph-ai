import * as dotenv from 'dotenv';
import * as Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  PORT: Joi.number().default(3000),
  MISTRAL_API_KEY: Joi.string().required(),
  // Per-tier model overrides — each phase uses the tier that fits best
  MISTRAL_MODEL_FAST: Joi.string().default('mistral-small-latest'),
  MISTRAL_MODEL_BALANCED: Joi.string().default('mistral-small-latest'),
  MISTRAL_MODEL_POWERFUL: Joi.string().default('mistral-large-latest'),
  MISTRAL_MODEL_CODE: Joi.string().default('codestral-latest'),
  MISTRAL_TIMEOUT_MS: Joi.number().min(1000).default(30_000),
  TAVILY_API_KEY: Joi.string().required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().required(),
  CORS_ORIGIN: Joi.string().default('*'),
  AGENT_MAX_ITERATIONS: Joi.number().integer().min(1).max(10).default(3),
  AGENT_MAX_RETRIES: Joi.number().integer().min(1).max(10).default(3),
  AGENT_MAX_RETBACKS: Joi.number().integer().min(1).max(10).default(3),
  TOOL_TIMEOUT_MS: Joi.number().min(1000).default(15_000),
  HEALTH_EXTERNAL_CHECK_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .default(2_000),
  HEALTH_EXTERNAL_CACHE_TTL_MS: Joi.number().integer().min(0).default(60_000),
  AGENT_WORKING_DIR: Joi.string().default(process.cwd()),
  CACHE_TTL_SECONDS: Joi.number().default(60),
  SESSION_TTL_SECONDS: Joi.number().integer().min(1).default(86400),
  CRITIC_RESULT_MAX_CHARS: Joi.number().default(8_000),
  PROMPT_MAX_ATTEMPTS: Joi.number().default(5),
  PROMPT_MAX_SUMMARY_CHARS: Joi.number().default(2000),
  QDRANT_URL: Joi.string().default('http://localhost:6333'),
  QDRANT_COLLECTION: Joi.string().default('agent_vectors'),
  QDRANT_CHECK_COMPATIBILITY: Joi.boolean().default(false),
  // Default matches Xenova/all-MiniLM-L6-v2 embedding dimension (free, local).
  QDRANT_VECTOR_SIZE: Joi.number().integer().min(1).default(384),
  NODE_ENV: Joi.string().default('development'),
  ENABLE_SWAGGER: Joi.boolean().default(false),
  REQUIRE_PLAN_REVIEW: Joi.boolean().default(false),
  API_KEY: Joi.string().allow('').optional().default(''),
  LOG_FORMAT: Joi.string().valid('text', 'json').default('text'),
}).unknown(true);

interface EnvVariables {
  PORT: number;
  MISTRAL_API_KEY: string;
  MISTRAL_MODEL_FAST: string;
  MISTRAL_MODEL_BALANCED: string;
  MISTRAL_MODEL_POWERFUL: string;
  MISTRAL_MODEL_CODE: string;
  MISTRAL_TIMEOUT_MS: number;
  TAVILY_API_KEY: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  CORS_ORIGIN: string;
  AGENT_MAX_ITERATIONS: number;
  AGENT_MAX_RETRIES: number;
  AGENT_MAX_RETBACKS: number;
  TOOL_TIMEOUT_MS: number;
  HEALTH_EXTERNAL_CHECK_TIMEOUT_MS: number;
  HEALTH_EXTERNAL_CACHE_TTL_MS: number;
  AGENT_WORKING_DIR: string;
  CACHE_TTL_SECONDS: number;
  SESSION_TTL_SECONDS: number;
  CRITIC_RESULT_MAX_CHARS: number;
  PROMPT_MAX_ATTEMPTS: number;
  PROMPT_MAX_SUMMARY_CHARS: number;
  QDRANT_URL: string;
  QDRANT_COLLECTION: string;
  QDRANT_CHECK_COMPATIBILITY: boolean;
  QDRANT_VECTOR_SIZE: number;
  NODE_ENV: string;
  ENABLE_SWAGGER: boolean;
  REQUIRE_PLAN_REVIEW: boolean;
  API_KEY: string;
  LOG_FORMAT: string;
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
  mistralKey: validatedEnv.MISTRAL_API_KEY,
  mistralModelFast: validatedEnv.MISTRAL_MODEL_FAST,
  mistralModelBalanced: validatedEnv.MISTRAL_MODEL_BALANCED,
  mistralModelPowerful: validatedEnv.MISTRAL_MODEL_POWERFUL,
  mistralModelCode: validatedEnv.MISTRAL_MODEL_CODE,
  mistralTimeoutMs: validatedEnv.MISTRAL_TIMEOUT_MS,
  tavilyKey: validatedEnv.TAVILY_API_KEY,
  redisHost: validatedEnv.REDIS_HOST,
  redisPort: validatedEnv.REDIS_PORT,
  corsOrigin: validatedEnv.CORS_ORIGIN,
  agentMaxIterations: validatedEnv.AGENT_MAX_ITERATIONS,
  agentMaxRetries: validatedEnv.AGENT_MAX_RETRIES,
  agentMaxRetbacks: validatedEnv.AGENT_MAX_RETBACKS,
  toolTimeoutMs: validatedEnv.TOOL_TIMEOUT_MS,
  healthExternalCheckTimeoutMs: validatedEnv.HEALTH_EXTERNAL_CHECK_TIMEOUT_MS,
  healthExternalCacheTtlMs: validatedEnv.HEALTH_EXTERNAL_CACHE_TTL_MS,
  agentWorkingDir: validatedEnv.AGENT_WORKING_DIR,
  cacheTtlSeconds: validatedEnv.CACHE_TTL_SECONDS,
  sessionTtlSeconds: validatedEnv.SESSION_TTL_SECONDS,
  criticResultMaxChars: validatedEnv.CRITIC_RESULT_MAX_CHARS,
  promptMaxAttempts: validatedEnv.PROMPT_MAX_ATTEMPTS,
  promptMaxSummaryChars: validatedEnv.PROMPT_MAX_SUMMARY_CHARS,
  qdrantUrl: validatedEnv.QDRANT_URL,
  qdrantCollection: validatedEnv.QDRANT_COLLECTION,
  qdrantCheckCompatibility: validatedEnv.QDRANT_CHECK_COMPATIBILITY,
  qdrantVectorSize: validatedEnv.QDRANT_VECTOR_SIZE,
  nodeEnv: validatedEnv.NODE_ENV,
  enableSwagger: validatedEnv.ENABLE_SWAGGER,
  requirePlanReview: validatedEnv.REQUIRE_PLAN_REVIEW,
  apiKey: validatedEnv.API_KEY,
  logFormat: validatedEnv.LOG_FORMAT,
};
