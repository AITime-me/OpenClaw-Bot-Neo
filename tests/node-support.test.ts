import { describe, expect, it } from 'vitest';
import {
  evaluateNodeSupport,
  parseNodeVersion,
  PRODUCTION_NODE_GATE_ENV,
  PRODUCTION_NODE_RANGE,
  resolveReviewOverrideAllowed,
  REVIEW_NODE_OVERRIDE_ENV,
} from '../src/core/runtime/node-support.js';
import * as publicApi from '../src/index.js';

describe('Node runtime contract', () => {
  it('documents the production range', () => {
    expect(PRODUCTION_NODE_RANGE.label).toBe('>=22.13.0 <23');
    expect(publicApi.PRODUCTION_NODE_RANGE.label).toBe('>=22.13.0 <23');
    expect(REVIEW_NODE_OVERRIDE_ENV).toBe('OPENCLAW_REVIEW_NODE_OVERRIDE');
    expect(PRODUCTION_NODE_GATE_ENV).toBe('OPENCLAW_PRODUCTION_NODE_GATE');
  });

  it('allows supported Node 22 patches and denies others', () => {
    expect(evaluateNodeSupport('22.13.0').ok).toBe(true);
    expect(evaluateNodeSupport('22.18.0').ok).toBe(true);
    expect(evaluateNodeSupport('22.12.0').ok).toBe(false);
    expect(evaluateNodeSupport('21.0.0').ok).toBe(false);
    expect(evaluateNodeSupport('23.0.0').ok).toBe(false);
    expect(evaluateNodeSupport('24.18.0').ok).toBe(false);
    expect(parseNodeVersion('not-a-version')).toBeNull();
    expect(evaluateNodeSupport('nope').ok).toBe(false);
  });

  it('allows explicit review override without claiming production support', () => {
    const decision = evaluateNodeSupport('24.18.0', {
      allowUnsupportedReviewOverride: true,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.mode).toBe('review-override');
  });

  it('gives production gate priority over review override', () => {
    expect(
      resolveReviewOverrideAllowed({
        [REVIEW_NODE_OVERRIDE_ENV]: '1',
        [PRODUCTION_NODE_GATE_ENV]: '1',
      }),
    ).toBe(false);
    expect(
      resolveReviewOverrideAllowed({
        [REVIEW_NODE_OVERRIDE_ENV]: '1',
      }),
    ).toBe(true);
    const conflict = evaluateNodeSupport('24.18.0', {
      allowUnsupportedReviewOverride: resolveReviewOverrideAllowed({
        [REVIEW_NODE_OVERRIDE_ENV]: '1',
        [PRODUCTION_NODE_GATE_ENV]: '1',
      }),
    });
    expect(conflict.ok).toBe(false);
  });
});
