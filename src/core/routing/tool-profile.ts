export interface ToolProfile {
  readonly id: string;
  readonly exec: boolean;
  readonly write: boolean;
  readonly secrets: boolean;
  readonly externalSend: boolean;
}
export const RESTRICTED_UNTRUSTED_PROFILE: ToolProfile = {
  id: 'untrusted-restricted',
  exec: false,
  write: false,
  secrets: false,
  externalSend: false,
};
