/**
 * Re-export domain JSON DTO snapshot for policy consumers.
 * Canonical implementation lives in core/domain to allow config + policy reuse.
 */
export {
  snapshotPlainJsonDto,
  type JsonDto,
  type JsonDtoFailure,
  type JsonDtoFailureCode,
} from '../domain/json-dto-snapshot.js';
