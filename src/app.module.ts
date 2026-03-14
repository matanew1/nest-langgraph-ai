/**
 * Main application module that serves as the root module for the NestJS application.
 * It imports and configures all necessary modules for the application to function.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './modules/health/health.module';
import { LlmModule } from './modules/llm/llm.module';
import { RedisModule } from './modules/redis/redis.module';
import { AgentsModule } from './modules/agents/agents.module';

/**
 * Root module decorator that defines the metadata for the application module.
 * Configures global modules, rate limiting, and feature modules.
 */
@Module({
  /**
   * Array of modules to be imported into the application module.
   * These modules provide various functionalities to the application.
   */
  imports: [
    /**
     * Configures the global configuration module with environment variables.
     * @param {Object} ConfigModuleOptions - Configuration options for the ConfigModule
     * @param {boolean} ConfigModuleOptions.isGlobal - Makes the module available globally
     * @param {string} ConfigModuleOptions.envFilePath - Path to the environment file
     */
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    /**
     * Configures rate limiting for the application to prevent abuse.
     * @param {Object} ThrottlerModuleOptions - Configuration options for ThrottlerModule
     * @param {ThrottlerOptions[]} ThrottlerModuleOptions.throttlers - Array of throttler configurations
     */
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),

    LlmModule,
    RedisModule,
    AgentsModule,
    HealthModule,
  ],
})
/**
 * The root application module class that serves as the entry point for the NestJS application.
 */
export class AppModule {}

/**
 * @typedef {Object} ThrottlerOptions
 * @property {number} ttl - Time window in milliseconds
 * @property {number} limit - Maximum number of requests in the time window
 */

/**
 * @typedef {Object} ConfigModuleOptions
 * @property {boolean} isGlobal - Makes the module available globally
 * @property {string} envFilePath - Path to the environment file
 */

/**
 * @typedef {Object} ThrottlerModuleOptions
 * @property {ThrottlerOptions[]} throttlers - Array of throttler configurations
 */