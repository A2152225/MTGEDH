// server/src/socket/ai-handlers/aiActivatedAbilityContextualIdle.ts
// Origin parent: server/src/socket/ai-handlers/aiAutoPassContextualIdle.ts
// Cluster: legal-but-pointless activated abilities (Elixir gain-life / shuffle GY)
// must not stall autoPassLoop the way Entrapment does for spells — but Elixir is
// still a real play when life, a GY shuffle, or a removal/exile threat matters.
// Public entry symbols: hasUsefulAiActivatedAbilityForAutoPass,
// isElixirLikeAbilityUsefulNow, isPointlessGainLifeActivatedAbility.

import type { GameContext } from '../../state/context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import {
  canActivateAnyAbility,
  hasActivatableAbility,
  hasActivatableLoyaltyAbility,
} from '../../state/modules/can-respond-handlers/canRespondActivatableAbilities.js';
import { canActivateLoyaltyAtInstantSpeed } from '../../state/modules/triggers/planeswalker-loyalty.js';
import { extractStackItemTargetIds } from '../../state/modules/triggers/targeted.js';

const LIFE_GAIN_BUFFER_THRESHOLD = 20;
const VALUABLE_GRAVEYARD_CARD_COUNT = 3;
const VALUABLE_GRAVEYARD_NONLAND_COUNT = 2;

function playerEntry(ctx: GameContext, playerId: PlayerID): any {
  return (Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [])
    .find((entry: any) => String(entry?.id || '') === String(playerId));
}

function playerLife(ctx: GameContext, playerId: PlayerID): number {
  return Number(playerEntry(ctx, playerId)?.life ?? 40);
}

function graveyardCards(ctx: GameContext, playerId: PlayerID): any[] {
  const gy = (ctx.state as any)?.zones?.[playerId]?.graveyard;
  return Array.isArray(gy) ? gy : [];
}

function stackOracle(item: any): string {
  return String(
    item?.card?.oracle_text
    || item?.oracle_text
    || item?.oracleText
    || item?.abilityText
    || item?.effectText
    || '',
  ).toLowerCase();
}

function isElixirLikeGainLifeShuffleAbility(permanent: any): boolean {
  const oracle = String(permanent?.card?.oracle_text || '');
  if (!/\{[^}]+\}[^:]*:/.test(oracle)) return false;
  if (!/\byou gain \d+ life\b/i.test(oracle)) return false;
  const lower = oracle.toLowerCase();
  if (/\b(destroy|exile|deal|damage|counter|create|search|proliferate|draw)\b/i.test(lower)) {
    return false;
  }
  return true;
}

function stackItemTargetIds(item: any): string[] {
  const fromHelper = extractStackItemTargetIds(item);
  if (fromHelper.length > 0) return fromHelper;
  const extras = [
    ...(Array.isArray(item?.targetIds) ? item.targetIds : []),
    item?.targetId,
    item?.targetPlayerId,
    item?.chosenPlayerId,
  ];
  return extras.map((value) => String(value || '').trim()).filter(Boolean);
}

function isRemovalStyleOracle(oracle: string): boolean {
  return (
    /\b(destroy|exile|sacrifice)\b/.test(oracle)
    || /\b(-[0-9]+\/-[0-9]+)\b/.test(oracle)
    || /\breturn .* to (its|their) owner'?s? hand\b/.test(oracle)
    || /\bbounce\b/.test(oracle)
  );
}

function stackThreatensPermanent(ctx: GameContext, playerId: PlayerID, permanent: any): boolean {
  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  const permanentId = String(permanent?.id || '');
  const cardId = String(permanent?.card?.id || '');
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  if (!permanentId && !cardId) return false;

  for (const item of stack) {
    const oracle = stackOracle(item);
    const targetIds = stackItemTargetIds(item);
    const targetsThis = targetIds.some((id) => id === permanentId || (cardId && id === cardId));
    if (targetsThis && isRemovalStyleOracle(oracle)) return true;

    const hitsController = targetIds.some((id) => id === String(playerId))
      || /\beach player\b/.test(oracle)
      || /\beach opponent\b/.test(oracle);
    if (hitsController && /\bsacrifice\b/.test(oracle)) {
      if (/\bsacrifice (an? )?(artifact|permanent|nonland)\b/.test(oracle)) return true;
      if (/\bartifact\b/.test(typeLine) && /\bsacrifice\b/.test(oracle) && /\bartifact\b/.test(oracle)) {
        return true;
      }
    }

    if (
      /\b(destroy|exile) all (artifacts|nonland permanents|permanents)\b/.test(oracle)
      || (/\bartifact\b/.test(typeLine) && /\b(destroy|exile) all artifacts\b/.test(oracle))
    ) {
      return true;
    }
  }
  return false;
}

