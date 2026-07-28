import type { HttpClient } from '../../infrastructure/http-client.js';
export interface GatewayPort {
  readonly client: HttpClient;
}
