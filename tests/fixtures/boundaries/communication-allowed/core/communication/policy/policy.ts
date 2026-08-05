import type { Brand } from '../../domain/identity.js';
import type { SensitiveDataScannerPort } from '../../ports/scanner.port.js';
import type { CommunicationPortMarker } from '../ports/port.js';

export const policyMarker = (
  _scanner: SensitiveDataScannerPort,
): Brand<CommunicationPortMarker, 'PolicyMarker'> => null as never;
