import type { Left } from './left.js';
export interface Right {
  readonly left: Left | null;
}
