import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { getEffectivePower } from '../../socket/util.js';
import { uid } from '../utils.js';
import { getOrInitManaPool } from '../../socket/util.js';
import { recordCardLeftGraveyardThisTurn } from './turn-tracking.js';
import { debug } from '../../utils/debug.js';
import { addExtraCombat } from './turn.js';
import { modifyTriggerEffectLife } from './triggerLifeDamageUtils.js';
import { skipRetiredTriggerLegacyHandler, isTriggerEffectFullyIrWired } from './oracleIrTriggerLegacyRouting.js';

function getOrCreatePlayerZones(stateAny: any, playerId: PlayerID): any {
  stateAny.zones = stateAny.zones || {};
  stateAny.zones[playerId] = stateAny.zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };

  const zones = stateAny.zones[playerId];
  zones.library = Array.isArray(zones.library) ? zones.library : [];
  zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  zones.exile = Array.isArray(zones.exile) ? zones.exile : [];
  zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
  zones.handCount = zones.hand.length;
  zones.libraryCount = zones.library.length;
  zones.graveyardCount = zones.graveyard.length;
  zones.exileCount = zones.exile.length;
  return zones;
}

const COLOR_KEY_BY_SYMBOL: Record<string, 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'> = {
  w: 'white',
  u: 'blue',
  b: 'black',
  r: 'red',
  g: 'green',
  c: 'colorless',
};

function detectTemporaryManaRetentionDuration(text: string): 'untilEndCombat' | 'untilEndTurn' | null {
  const normalized = String(text || '').toLowerCase().replace(/[’]/g, "'");
  const hasRetentionClause = normalized.includes("don't lose this mana as steps and phases end")
    || normalized.includes("doesn't empty from your mana pool")
    || normalized.includes('this mana lasts until end of combat')
    || normalized.includes('this mana lasts until end of turn');
  if (!hasRetentionClause) return null;
  if (normalized.includes('until end of combat')) return 'untilEndCombat';
  if (normalized.includes('until end of turn')) return 'untilEndTurn';
  return null;
}

