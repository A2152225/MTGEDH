// server/src/state/modules/staticEffectSpecConditionEval.ts
// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster: specMatchesStaticCondition + StaticConditionState (unknown kinds do not grant).
// Public entry symbols: specMatchesStaticCondition, StaticConditionState.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { collectPrintedColorSymbols, printedObjectHasManaColor } from './printedColorSymbols.js';

export type StaticConditionState = {
  battlefield?: readonly BattlefieldPermanent[];
  life?: Record<string, number>;
  startingLife?: number;
  turnPlayer?: string;
  zones?: Record<string, { graveyard?: readonly unknown[] }>;
  players?: readonly {
    id?: string;
    ringBearerId?: string;
    ringBearerPermanentId?: string;
    attackedThisTurn?: boolean;
  }[];
  /** Player-id → attacked this turn (boolean / truthy). */
  attackedThisTurn?: Record<string, unknown>;
  /** Player-id → creatures that attacked this turn. */
  creaturesAttackedThisTurn?: Record<string, number>;
};

type ConditionSpec = {
  condition?: {
    kind?: string;
    offset?: number;
    color?: string;
    landType?: string;
  };
  sourceController?: string;
  sourcePermanentId?: string;
};

function colorNameToSymbol(colorName: string): string | null {
  const colorMap: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    w: 'W',
    u: 'U',
    b: 'B',
    r: 'R',
    g: 'G',
  };
  return colorMap[String(colorName || '').trim().toLowerCase()] || null;
}

function creatureHasManaColor(permanent: BattlefieldPermanent, colorName: string): boolean {
  const symbol = colorNameToSymbol(colorName);
  const colors = collectPrintedColorSymbols(permanent);
  const added = Array.isArray((permanent as any).colorAdditions)
    ? ((permanent as any).colorAdditions as string[]).map((entry) => String(entry).toUpperCase())
    : [];
  const effective = [...new Set([...colors, ...added])];
  if (symbol && effective.includes(symbol)) return true;
  return printedObjectHasManaColor(permanent, colorName);
}

function isCreaturePermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('creature') || typeLine.includes('kindred') || typeLine.includes('tribal');
}

function isLegendaryCreaturePermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('legendary') && isCreaturePermanent(permanent);
}

function isLandPermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

function permanentIsAttacking(permanent: BattlefieldPermanent): boolean {
  return Boolean((permanent as any).attacking) || (permanent as any).isAttacking === true;
}

function permanentIsRingBearer(
  permanent: BattlefieldPermanent,
  spec: ConditionSpec,
  state: StaticConditionState,
): boolean {
  if ((permanent as any).isRingBearer === true) return true;
  const permanentId = String(permanent.id || '').trim();
  if (!permanentId) return false;
  const controller = String(permanent.controller || spec.sourceController || '').trim();
  const players = Array.isArray(state.players) ? state.players : [];
  return players.some((player) => {
    const playerId = String(player?.id || '').trim();
    if (controller && playerId && playerId !== controller) return false;
    const ringBearerId = String(player?.ringBearerId || player?.ringBearerPermanentId || '').trim();
    return ringBearerId === permanentId;
  });
}

function playerLevelAttackedThisTurn(state: StaticConditionState, controller: string): boolean {
  const attackedMap = state.attackedThisTurn;
  if (attackedMap && typeof attackedMap === 'object') {
    const flag = attackedMap[controller];
    if (flag === true) return true;
    if (typeof flag === 'number' && flag > 0) return true;
  }
  const attackedCount = Number(state.creaturesAttackedThisTurn?.[controller] || 0);
  if (attackedCount > 0) return true;
  const players = Array.isArray(state.players) ? state.players : [];
  return players.some((player) => {
    const playerId = String(player?.id || '').trim();
    return playerId === controller && player?.attackedThisTurn === true;
  });
}

function sourceControllerAttackedThisTurn(spec: ConditionSpec, state: StaticConditionState): boolean {
  const controller = String(spec.sourceController || '').trim();
  if (!controller) return false;
  if (playerLevelAttackedThisTurn(state, controller)) return true;
  return (state.battlefield || []).some((perm) => {
    if (String(perm.controller || '') !== controller) return false;
    return Boolean((perm as any).attacking)
      || (perm as any).isAttacking === true
      || Boolean((perm as any).attackedThisTurn);
  });
}

