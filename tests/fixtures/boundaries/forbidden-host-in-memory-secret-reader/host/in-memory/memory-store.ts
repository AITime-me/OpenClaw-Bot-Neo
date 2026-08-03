import { readSecretMaterialForTrustedConsumer } from '../../core/domain/secret.internal.js';
export const leak = (): unknown => readSecretMaterialForTrustedConsumer;
