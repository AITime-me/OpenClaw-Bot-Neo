import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DEPTH_PER_CONVERSATION,
  MAX_MAX_DEPTH_PER_CONVERSATION,
  MAX_MAX_GLOBAL_PENDING,
  MIN_MAX_DEPTH_PER_CONVERSATION,
  MIN_MAX_GLOBAL_PENDING,
  defaultCommunicationQueueConfig,
  parseCommunicationQueueConfig,
} from '../../src/core/communication/domain/index.js';

describe('communication queue config contract', () => {
  it('exposes bounded defaults', () => {
    const defaults = defaultCommunicationQueueConfig();
    expect(defaults.maxDepthPerConversation).toBe(DEFAULT_MAX_DEPTH_PER_CONVERSATION);
    expect(defaults.maxGlobalPending).toBe(MIN_MAX_GLOBAL_PENDING);
  });

  it('parses valid queue configuration objects', () => {
    const parsed = parseCommunicationQueueConfig({
      maxDepthPerConversation: 16,
      maxGlobalPending: 32,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.maxDepthPerConversation).toBe(16);
    expect(parsed.value.maxGlobalPending).toBe(32);
  });

  it('rejects out-of-range depths and global pending values', () => {
    expect(
      parseCommunicationQueueConfig({
        maxDepthPerConversation: MIN_MAX_DEPTH_PER_CONVERSATION - 1,
        maxGlobalPending: MIN_MAX_GLOBAL_PENDING,
      }).ok,
    ).toBe(false);
    expect(
      parseCommunicationQueueConfig({
        maxDepthPerConversation: MAX_MAX_DEPTH_PER_CONVERSATION + 1,
        maxGlobalPending: MIN_MAX_GLOBAL_PENDING,
      }).ok,
    ).toBe(false);
    expect(
      parseCommunicationQueueConfig({
        maxDepthPerConversation: DEFAULT_MAX_DEPTH_PER_CONVERSATION,
        maxGlobalPending: MAX_MAX_GLOBAL_PENDING + 1,
      }).ok,
    ).toBe(false);
  });

  it('rejects getter-backed queue config objects', () => {
    const config = {
      get maxDepthPerConversation() {
        return 8;
      },
      maxGlobalPending: 4,
    };
    expect(parseCommunicationQueueConfig(config).ok).toBe(false);
  });
});
