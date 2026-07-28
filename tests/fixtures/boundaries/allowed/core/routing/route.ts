import type { Entity } from '../domain/index.js';
export type Route = (entity: Entity) => string;
