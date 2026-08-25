// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: addManaToPoolForPlayer (mana pool increments and spend restrictions).
// Public entries: addManaToPoolForPlayer.

import type { GameState, PlayerID } from '../../shared/src';
import { addMana, addRestrictedMana, createEmptyManaPool, ManaRestrictionType, ManaType } from './types/mana';
import { parseManaSymbols } from './types/numbers';

export function addManaToPoolForPlayer(
  state: GameState,
  playerId: PlayerID,
  mana: string,
  spendRestriction?: 'creature_spell' | 'instant_or_sorcery_spell' | 'artifact_spell_or_ability' | 'activated_ability',
  sourceId?: string,
  sourceName?: string
): { state: GameState; log: string[]; applied: boolean } {
  const log: string[] = [];

  const playerExists = state.players.some(p => p.id === playerId);
  if (!playerExists) return { state, log: [`Player not found: ${playerId}`], applied: false };

  const symbols = parseManaSymbols(mana);
  if (symbols.length === 0) return { state, log: [`Skipped add mana (no symbols): ${mana}`], applied: false };

  const restriction: ManaRestrictionType | undefined = spendRestriction === 'creature_spell'
    ? 'creatures'
    : spendRestriction === 'instant_or_sorcery_spell'
      ? 'instant_sorcery'
      : spendRestriction === 'artifact_spell_or_ability'
        ? 'artifacts'
        : spendRestriction === 'activated_ability'
          ? 'activated_abilities'
        : undefined;

  const symbolToManaType = (symbol: string): ManaType => {
    switch (String(symbol).toUpperCase()) {
      case '{W}': return ManaType.WHITE;
      case '{U}': return ManaType.BLUE;
      case '{B}': return ManaType.BLACK;
      case '{R}': return ManaType.RED;
      case '{G}': return ManaType.GREEN;
      case '{C}': return ManaType.COLORLESS;
      default: return ManaType.COLORLESS;
    }
  };

  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    const isBasic = ['{W}', '{U}', '{B}', '{R}', '{G}', '{C}'].includes(upper);
    const isNumeric = /^\{\d+\}$/.test(upper);
    if (!isBasic && !isNumeric) {
      return { state, log: [`Skipped add mana (unsupported symbol ${sym}): ${mana}`], applied: false };
    }
  }

  const manaPoolRecord: Record<PlayerID, any> = { ...(((state as any).manaPool || {}) as any) };
  let pool = manaPoolRecord[playerId] || createEmptyManaPool();

  for (const sym of symbols) {
    const upper = String(sym).toUpperCase();
    switch (upper) {
      case '{W}':
        pool = addMana(pool, ManaType.WHITE, 1);
        break;
      case '{U}':
        pool = addMana(pool, ManaType.BLUE, 1);
        break;
      case '{B}':
        pool = addMana(pool, ManaType.BLACK, 1);
        break;
      case '{R}':
        pool = addMana(pool, ManaType.RED, 1);
        break;
      case '{G}':
        pool = addMana(pool, ManaType.GREEN, 1);
        break;
      case '{C}':
        pool = addMana(pool, ManaType.COLORLESS, 1);
        break;
      default: {
        const m = upper.match(/^\{(\d+)\}$/);
        const n = m ? parseInt(m[1], 10) : 0;
        if (n > 0) pool = addMana(pool, ManaType.COLORLESS, n);
        break;
      }
    }

    if (restriction) {
      const amount = /^\{\d+\}$/.test(upper) ? parseInt(upper.slice(1, -1), 10) : 1;
      if (amount > 0) {
        pool = addRestrictedMana(pool, symbolToManaType(upper), amount, restriction, sourceId, sourceName);
      }
    }
  }

  manaPoolRecord[playerId] = pool;
  log.push(`${playerId} adds ${mana.replace(/\s+/g, '')} to their mana pool${restriction ? ' with a spending restriction' : ''}`);
  return { state: { ...(state as any), manaPool: manaPoolRecord } as any, log, applied: true };
}
