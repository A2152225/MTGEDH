import type { GameState, PlayerID } from '../../shared/src';
import {
  countControlledByClass,
  getProcessedBattlefield,
  normalizeControlledClassKey,
} from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';

export function evaluateModifyPtCondition(
  state: GameState,
  controllerId: PlayerID,
  conditionRaw: string
): boolean | null {
  const raw = normalizeOracleText(conditionRaw);
  if (!raw) return null;

  const battlefield = getProcessedBattlefield(state);
  const controlled = battlefield.filter(permanent => String((permanent as any)?.controller || '').trim() === controllerId);

  const typeLineLower = (permanent: any): string => getExecutorTypeLineLower(permanent);

  const normalizeClass = (text: string): string | null => normalizeControlledClassKey(text);
  const countByClass = (klass: string): number => countControlledByClass(controlled, klass, typeLineLower);

  const mCount = raw.match(/^you control (\d+) or more (.+)$/i);
  if (mCount) {
    const threshold = parseInt(String(mCount[1] || '0'), 10) || 0;
    const klass = normalizeClass(String(mCount[2] || ''));
    if (!klass) return null;
    return countByClass(klass) >= threshold;
  }

  const mAny = raw.match(/^you control (?:(?:a|an)\s+)?(.+)$/i);
  if (mAny) {
    const klass = normalizeClass(String(mAny[1] || ''));
    if (!klass) return null;
    return countByClass(klass) > 0;
  }

  return null;
}
