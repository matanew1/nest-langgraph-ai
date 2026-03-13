import { Global, Module } from '@nestjs/common';
import { llm } from './llm.provider';

export const LLM_CLIENT = 'LLM_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      useValue: llm,
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
