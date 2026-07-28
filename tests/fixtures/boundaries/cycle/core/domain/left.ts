import type { Right } from './right.js';
export interface Left {
  readonly right: Right | null;
}