function stackThreatensGraveyard(ctx: GameContext, playerId: PlayerID): boolean {
  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  for (const item of stack) {
    const oracle = stackOracle(item);
    if (!/\bexile\b/.test(oracle) || !/\bgraveyard\b/.test(oracle)) continue;
    const targetIds = stackItemTargetIds(item);
    const targetsPlayer = targetIds.some((id) => id === String(playerId));
    const hitsEveryone = (
      /\beach player'?s? graveyard/.test(oracle)
      || /\ball graveyards\b/.test(oracle)
      || /\ball cards from (all )?graveyards\b/.test(oracle)
      || /\bexile (all )?graveyards\b/.test(oracle)
    );
    const hitsYou = (
      targetsPlayer
      || hitsEveryone
      || /\bexile (all cards from )?target player'?s? graveyard/.test(oracle)
      || /\bexile (your|that player's|a player's) graveyard/.test(oracle)
    );
    if (hitsYou) return true;
  }
  return false;
}

function hasIncomingCombatDamage(ctx: GameContext, playerId: PlayerID): boolean {
  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  return battlefield.some((permanent: any) => {
    if (String(permanent?.controller || '') === String(playerId)) return false;
    const attacking = permanent?.attacking ?? permanent?.isAttacking;
    if (!attacking && attacking !== true) return false;
    if (attacking === true || permanent?.isAttacking === true) return true;
    const attackedId = String(attacking || permanent?.defendingPlayerId || '').trim();
    return !attackedId || attackedId === String(playerId);
  });
}

function isLifeGainBeneficial(ctx: GameContext, playerId: PlayerID): boolean {
  if (hasIncomingCombatDamage(ctx, playerId)) return true;
  return playerLife(ctx, playerId) <= LIFE_GAIN_BUFFER_THRESHOLD;
}

function isGraveyardShuffleBeneficial(ctx: GameContext, playerId: PlayerID): boolean {
  if (stackThreatensGraveyard(ctx, playerId)) return true;
  const gy = graveyardCards(ctx, playerId);
  if (gy.length >= VALUABLE_GRAVEYARD_CARD_COUNT) return true;
  const nonlands = gy.filter((card) => !/\bland\b/i.test(String(card?.type_line || card?.typeLine || '')));
  return nonlands.length >= VALUABLE_GRAVEYARD_NONLAND_COUNT;
}

/**
 * Elixir-like "{2}, {T}: You gain 5 life. Shuffle this and your graveyard into
 * your library" is a real activation when life, a GY shuffle, or a
 * destroy/exile/sacrifice threat on this permanent (or GY exile) matters.
 */
export function isElixirLikeAbilityUsefulNow(
  ctx: GameContext,
  playerId: PlayerID,
  permanent: any,
): boolean {
  if (!isElixirLikeGainLifeShuffleAbility(permanent)) return true;
  if (stackThreatensPermanent(ctx, playerId, permanent)) return true;
  if (stackThreatensGraveyard(ctx, playerId)) return true;
  if (isLifeGainBeneficial(ctx, playerId)) return true;
  if (isGraveyardShuffleBeneficial(ctx, playerId)) return true;
  return false;
}

/**
 * True when this gain-life / shuffle-GY activation should not stall auto-pass.
 */
export function isPointlessGainLifeActivatedAbility(
  ctx: GameContext,
  playerId: PlayerID,
  permanent: any,
): boolean {
  if (!isElixirLikeGainLifeShuffleAbility(permanent)) return false;
  return !isElixirLikeAbilityUsefulNow(ctx, playerId, permanent);
}

/**
 * True when the AI has an activated ability auto-pass should wait for.
 * Elixir is ignored only with no threat, no incoming damage, comfortable life,
 * and a GY that is not worth shuffling. Xantcha `{3}` draw and other real
 * abilities still count. Hand/GY/exile-only activations stay live.
 */
export function hasUsefulAiActivatedAbilityForAutoPass(
  ctx: GameContext,
  playerId: PlayerID,
): boolean {
  const state = ctx.state as any;
  if (!state) return false;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const loyaltyAtInstantSpeed = canActivateLoyaltyAtInstantSpeed(state, playerId);
  let sawPointlessBattlefieldAbility = false;

  for (const permanent of battlefield) {
    const loyalty = loyaltyAtInstantSpeed
      && hasActivatableLoyaltyAbility(state, battlefield, playerId, permanent);
    const activatable = loyalty || hasActivatableAbility(ctx, playerId, permanent);
    if (!activatable) continue;
    if (!loyalty && isPointlessGainLifeActivatedAbility(ctx, playerId, permanent)) {
      sawPointlessBattlefieldAbility = true;
      continue;
    }
    return true;
  }

  if (!canActivateAnyAbility(ctx, playerId)) return false;
  if (sawPointlessBattlefieldAbility) return false;
  return true;
}
