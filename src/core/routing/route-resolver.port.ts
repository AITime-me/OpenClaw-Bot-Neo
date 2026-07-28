import type { Result } from '../domain/index.js';
import type { OperationContext } from '../ports/index.js';
import type { Route, RoutingError } from './model-routing-policy.js';
export interface RouteResolverPort {
  resolve(risk: unknown, context: OperationContext): Promise<Result<Route, RoutingError>>;
}
