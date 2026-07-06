import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { skipRetiredSpellLegacyHandler } from './oracleIrSpellLegacyRouting.js';

export function applySpellLegacySpecialSpellRiders(
  ctx: GameContext,
  options: {
    cardName?: string;
    oracleTextLower: string;
    spellController: PlayerID;
    targets?: any[];
  },
): { shouldEarlyReturn: boolean } {
  if (skipRetiredSpellLegacyHandler(options.oracleTextLower, String(options?.cardName || ''))) {
    return { shouldEarlyReturn: false };
  }

  void ctx;
  void options;
  return { shouldEarlyReturn: false };
}
