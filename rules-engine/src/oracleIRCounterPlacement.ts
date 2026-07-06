import type { OracleEffectStep } from './oracleIR.js';

export const EACH_PLAYER_COUNTER_PLACEMENT_PATTERN =
  /each player may put (?:two|\d+) \+1\/\+1 counters? on a creature (?:they|that player) controls?/i;

export function isEachPlayerMayPutCountersOnCreatureTheyControlText(text: string): boolean {
  const raw = String(text || '').replace(/\u2019/g, "'").trim();
  return EACH_PLAYER_COUNTER_PLACEMENT_PATTERN.test(raw);
}

export function isEachPlayerMayPutCountersOnCreatureTheyControlStep(
  step: OracleEffectStep,
): boolean {
  if (step.kind !== 'add_counter') return false;
  return isEachPlayerMayPutCountersOnCreatureTheyControlText(String(step.raw || ''));
}
