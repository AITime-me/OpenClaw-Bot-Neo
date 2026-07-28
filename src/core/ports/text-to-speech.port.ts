import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
import type { MediaDerivative } from '../domain/index.js';
export interface TextToSpeechPort {
  synthesize(
    text: string,
    context: OperationContext,
  ): Promise<Result<MediaDerivative, DomainError>>;
}
