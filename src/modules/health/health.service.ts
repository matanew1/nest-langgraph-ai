import { Injectable, Logger } from '@nestjs/common';
import { redis } from '@redis/redis.provider';
import { qdrantClient } from '@vector-db/qdrant.provider';
import { env } from '@config/env';
import axios from 'axios';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  async checkRedis(): Promise<string> {
    try {
      await redis.ping();
      return 'ok';
    } catch (error) {
      this.logger.warn(`Redis health check failed: ${error}`);
      return 'unavailable';
    }
  }

  async checkQdrant(): Promise<string> {
    try {
      const collections = await qdrantClient.getCollections();
      return collections ? 'ok' : 'error';
    } catch (error) {
      this.logger.warn(`Qdrant health check failed: ${error}`);
      return 'unavailable';
    }
  }

  async checkMistral(): Promise<string> {
    try {
      const response = await axios.get('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${env.mistralKey}` },
        timeout: 5000,
      });
      return response.status === 200 ? 'ok' : 'error';
    } catch (error) {
      this.logger.warn(`Mistral health check failed: ${error}`);
      return 'unavailable';
    }
  }

  async checkTavily(): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.tavily.com/search',
        { query: 'health check', api_key: env.tavilyKey },
        { timeout: 5000 },
      );
      return response.status === 200 ? 'ok' : 'error';
    } catch (error) {
      this.logger.warn(`Tavily health check failed: ${error}`);
      return 'unavailable';
    }
  }
}
