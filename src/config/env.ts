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
};
