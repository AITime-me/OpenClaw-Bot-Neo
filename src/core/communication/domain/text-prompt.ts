import { deepFreeze } from '../../domain/immutable.js';
import type { OwnerId, PolicyVersion } from '../../domain/identity.js';
import {
  MAX_ACTIVE_CONTEXT_ENTRIES,
  MAX_ACTIVE_CONTEXT_TOTAL_UTF8_BYTES,
  MAX_MEMORY_EXCERPT_COUNT,
  MAX_MEMORY_EXCERPT_UTF8_BYTES,
  MAX_MEMORY_EXCERPTS_TOTAL_UTF8_BYTES,
  MAX_OWNER_TEXT_UTF8_BYTES,
  MAX_PROMPT_TOTAL_UTF8_BYTES,
  type ConversationId,
} from './communication-identity.js';
import type { ConversationContextTrust, ModelDerivedUntrustedTrust } from './conversation-state.js';

export const TEXT_PROMPT_SECTION_KINDS = Object.freeze([
  'security-system',
  'neo-persona',
  'memory-context',
  'active-conversation-context',
  'owner-text',
] as const);

export type TextPromptSectionKind = (typeof TEXT_PROMPT_SECTION_KINDS)[number];

export interface TextPromptSection {
  readonly kind: TextPromptSectionKind;
  readonly title: string;
  readonly body: string;
  readonly instructionsExecutable: boolean;
  readonly trust: 'trusted-fixed' | 'trusted-policy' | ConversationContextTrust;
}

export interface TextPromptMemoryExcerpt {
  readonly recordId: string;
  readonly namespace: string;
  readonly text: string;
  readonly provenanceLabel: string;
  readonly trustLabel: string;
}

export interface TextPromptAssemblyInput {
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly policyVersion: PolicyVersion;
  readonly securitySystemBody: string;
  readonly neoPersonaBody: string;
  readonly memoryExcerpts: readonly TextPromptMemoryExcerpt[];
  readonly activeConversationContext: readonly { readonly role: string; readonly text: string }[];
  readonly ownerText: string;
  readonly modelDerivedSummary: {
    readonly text: string;
    readonly trust: ModelDerivedUntrustedTrust;
  } | null;
}

/**
 * Immutable provider-independent prompt with exactly five normative sections.
 * Section order is fixed and enforced by the assembly policy.
 */
export interface TextPrompt {
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly policyVersion: PolicyVersion;
  readonly sections: readonly [
    TextPromptSection,
    TextPromptSection,
    TextPromptSection,
    TextPromptSection,
    TextPromptSection,
  ];
  readonly totalUtf8Bytes: number;
}

export const TEXT_PROMPT_BOUNDS = Object.freeze({
  maxOwnerTextUtf8Bytes: MAX_OWNER_TEXT_UTF8_BYTES,
  maxMemoryExcerptCount: MAX_MEMORY_EXCERPT_COUNT,
  maxMemoryExcerptUtf8Bytes: MAX_MEMORY_EXCERPT_UTF8_BYTES,
  maxMemoryExcerptsTotalUtf8Bytes: MAX_MEMORY_EXCERPTS_TOTAL_UTF8_BYTES,
  maxActiveContextEntries: MAX_ACTIVE_CONTEXT_ENTRIES,
  maxActiveContextTotalUtf8Bytes: MAX_ACTIVE_CONTEXT_TOTAL_UTF8_BYTES,
  maxPromptTotalUtf8Bytes: MAX_PROMPT_TOTAL_UTF8_BYTES,
});

export const isTextPromptSectionKind = (value: unknown): value is TextPromptSectionKind =>
  typeof value === 'string' && (TEXT_PROMPT_SECTION_KINDS as readonly string[]).includes(value);

export const freezeTextPrompt = (prompt: TextPrompt): TextPrompt => {
  const sections = Object.freeze(
    prompt.sections.map((section) => deepFreeze({ ...section })),
  ) as TextPrompt['sections'];
  return deepFreeze({ ...prompt, sections });
};

export const textPromptSectionKindsInOrder = (): readonly TextPromptSectionKind[] =>
  TEXT_PROMPT_SECTION_KINDS;
