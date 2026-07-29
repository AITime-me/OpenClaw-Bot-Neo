import type { Entity } from '../domain/index.js';
export interface StorePort {
  load(id: string): Promise<Entity>;
}
