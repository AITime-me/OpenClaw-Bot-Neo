export const NEO_PROC_STAT_MAX_BYTES = 4096 as const;
export const NEO_PROC_START_TIME_TICKS_MAX_LENGTH = 32 as const;

const START_TIME_TICKS_PATTERN = /^[0-9]+$/;

export type ParsedProcStat = {
  readonly pid: number;
  readonly state: string;
  readonly startTimeTicks: string;
};

export type ProcStatParseFailure =
  | 'oversized-input'
  | 'missing-parenthesis'
  | 'invalid-pid'
  | 'pid-mismatch'
  | 'truncated-fields'
  | 'missing-start-time'
  | 'invalid-start-time'
  | 'zombie-state'
  | 'dead-state';

const isDeadOrZombieState = (state: string): boolean => state === 'Z' || state === 'X';

export const parseProcStat = (
  input: string,
  expectedPid: number,
):
  | { readonly ok: true; readonly value: ParsedProcStat }
  | { readonly ok: false; readonly reason: ProcStatParseFailure } => {
  if (input.length > NEO_PROC_STAT_MAX_BYTES) {
    return { ok: false, reason: 'oversized-input' };
  }

  const openParen = input.indexOf('(');
  if (openParen <= 0) {
    return { ok: false, reason: 'missing-parenthesis' };
  }

  const closeParen = input.lastIndexOf(')');
  if (closeParen <= openParen) {
    return { ok: false, reason: 'missing-parenthesis' };
  }

  const pidText = input.slice(0, openParen).trimEnd();
  if (!/^[0-9]+$/.test(pidText)) {
    return { ok: false, reason: 'invalid-pid' };
  }
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0 || pid !== expectedPid) {
    return { ok: false, reason: pid === expectedPid ? 'invalid-pid' : 'pid-mismatch' };
  }

  const suffix = input.slice(closeParen + 1).trimStart();
  if (suffix.length === 0) {
    return { ok: false, reason: 'truncated-fields' };
  }

  const tokens = suffix.split(/\s+/);
  const state = tokens[0];
  if (state === undefined || state.length !== 1) {
    return { ok: false, reason: 'truncated-fields' };
  }
  if (state === 'Z') {
    return { ok: false, reason: 'zombie-state' };
  }
  if (isDeadOrZombieState(state)) {
    return { ok: false, reason: 'dead-state' };
  }

  const startTimeTicks = tokens[19];
  if (startTimeTicks === undefined) {
    return { ok: false, reason: 'missing-start-time' };
  }
  if (
    startTimeTicks.length === 0 ||
    startTimeTicks.length > NEO_PROC_START_TIME_TICKS_MAX_LENGTH ||
    !START_TIME_TICKS_PATTERN.test(startTimeTicks)
  ) {
    return { ok: false, reason: 'invalid-start-time' };
  }

  return {
    ok: true,
    value: Object.freeze({ pid, state, startTimeTicks }),
  };
};
