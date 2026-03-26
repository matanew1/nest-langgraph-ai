import 'module-alias/register'; // Register path aliases for compiled JS
import './extensions/extensions'; // This executes the prototype assignments
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { ApiKeyGuard } from './common/guards/api-key.guard';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(__dirname, '..', 'public'));
  const logger = new Logger('Bootstrap');

  // Increase JSON body limit to support base64-encoded image uploads (up to ~15 MB decoded)
  app.use(require('express').json({ limit: '20mb' }));

  // Security: Helmet helps secure Express apps by setting various HTTP headers
  app.use(helmet());

  // Performance: Compression middleware for response bodies
  app.use(compression());

  // Security: Restrict CORS in production
  if (env.nodeEnv === 'production' && env.corsOrigin === '*') {
    logger.warn(
      'WARNING: CORS_ORIGIN is set to wildcard (*) in production. ' +
        'Set CORS_ORIGIN to a comma-separated list of allowed origins.',
    );
  }
  const corsOrigin =
    env.corsOrigin === '*'
      ? true
      : env.corsOrigin.split(',').map((origin) => origin.trim());

  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/*path', method: RequestMethod.ALL },
    ],
  });

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

  // API key authentication (skipped if API_KEY env var is not set)
  app.useGlobalGuards(new ApiKeyGuard());

  // Apply the logging interceptor to all routes
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Dynamic timeout based on LLM timeout × max iterations × 4 LLM calls per iteration + buffer
  const globalTimeoutMs =
    env.mistralTimeoutMs * env.agentMaxIterations * 4 + 10_000;
  app.useGlobalInterceptors(new TimeoutInterceptor(globalTimeoutMs));

  // Swagger Documentation (Disable in production if needed)
  if (env.nodeEnv !== 'production' || env.enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('LangGraph AI Agent API')
      .setDescription(
        `## Overview\n` +
        `A stateful multi-agent API built with **NestJS** and **LangGraph**. Agents execute multi-step reasoning pipelines backed by **Redis** checkpointing and **Qdrant** vector memory.\n\n` +
        `## Key capabilities\n` +
        `- **Conversations** — run or stream an agent response in real time via Server-Sent Events\n` +
        `- **Sessions** — inspect, manage, and delete persistent session state stored in Redis\n` +
        `- **Plan Review** — pause execution at the planning stage for human approval before the agent acts\n` +
        `- **Memory** — read, write, and clear per-session conversation memory\n` +
        `- **Feedback** — submit thumbs-up/down signals that adjust vector memory salience in Qdrant\n\n` +
        `## Authentication\n` +
        `Pass your API key as a **Bearer token** in the \`Authorization\` header, or via the \`x-api-key\` header. Authentication is disabled when \`API_KEY\` is not set (development mode).`,
      )
      .setVersion('1.0')
      .setContact('Matan Bardugo', '', '')
      .setLicense('MIT', '')
      .addServer('http://localhost:3000', 'Local development')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'API Key' },
        'api-key',
      )
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key-header')
      .build();

    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig, { autoTagControllers: false }),
      {
        customSiteTitle: 'LangGraph AI — API Docs',
        swaggerOptions: {
          persistAuthorization: true, // Keep the auth token for subsequent requests
          tagsSorter: 'alpha', // Sort tags
          operationsSorter: 'alpha', // Sort operations
          filter: true, // Enable filtering
          tryItOutEnabled: true, // Enable Try It Out
        },
      },
    );
  }

  // Graceful Shutdown
  app.enableShutdownHooks();

  await app.listen(env.port);
  logger.log(`Application running on http://localhost:${env.port}`);
  if (env.nodeEnv !== 'production' || env.enableSwagger) {
    logger.log(`Swagger docs at http://localhost:${env.port}/docs`);
  }
}

void bootstrap();
