import { ChatGroq } from '@langchain/groq';
import { env } from '../../config/env';

export const llm = new ChatGroq({
  apiKey: env.groqKey,
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  temperature: 0,
});
