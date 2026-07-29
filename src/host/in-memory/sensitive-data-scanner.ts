import { err, ok, type DomainError } from '../../core/domain/index.js';
import type { SensitiveDataScannerPort } from '../../core/ports/index.js';
import {
  scanSensitiveData,
  scanSensitiveMetadata,
} from '../../core/policy/sensitive-data-scanner.js';

const scannerUnavailable: DomainError = {
  code: 'NOT_CONFIGURED',
  component: 'sensitive-data-scanner',
};

/**
 * Ephemeral local scanner adapter over the public core policy scanner.
 * Does not raise trust; maps scanner failures to domain errors.
 */
export function createInMemorySensitiveDataScanner(): SensitiveDataScannerPort {
  return {
    scanText: (input) => {
      const scanned = scanSensitiveData(input);
      return Promise.resolve(scanned.ok ? ok(scanned.value) : err<DomainError>(scannerUnavailable));
    },
    scanMetadata: (input) => {
      const scanned = scanSensitiveMetadata(input);
      return Promise.resolve(scanned.ok ? ok(scanned.value) : err<DomainError>(scannerUnavailable));
    },
  };
}
