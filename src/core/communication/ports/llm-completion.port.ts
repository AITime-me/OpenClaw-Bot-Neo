import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type {
  CommunicationError,
  LlmCompletionRequest,
  LlmCompletionResult,
} from '../domain/index.js';

/** Provider-independent, tools-free completion boundary. */
export interface LlmCompletionPort {
  complete(
    request: LlmCompletionRequest,
    operationContext: OperationContext,
  ): Promise<Result<LlmCompletionResult, CommunicationError>>;
}
