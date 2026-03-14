import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

/**
 * Bootstraps the NestJS application, setting up middleware, global pipes,
 * exception filters, and Swagger documentation.
 *
 * @async
 * @function bootstrap
 * @returns {Promise<void>} A promise that resolves when the application is successfully bootstrapped and listening.
 */
async function bootstrap() {
  /**
   * The NestJS application instance.
   * @type {import('@nestjs/core').INestApplication}
   */
  const app = await NestFactory.create(AppModule);

  /**
   * Logger instance for the bootstrap process.
   * @type {Logger}
   */
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

  /**
   * Configuration for Swagger documentation.
   * @type {import('@nestjs/swagger').DocumentBuilder}
   */
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

  await app.listen(env.port);
  logger.log(`Application running on http://localhost:${env.port}`);
  logger.log(`Swagger docs at http://localhost:${env.port}/docs`);
}

void bootstrap();