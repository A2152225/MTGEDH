import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { uid } from '../utils.js';
import { handleElixirShuffle } from './zone-manipulation.js';
import { createToken } from './counters_tokens.js';
import { applyTriggerLifeGain } from './triggerLifeDamageUtils.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import { queueExploreDecisionStep } from './triggerExploreUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyCardSpecificParams {
  readonly controller: PlayerID;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly sourceName?: string;
}

export function applyRetiredTriggerLegacyAgentOfShadowThievesAttack(
  params: TriggerLegacyCardSpecificParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, String(params.sourceName || ''))) {
    return false;
  }

  const desc = String(params.desc || '').toLowerCase();
  if (
    !desc.includes('whenever this creature attacks a player')
    || !desc.includes('if no opponent has more life')
    || !desc.includes('+1/+1 counter')
  ) {
    return false;
  }

  const sourceId = params.triggerItem.source || params.triggerItem.permanentId;
  const battlefield = params.state.battlefield || [];
  const perm = battlefield.find((p: any) => p?.id === sourceId);

  if (!perm) {
    return true;
  }

  const effectData = params.triggerItem?.effectData || params.triggerItem?.value || {};
  const defendingPlayerId = effectData.defendingPlayer;

  if (!defendingPlayerId) {
    return true;
  }

  const defendingPlayerLife = params.state.life[defendingPlayerId] ?? (params.state.startingLife || 40);
  const players = params.state.players || [];
  const opponents = players.filter((p: any) => p.id !== params.controller && !p.hasLost);

  const noOpponentHasMoreLife = opponents.every((opponent: any) => {
    const opponentLife = params.state.life[opponent.id] ?? (params.state.startingLife || 40);
    return opponentLife <= defendingPlayerLife;
  });

  if (noOpponentHasMoreLife) {
    perm.counters = perm.counters || {};
    perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
    debug(2, `[executeTriggerEffect] Agent trigger: Added +1/+1 counter to ${perm.card?.name || perm.id}`);

    perm.temporaryAbilities = perm.temporaryAbilities || [];
    if (!perm.temporaryAbilities.includes('deathtouch')) {
      perm.temporaryAbilities.push('deathtouch');
    }
    if (!perm.temporaryAbilities.includes('indestructible')) {
      perm.temporaryAbilities.push('indestructible');
    }

    params.state.endOfTurnEffects = params.state.endOfTurnEffects || [];
    params.state.endOfTurnEffects.push({
      type: 'remove_temporary_abilities',
      permanentId: sourceId,
      abilities: ['deathtouch', 'indestructible'],
    });

    debug(2, `[executeTriggerEffect] Agent trigger: ${perm.card?.name || perm.id} gained deathtouch and indestructible until end of turn`);
  } else {
    debug(2, `[executeTriggerEffect] Agent trigger: Condition not met (opponent has more life than defending player)`);
  }

  return true;
}

export function applyRetiredTriggerLegacyCurseDefendingPlayer(
  params: TriggerLegacyCardSpecificParams & {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly desc: string;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/^curse defending player/i.test(String(params.desc || ''))) {
    return false;
  }

  const defendingPlayerId = String(
    params.triggerItem?.defendingPlayer ||
    params.triggerItem?.effectData?.defendingPlayer ||
    params.triggerItem?.targetPlayer ||
    '',
  ).trim();

  if (!defendingPlayerId) {
    return true;
  }

  const curseId = uid('curse_token');
  params.state.battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
  params.state.battlefield.push({
    id: curseId,
    controller: params.controller,
    owner: params.controller,
    isToken: true,
    enchantedPlayerId: defendingPlayerId,
    card: {
      id: curseId,
      name: 'Curse',
      type_line: 'Token Enchantment — Aura Curse',
      oracle_text: 'Enchant player\nAt the beginning of your upkeep, you lose 1 life.',
    },
    type_line: 'Token Enchantment — Aura Curse',
    cardType: 'Token Enchantment — Aura Curse',
  });
  debug(2, `[executeTriggerEffect] ${params.sourceName}: cursed ${defendingPlayerId}`);
  return true;
}

export function applyRetiredTriggerLegacyEachMerfolkExplores(
  params: TriggerLegacyCardSpecificParams & {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly desc: string;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/\beach merfolk you control explores\b/.test(String(params.desc || ''))) {
    return false;
  }

  const battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
  const merfolkIds = battlefield
    .filter((perm: any) => {
      if (!perm || String(perm.controller || '') !== String(params.controller)) return false;

      const typeBlob = [
        String(perm.card?.type_line || ''),
        Array.isArray((perm as any).effectiveTypes) ? (perm as any).effectiveTypes.join(' ') : '',
        Array.isArray((perm as any).grantedTypes) ? (perm as any).grantedTypes.join(' ') : '',
      ].join(' ').toLowerCase();

      return (isCreatureNow(perm) || typeBlob.includes('creature')) && typeBlob.includes('merfolk');
    })
    .map((perm: any) => String(perm.id || ''))
    .filter((id: string) => id.length > 0);

  if (merfolkIds.length === 0) {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: no Merfolk controlled by ${params.controller} to explore`);
    return true;
  }

  const [firstPermanentId, ...remainingPermanentIds] = merfolkIds;
  const queued = queueExploreDecisionStep(params.ctx, params.controller, firstPermanentId, remainingPermanentIds);
  debug(
    2,
    `[executeTriggerEffect] ${params.sourceName}: ${queued ? 'queued' : 'skipped'} explore sequence for ${merfolkIds.length} Merfolk`,
  );
  return true;
}

export function applyRetiredTriggerLegacyDarienDamageTokens(
  params: TriggerLegacyCardSpecificParams & {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const desc = String(params.desc || '').toLowerCase();
  const sourceNameLower = String(params.sourceName || '').toLowerCase();
  if (
    !sourceNameLower.includes('darien, king of kjeldor')
    && !desc.includes('create that many 1/1 white soldier creature tokens')
  ) {
    return false;
  }

  const damageAmount = Math.max(0, Number(params.triggerItem?.damageAmount || 0));
  if (damageAmount > 0) {
    createToken(params.ctx, params.controller, 'Soldier', damageAmount, 1, 1, {
      colors: ['W'],
      typeLine: 'Token Creature — Soldier',
    });
  }

  return true;
}

export function applyRetiredTriggerLegacyElixirOfImmortality(
  params: TriggerLegacyCardSpecificParams & {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const desc = String(params.desc || '').toLowerCase();
  const sourceNameLower = String(params.sourceName || '').toLowerCase();
  if (
    !sourceNameLower.includes('elixir of immortality')
    && !(desc.includes('shuffle') && desc.includes('graveyard') && desc.includes('into') && desc.includes('library'))
  ) {
    return false;
  }

  applyTriggerLifeGain(params.state, String(params.controller), 5, 'Elixir of Immortality');
  debug(2, `[executeTriggerEffect] Elixir of Immortality: ${params.controller} gained 5 life`);

  const sourceId = params.triggerItem?.source;
  const shuffledCount = handleElixirShuffle(params.ctx, params.controller, sourceId);
  debug(1, `[executeTriggerEffect] Elixir of Immortality: shuffled ${shuffledCount} cards into ${params.controller}'s library`);
  return true;
}