function sourceControllerHasThreshold(spec: ConditionSpec, state: StaticConditionState): boolean {
  const controller = String(spec.sourceController || '').trim();
  if (!controller) return false;
  const graveyard = Array.isArray(state.zones?.[controller]?.graveyard)
    ? state.zones[controller]!.graveyard!
    : [];
  return graveyard.length >= 7;
}

function permanentIsEquipped(
  permanent: BattlefieldPermanent,
  state: StaticConditionState,
): boolean {
  if ((permanent as any).isEquipped === true) return true;
  const attachedEquipment = Array.isArray((permanent as any).attachedEquipment)
    ? (permanent as any).attachedEquipment
    : [];
  if (attachedEquipment.length > 0) return true;
  const permanentId = String(permanent.id || '').trim();
  if (!permanentId) return false;
  return (state.battlefield || []).some((candidate) => {
    if (String((candidate as any).attachedTo || '').trim() !== permanentId) return false;
    const typeLine = String((candidate.card as any)?.type_line || '').toLowerCase();
    return typeLine.includes('equipment');
  });
}

export function specMatchesStaticCondition(
  permanent: BattlefieldPermanent,
  spec: ConditionSpec,
  state: StaticConditionState,
): boolean {
  const condition = spec.condition;
  if (!condition?.kind) return true;

  switch (condition.kind) {
    case 'controller_life_at_least_starting_plus': {
      const controller = String(spec.sourceController || '');
      const startingLife = Number(state.startingLife || 40);
      const currentLife = Number(state.life?.[controller] ?? startingLife);
      return currentLife >= startingLife + Number(condition.offset || 0);
    }
    case 'target_is_token':
      return permanent.isToken === true;
    case 'target_is_not_token':
      return permanent.isToken !== true;
    case 'during_source_controller_turn':
      return String(state.turnPlayer || '') === String(spec.sourceController || '');
    case 'target_is_token_during_source_controller_turn':
      return permanent.isToken === true
        && String(state.turnPlayer || '') === String(spec.sourceController || '');
    case 'target_has_mana_color':
      return creatureHasManaColor(permanent, String(condition.color || ''));
    case 'target_is_not_black_creature': {
      const colors = ((permanent.card as any)?.colors || []).map((entry: string) => String(entry).toUpperCase());
      return !colors.includes('B');
    }
    case 'target_is_not_human_creature': {
      const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
      return !typeLine.includes('human');
    }
    case 'target_is_legendary_creature':
      return isLegendaryCreaturePermanent(permanent);
    case 'target_is_tapped':
      return permanent.tapped === true;
    case 'target_is_untapped':
      return permanent.tapped !== true;
    case 'target_is_attacking':
      return permanentIsAttacking(permanent);
    case 'target_is_ring_bearer':
      return permanentIsRingBearer(permanent, spec, state);
    case 'source_controller_has_threshold':
      return sourceControllerHasThreshold(spec, state);
    case 'source_controller_attacked_this_turn':
      return sourceControllerAttackedThisTurn(spec, state);
    case 'target_is_equipped':
      return permanentIsEquipped(permanent, state);
    case 'source_in_graveyard_and_control_land_type': {
      const controller = String(spec.sourceController || '');
      const sourceId = String(spec.sourcePermanentId || '');
      const landType = String(condition.landType || '').trim().toLowerCase();
      if (!controller || !sourceId || !landType) return false;
      const graveyard = Array.isArray(state.zones?.[controller]?.graveyard)
        ? state.zones[controller]!.graveyard!
        : [];
      const sourceInGraveyard = graveyard.some((card) => (
        typeof card === 'object'
        && card !== null
        && String((card as { id?: unknown }).id || '') === sourceId
      ));
      if (!sourceInGraveyard) return false;
      const landTypePattern = new RegExp(`\\b${landType.replace(/[^a-z]/g, '')}\\b`);
      return (state.battlefield || []).some((perm) => {
        if (String(perm.controller || '') !== controller || !isLandPermanent(perm)) return false;
        return landTypePattern.test(String((perm.card as any)?.type_line || '').toLowerCase());
      });
    }
    default:
      return false;
  }
}
