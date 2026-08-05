import { sealFreshObservedAdmissionEvidenceForPersistence } from '../../../core/communication/domain/fresh-observed-admission-evidence.persistence.internal.js';

export const leak = (): unknown => sealFreshObservedAdmissionEvidenceForPersistence;
