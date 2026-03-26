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
      .setTitle('Nest LangGraph AI')
      .setDescription('AI Agent API powered by LangGraph')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
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
