import type { OracleEffectStep, OraclePlayerSelector } from './oracleIR';
import { parseEffectLevelImpulsePermissionClause } from './oracleIRParserEffectImpulsePermission';
import { cleanImpulseClause } from './oracleIRParserImpulseClauseUtils';
import { isThatOwnerOrControllerSelector, parseQuantity } from './oracleIRParserUtils';

export function tryParseSubjectOrderImpulseExileTop(
  firstClause: string,
  secondClause: string
): { step: OracleEffectStep; consumed: number } | null {
  const firstClean = cleanImpulseClause(firstClause);
  const secondClean = cleanImpulseClause(secondClause);
  if (!firstClean || !secondClean) return null;

  const subjectOrderImpulse = firstClean.match(
    /^(its controller|its owner|that [a-z0-9][a-z0-9 -]*'s (?:controller|owner)|that player|that opponent|defending player|the defending player|they|he or she)\s+may\s+exile\s+(that many|a|an|\d+|x|[a-z]+)\s+cards?\s+from\s+the\s+top\s+of\s+(their|his or her|your)\s+library(?:\s+face down)?\s*$/i
  );
  if (!subjectOrderImpulse) return null;

  const permissionInfo = parseEffectLevelImpulsePermissionClause(secondClean);
  if (!permissionInfo) return null;

  const rawSubject = String(subjectOrderImpulse[1] || '').trim().toLowerCase();
  let who: OraclePlayerSelector | null = null;
  if (rawSubject === 'that player' || rawSubject === 'they' || rawSubject === 'he or she') who = { kind: 'target_player' };
  else if (rawSubject === 'that opponent' || rawSubject === 'defending player' || rawSubject === 'the defending player') who = { kind: 'target_opponent' };
  else if (rawSubject === 'its controller' || rawSubject === 'its owner' || isThatOwnerOrControllerSelector(rawSubject)) who = { kind: 'target_player' };

  if (!who) return null;

  return {
    consumed: 2,
    step: {
      kind: 'impulse_exile_top',
      who,
      amount: parseQuantity(subjectOrderImpulse[2]),
      permission: permissionInfo.permission,
      duration: permissionInfo.duration,
      raw: `${firstClause}. ${secondClause}`,
      ...(permissionInfo.condition ? { condition: permissionInfo.condition } : {}),
    },
  };
}