export function applyRetiredTriggerLegacyManaAndCombatBatch(params: {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const { ctx, controller, sourceName, desc, triggerItem, state } = params;

  const trackTemporaryRetainedMana = (
    playerId: string,
    colorKey: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless',
    amount: number,
    duration: 'untilEndCombat' | 'untilEndTurn' | null,
  ) => {
    if (!duration || amount <= 0) return;
    state.temporaryRetainedMana = state.temporaryRetainedMana || {};
    state.temporaryRetainedMana[playerId] = state.temporaryRetainedMana[playerId] || {};
    state.temporaryRetainedMana[playerId][duration] = state.temporaryRetainedMana[playerId][duration] || {};
    state.temporaryRetainedMana[playerId][duration][colorKey] =
      (state.temporaryRetainedMana[playerId][duration][colorKey] || 0) + amount;
  };

  const addParsedManaToPool = (
    playerId: string,
    manaString: string,
    duration: 'untilEndCombat' | 'untilEndTurn' | null,
  ) => {
    const pool = getOrInitManaPool(state as any, playerId as PlayerID);
    const manaRegex = /\{([WUBRGC])\}/gi;
    let manaMatch;
    while ((manaMatch = manaRegex.exec(manaString)) !== null) {
      const colorKey = COLOR_KEY_BY_SYMBOL[String(manaMatch[1] || '').toLowerCase()];
      if (!colorKey) continue;
      (pool as any)[colorKey] = (((pool as any)[colorKey] as number | undefined) || 0) + 1;
      trackTemporaryRetainedMana(playerId, colorKey, 1, duration);
    }
  };

  const temporaryManaRetentionDuration = detectTemporaryManaRetentionDuration(desc);

  const dynamicPowerManaMatch = desc.match(/add an amount of \{([wubrgc])\} equal to (?:its|this creature's|equipped creature's) power/i);
  if (dynamicPowerManaMatch) {
    const effectData = (triggerItem as any)?.effectData;
    const referencedPermanentId = String(
      effectData?.attachedToId ||
      (triggerItem as any)?.attachedToId ||
      (triggerItem as any)?.source ||
      (triggerItem as any)?.permanentId ||
      ''
    ).trim();
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const referencedPermanent = battlefield.find((perm: any) => String(perm?.id || '') === referencedPermanentId);
    const manaAmount = referencedPermanent ? Math.max(0, getEffectivePower(referencedPermanent)) : 0;
    const colorKey = COLOR_KEY_BY_SYMBOL[String(dynamicPowerManaMatch[1] || '').toLowerCase()];

    if (colorKey && manaAmount > 0) {
      const pool = getOrInitManaPool(state as any, controller);
      (pool as any)[colorKey] = (((pool as any)[colorKey] as number | undefined) || 0) + manaAmount;
      trackTemporaryRetainedMana(controller, colorKey, manaAmount, temporaryManaRetentionDuration);
      debug(2, `[executeTriggerEffect] ${sourceName}: ${controller} adds ${manaAmount} ${colorKey} mana based on ${referencedPermanent?.card?.name || referencedPermanentId}'s power`);
    } else {
      debug(2, `[executeTriggerEffect] ${sourceName}: dynamic mana trigger resolved for ${controller} with amount ${manaAmount}`);
    }
    return true;
  }

  const addManaMatch = desc.match(/add (\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (addManaMatch && !isTriggerEffectFullyIrWired(params.desc, params.sourceName)) {
    const manaString = addManaMatch[1];
    debug(2, `[executeTriggerEffect] ${controller} adds ${manaString} to mana pool`);
    addParsedManaToPool(controller, manaString, temporaryManaRetentionDuration);
    return true;
  }

  const opponentDrawsDamageMatch = desc.match(/whenever (?:an )?opponent draws (?:a card|cards?),?\s*(?:[^,.]+ )?(?:deals? |loses? )(\d+) (?:damage|life)/i);
  if (opponentDrawsDamageMatch) {
    const damage = parseInt(opponentDrawsDamageMatch[1], 10);
    const drawingPlayer = triggerItem?.triggeringPlayer || triggerItem?.targets?.[0];
    if (drawingPlayer && drawingPlayer !== controller) {
      modifyTriggerEffectLife(state, drawingPlayer, -damage);
      debug(2, `[executeTriggerEffect] ${sourceName}: ${drawingPlayer} loses ${damage} life from drawing`);
    }
    return true;
  }

  const playerDrawsTriggerMatch = desc.match(/whenever (?:a )?player draws (?:a card|cards?),?\s*([^.]+)/i);
  if (playerDrawsTriggerMatch) {
    const effectText = playerDrawsTriggerMatch[1].trim();
    const damageMatch = effectText.match(/(?:deals? |loses? )(\d+) (?:damage|life)/i);
    if (damageMatch) {
      const damage = parseInt(damageMatch[1], 10);
      const drawingPlayer = triggerItem?.triggeringPlayer || triggerItem?.targets?.[0];
      if (drawingPlayer) {
        modifyTriggerEffectLife(state, drawingPlayer, -damage);
        debug(2, `[executeTriggerEffect] ${sourceName}: ${drawingPlayer} loses ${damage} life from drawing`);
      }
    }
    return true;
  }

  const thatPlayerAddsManaMatch = desc.match(/that player adds (\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (thatPlayerAddsManaMatch) {
    const manaString = thatPlayerAddsManaMatch[1];
    const targetPlayer = triggerItem?.triggeringPlayer || controller;
    debug(2, `[executeTriggerEffect] ${targetPlayer} adds ${manaString} to mana pool`);
    addParsedManaToPool(targetPlayer, manaString, temporaryManaRetentionDuration);
    return true;
  }

  const dealsDamageToThatPlayerMatch = desc.match(/deals?\s+(\d+)\s+damage\s+to\s+that\s+player/i);
  if (dealsDamageToThatPlayerMatch) {
    const dmg = parseInt(dealsDamageToThatPlayerMatch[1], 10);
    const targetPlayer = triggerItem?.triggeringPlayer ||
      triggerItem?.targetPlayer ||
      triggerItem?.effectData?.shuffledPlayerId ||
      triggerItem?.effectData?.damagedPlayerId ||
      controller;
    if (targetPlayer) {
      modifyTriggerEffectLife(state, targetPlayer, -dmg);
      try {
        (state as any).damageTakenThisTurnByPlayer = (state as any).damageTakenThisTurnByPlayer || {};
        (state as any).damageTakenThisTurnByPlayer[String(targetPlayer)] =
          Number((state as any).damageTakenThisTurnByPlayer[String(targetPlayer)] || 0) + dmg;
      } catch {
        /* best-effort */
      }
      debug(2, `[executeTriggerEffect] ${sourceName}: ${String(targetPlayer)} takes ${dmg} damage (that player)`);
    }
    return true;
  }

  if (desc.includes('additional combat phase') || desc.includes('extra combat phase')) {
    const sourceNameLower = sourceName.toLowerCase();
    const isFirstAttackOnly = desc.includes('first attack') || desc.includes('first combat');
    const shouldUntap = desc.includes('untap all creatures') || sourceNameLower.includes('aurelia');
    const extraCombatKey = `extraCombat_${sourceName}_${state.turnNumber || 0}`;
    if (isFirstAttackOnly && state.usedOncePerTurn?.[extraCombatKey]) {
      debug(2, `[executeTriggerEffect] ${sourceName} extra combat already used this turn, skipping`);
      return true;
    }
    if (isFirstAttackOnly) {
      state.usedOncePerTurn = state.usedOncePerTurn || {};
      state.usedOncePerTurn[extraCombatKey] = true;
    }
    addExtraCombat(ctx, sourceName, shouldUntap);
    debug(2, `[executeTriggerEffect] ${sourceName}: Added extra combat phase (untap: ${shouldUntap})`);
    return true;
  }

  if (desc.includes('proliferate')) {
    debug(2, `[executeTriggerEffect] Proliferate effect from ${sourceName} for ${controller}`);
    state.pendingProliferate = state.pendingProliferate || [];
    state.pendingProliferate.push({
      id: uid('proliferate'),
      controller,
      sourceName: sourceName || 'Proliferate Effect',
      imageUrl: triggerItem.value?.imageUrl,
    });
    return true;
  }

  const graveyardToLibraryMatch = desc.match(/put target (?:[^.]+? )?card(?:\s+with\s+mana\s+value\s+.+?)? from (?:your|a|any|an\s+opponent['’]?s?) graveyard on (?:the )?(top|bottom) of (?:its owner['’]s|your) library/i);
  if (graveyardToLibraryMatch) {
    const targets = Array.isArray((triggerItem as any).targets) ? (triggerItem as any).targets : [];
    const targetCardId = String(targets[0] || '').trim();
    if (!targetCardId) {
      return true;
    }

    const placement = String(graveyardToLibraryMatch[1] || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom';
    const zonesAll = (state as any).zones || {};
    let targetOwnerId: string | null = null;
    let removedCard: any = null;

    for (const [playerId, playerZonesAny] of Object.entries(zonesAll)) {
      const playerZones = playerZonesAny as any;
      const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
      const graveyardIndex = graveyard.findIndex((card: any) => card && String(card.id || '') === targetCardId);
      if (graveyardIndex === -1) continue;

      removedCard = graveyard[graveyardIndex];
      graveyard.splice(graveyardIndex, 1);
      playerZones.graveyardCount = graveyard.length;
      targetOwnerId = String(playerId);
      break;
    }

    if (!removedCard || !targetOwnerId) {
      return true;
    }

    recordCardLeftGraveyardThisTurn(ctx, targetOwnerId, removedCard);

    const lib = Array.isArray((ctx as any)?.libraries?.get(targetOwnerId))
      ? (((ctx as any).libraries.get(targetOwnerId)) as any[])
      : [];
    const libCard = { ...removedCard, zone: 'library' };
    if (placement === 'top') lib.unshift(libCard);
    else lib.push(libCard);
    (ctx as any)?.libraries?.set?.(targetOwnerId, lib);

    const ownerZones = getOrCreatePlayerZones(state as any, targetOwnerId as PlayerID);
    ownerZones.library = lib;
    ownerZones.libraryCount = lib.length;

    debug(2, `[executeTriggerEffect] ${sourceName} put ${removedCard?.name || targetCardId} from ${targetOwnerId}'s graveyard on the ${placement} of its owner's library`);
    return true;
  }

  return false;
}
