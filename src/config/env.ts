import * as dotenv from 'dotenv';
import * as Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  PORT: Joi.number().default(3000),
  GROQ_API_KEY: Joi.string().required(),
  TAVILY_API_KEY: Joi.string().required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().required(),
}).unknown(true);

interface EnvVariables {
  PORT: number;
  GROQ_API_KEY: string;
  TAVILY_API_KEY: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
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
  tavilyKey: validatedEnv.TAVILY_API_KEY,
  redisHost: validatedEnv.REDIS_HOST,
  redisPort: validatedEnv.REDIS_PORT,
};
