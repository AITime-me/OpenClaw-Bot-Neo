import { sealValidatedTextOutput } from '../communication/domain/text-delivery.internal.js';

export const leak = (): unknown => sealValidatedTextOutput;
