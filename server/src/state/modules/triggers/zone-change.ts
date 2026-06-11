import type { GameContext } from '../../context.js';
import { timingTriggerEffect } from './timing-effect-extraction.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface ExiledFromBattlefieldTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'creature_exiled_from_battlefield' | 'permanent_exiled_from_battlefield';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  targetFilter: 'creature' | 'permanent';
}

export function detectExiledFromBattlefieldTriggers(card: any, permanent: any): ExiledFromBattlefieldTrigger[] {
  const triggers: ExiledFromBattlefieldTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const selfExilePatterns = [
    /when (?:~|this creature|this permanent|this artifact|this enchantment) is exiled from the battlefield[^,]*,?\s*([^.]+)/gi,
    /whenever (?:~|this creature|this permanent|this artifact|this enchantment) is exiled from the battlefield[^,]*,?\s*([^.]+)/gi,
  ];
  for (const pattern of selfExilePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effect = String(match[1] || '').trim().replace(/\s+/g, ' ');
      if (!effect || triggers.some((t) => t.effect === effect && t.triggerType === 'creature_exiled_from_battlefield')) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(match[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const playExiledWithPatterns = [
    /whenever a player plays a card exiled with ([^,]+),?\s*([^.]+)/gi,
    /whenever (?:a |an )?opponent plays a card exiled with ([^,]+),?\s*([^.]+)/gi,
    /when you play a card exiled with (?:~|this creature),?\s*([^.]+)/gi,
    /whenever you play a card with the same name as one of the exiled cards,?\s*([^.]+)/gi,
  ];
  for (const pattern of playExiledWithPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effect = String(match[match.length - 1] || '').trim().replace(/\s+/g, ' ');
      if (!effect || triggers.some((t) => t.effect === effect)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(match[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const warpedExileMatch = oracleText.match(/whenever a card is exiled because it was warped,?\s*([^.]+)/i);
  if (warpedExileMatch) {
    const effect = String(warpedExileMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(warpedExileMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const unearthedCreatureExiledMatch = oracleText.match(
    /whenever a creature you control is exiled,?\s*if it was unearthed,?\s*([^.]+)/i,
  );
  if (unearthedCreatureExiledMatch) {
    const effect = String(unearthedCreatureExiledMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.triggerType === 'unearthed_creature_exiled')) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(unearthedCreatureExiledMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const creatureCardExiledThisWayMatch = oracleText.match(/when a creature card is exiled this way,?\s*([^.]+)/i);
  if (creatureCardExiledThisWayMatch) {
    const effect = String(creatureCardExiledThisWayMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(creatureCardExiledThisWayMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const exiledThisWayMatch = oracleText.match(/when one or more ([^ ]+) cards are exiled this way,?\s*([^.]+)/i);
  if (exiledThisWayMatch) {
    const effect = String(exiledThisWayMatch[2] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(exiledThisWayMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const controlledCreaturesOrGraveyardCardsExiledMatch = oracleText.match(
    /whenever one or more creatures you control and\/or creature cards in your graveyard are put into exile,?\s*([^.]+)/i,
  );
  if (controlledCreaturesOrGraveyardCardsExiledMatch) {
    const effect = String(controlledCreaturesOrGraveyardCardsExiledMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.oracleClause === controlledCreaturesOrGraveyardCardsExiledMatch[0].trim())) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(controlledCreaturesOrGraveyardCardsExiledMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const cardsExiledFromHandMatch = oracleText.match(
    /whenever one or more cards are put into exile from your hand(?: or a spell or ability you control exiles one or more cards from an opponent's hand)?,?\s*([^.]+)/i,
  );
  if (cardsExiledFromHandMatch) {
    const effect = String(cardsExiledFromHandMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(cardsExiledFromHandMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const loseControlThatEquipmentMatch = oracleText.match(
    /when you lose control of that equipment(?: this turn)?,?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (loseControlThatEquipmentMatch) {
    const effect = String(loseControlThatEquipmentMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(loseControlThatEquipmentMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const matches = oracleText.matchAll(/whenever a (creature|permanent) is exiled from the battlefield,?\s*([^.]+)/gi);
  for (const match of matches) {
    const targetFilter = String(match[1] || '').trim().toLowerCase() === 'creature' ? 'creature' : 'permanent';
    const effect = timingTriggerEffect(oracleText, match, 2).replace(/\s+/g, ' ');
    if (!effect) continue;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: targetFilter === 'creature' ? 'creature_exiled_from_battlefield' : 'permanent_exiled_from_battlefield',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      targetFilter,
    });
  }

  return triggers;
}

export function getExiledFromBattlefieldTriggers(
  ctx: GameContext,
  exiledPermanent: any,
): ExiledFromBattlefieldTrigger[] {
  const triggers: ExiledFromBattlefieldTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const exiledTypeLine = String(exiledPermanent?.card?.type_line || '').toLowerCase();

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permanentTriggers = detectExiledFromBattlefieldTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      if (trigger.targetFilter === 'creature' && !exiledTypeLine.includes('creature')) {
        continue;
      }

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        String(trigger.oracleClause || trigger.effect || ''),
        permanent,
        {
          thatPermanent: exiledPermanent,
          referencedPermanent: exiledPermanent,
          exiledPermanent,
        } as any,
      );
      if (ok === false) continue;

      triggers.push(trigger);
    }
  }

  return triggers;
}

function findBattlefieldPermanentById(ctx: GameContext, permanentId: string): any | undefined {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return undefined;
  return battlefield.find((permanent: any) => String(permanent?.id || '') === normalizedPermanentId);
}

function snapshotPermanentForZoneChangeTrigger(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;

  return {
    id: String(permanent?.id || ''),
    controller: String(permanent?.controller || ''),
    owner: String(permanent?.owner || permanent?.controller || ''),
    tapped: permanent?.tapped === true,
    counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
    card: permanent?.card && typeof permanent.card === 'object'
      ? { ...(permanent.card as any) }
      : undefined,
  };
}

export function queueExiledFromBattlefieldTriggers(
  ctx: GameContext,
  exiledPermanent: any,
): any[] {
  if (!exiledPermanent?.id) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getExiledFromBattlefieldTriggers(ctx, exiledPermanent));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const triggerId = uid('trigger');
    const exiledPermanentId = String(exiledPermanent.id || '');
    const sourcePermanentSnapshot = snapshotPermanentForZoneChangeTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPermanent: exiledPermanentId,
      effectData: {
        exiledPermanentId,
        exiledPermanentName: String(exiledPermanent?.card?.name || 'Permanent'),
        exiledPermanentController: String(exiledPermanent?.controller || ''),
        exiledPermanentOwner: String(exiledPermanent?.owner || exiledPermanent?.controller || ''),
        exiledPermanentTypeLine: String(exiledPermanent?.card?.type_line || ''),
        wasToken: exiledPermanent?.isToken === true,
        fromZone: 'battlefield',
        toZone: 'exile',
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPermanent: exiledPermanentId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[zoneChangeTrigger] Failed to persist exiled-from-battlefield trigger:', err);
      }
    }
  }

  return queued;
}

export interface PutIntoGraveyardTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'card_put_into_graveyard';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  graveyardScope: 'your' | 'opponent' | 'player' | 'any';
  creatureCardOnly: boolean;
  nonblackOnly: boolean;
  excludesBattlefield: boolean;
}

export interface LeftGraveyardTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'card_left_graveyard';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  graveyardScope: 'your' | 'opponent' | 'player' | 'any';
  creatureCardOnly: boolean;
  oneOrMore: boolean;
}

export function detectPutIntoGraveyardTriggers(card: any, permanent: any): PutIntoGraveyardTrigger[] {
  const triggers: PutIntoGraveyardTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const yourGraveyardCreatureCardsFromAnywhereMatch = oracleText.match(
    /whenever one or more creature cards are put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (yourGraveyardCreatureCardsFromAnywhereMatch) {
    const effect = timingTriggerEffect(oracleText, yourGraveyardCreatureCardsFromAnywhereMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: yourGraveyardCreatureCardsFromAnywhereMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: true,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const landCardYourGraveyardFromLibraryMatch = oracleText.match(
    /whenever a land card is put into your graveyard from your library,?\s*([^.]+)/i,
  );
  if (landCardYourGraveyardFromLibraryMatch) {
    const effect = timingTriggerEffect(oracleText, landCardYourGraveyardFromLibraryMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: landCardYourGraveyardFromLibraryMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: false,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const landCardYourGraveyardFromAnywhereMatch = oracleText.match(
    /whenever a land card is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (landCardYourGraveyardFromAnywhereMatch) {
    const effect = timingTriggerEffect(oracleText, landCardYourGraveyardFromAnywhereMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: landCardYourGraveyardFromAnywhereMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: false,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const landCardGraveyardFromAnywhereMatch = oracleText.match(
    /whenever a land card is put into a graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (landCardGraveyardFromAnywhereMatch && !/put into your graveyard/i.test(oracleText)) {
    const effect = timingTriggerEffect(oracleText, landCardGraveyardFromAnywhereMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: landCardGraveyardFromAnywhereMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'any',
        creatureCardOnly: false,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const graveyardsFromAnywhereMatch = oracleText.match(
    /whenever one or more creature cards are put into graveyards from anywhere,?\s*([^.]+)/i,
  );
  if (graveyardsFromAnywhereMatch) {
    const effect = timingTriggerEffect(oracleText, graveyardsFromAnywhereMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: graveyardsFromAnywhereMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'any',
        creatureCardOnly: true,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const creatureCardOpponentGraveyardLibraryMatch = oracleText.match(
    /whenever a creature card is put into an opponent's graveyard from their library,?\s*([^.]+)/i,
  );
  if (creatureCardOpponentGraveyardLibraryMatch) {
    const effect = timingTriggerEffect(oracleText, creatureCardOpponentGraveyardLibraryMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: creatureCardOpponentGraveyardLibraryMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'opponent',
        creatureCardOnly: true,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const creatureCardOpponentGraveyardAnywhereMatch = oracleText.match(
    /whenever a creature card is put into an opponent's graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (creatureCardOpponentGraveyardAnywhereMatch) {
    const effect = timingTriggerEffect(oracleText, creatureCardOpponentGraveyardAnywhereMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: creatureCardOpponentGraveyardAnywhereMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'opponent',
        creatureCardOnly: true,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const permanentOpponentGraveyardMatch = oracleText.match(
    /whenever a permanent is put into an opponent's graveyard,?\s*([^.]+)/i,
  );
  if (permanentOpponentGraveyardMatch) {
    const effect = timingTriggerEffect(oracleText, permanentOpponentGraveyardMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: permanentOpponentGraveyardMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'opponent',
        creatureCardOnly: false,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const enchantedLandGraveyardMatch = oracleText.match(
    /whenever enchanted land is put into (?:a )?graveyard,?\s*([^.]+)/i,
  );
  if (enchantedLandGraveyardMatch) {
    const effect = timingTriggerEffect(oracleText, enchantedLandGraveyardMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: enchantedLandGraveyardMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'any',
        creatureCardOnly: false,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const nonBlackCreatureAnyGraveyardFromPlayMatch = oracleText.match(
    /whenever a non-black creature is put into any graveyard from play,?\s*([^.]+)/i,
  );
  if (nonBlackCreatureAnyGraveyardFromPlayMatch) {
    const effect = timingTriggerEffect(oracleText, nonBlackCreatureAnyGraveyardFromPlayMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: nonBlackCreatureAnyGraveyardFromPlayMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'any',
        creatureCardOnly: true,
        nonblackOnly: true,
        excludesBattlefield: false,
      });
    }
  }

  const fromPlayMatch = oracleText.match(
    /whenever a (non-?black )?creature is put into (?:a |any )?graveyard from play,?\s*([^.]+)/i,
  );
  if (fromPlayMatch) {
    const effect = timingTriggerEffect(oracleText, fromPlayMatch, 2);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: fromPlayMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'any',
        creatureCardOnly: false,
        nonblackOnly: Boolean(fromPlayMatch[1]),
        excludesBattlefield: false,
      });
    }
  }

  const powerFromBattlefieldMatch = oracleText.match(
    /whenever a creature with power (\d+) or less is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (powerFromBattlefieldMatch) {
    const effect = timingTriggerEffect(oracleText, powerFromBattlefieldMatch, 2);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: powerFromBattlefieldMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: true,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const fromLibraryMatch = oracleText.match(
    /whenever a land card is put into (?:a )?graveyard from your library,?\s*([^.]+)/i,
  );
  if (fromLibraryMatch) {
    const effect = timingTriggerEffect(oracleText, fromLibraryMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: fromLibraryMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: false,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  const matches = oracleText.matchAll(
    /(?:whenever|or) (?:a|one or more) ((?:nonblack\s+)?(?:creature\s+)?cards?) (?:is|are) put into (?:an opponent's|a player's|a|any|your )?graveyards? from anywhere( other than the battlefield)?,?\s*([^.]+)/gi,
  );
  for (const match of matches) {
    const subject = String(match[1] || '').toLowerCase();
    const clauseText = String(match[0] || '').toLowerCase();
    let effect = timingTriggerEffect(oracleText, match, 3).replace(/\s+/g, ' ');
    if (/^or\b/i.test(effect) && effect.includes(',')) {
      effect = effect.slice(effect.lastIndexOf(',') + 1).trim();
    }
    if (!effect) continue;

    const graveyardScope: PutIntoGraveyardTrigger['graveyardScope'] = clauseText.includes("opponent's")
      ? 'opponent'
      : clauseText.includes('your ')
        ? 'your'
        : clauseText.includes("player's")
          ? 'player'
          : 'any';

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'card_put_into_graveyard',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      graveyardScope,
      creatureCardOnly: /\bcreature\s+card/.test(subject),
      nonblackOnly: /\bnonblack\b/.test(subject),
      excludesBattlefield: Boolean(match[2]),
    });
  }

  const exileFromGraveyardMatch = oracleText.match(
    /whenever one or more (?:creatures and\/or )?cards? (?:is|are) put into exile from graveyards?,?\s*([^.]+)/i,
  );
  if (exileFromGraveyardMatch) {
    const effect = timingTriggerEffect(oracleText, exileFromGraveyardMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_put_into_graveyard',
        oracleClause: exileFromGraveyardMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'any',
        creatureCardOnly: false,
        nonblackOnly: false,
        excludesBattlefield: false,
      });
    }
  }

  return triggers;
}

function cardMatchesPutIntoGraveyardTrigger(card: any, trigger: PutIntoGraveyardTrigger): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (trigger.creatureCardOnly && !typeLine.includes('creature')) return false;

  if (trigger.nonblackOnly) {
    const colors = Array.isArray(card?.colors) ? card.colors.map((value: any) => String(value).toUpperCase()) : [];
    const colorIdentity = Array.isArray(card?.color_identity) ? card.color_identity.map((value: any) => String(value).toUpperCase()) : [];
    if (colors.includes('B') || (!colors.length && colorIdentity.includes('B'))) {
      return false;
    }
  }

  return true;
}

function graveyardScopeMatches(trigger: PutIntoGraveyardTrigger, sourceControllerId: string, graveyardOwnerId: string): boolean {
  switch (trigger.graveyardScope) {
    case 'opponent':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId !== graveyardOwnerId);
    case 'your':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId === graveyardOwnerId);
    case 'player':
    case 'any':
    default:
      return true;
  }
}

export function getPutIntoGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
  options?: { fromBattlefield?: boolean; controllerId?: string },
): PutIntoGraveyardTrigger[] {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const ownerId = String(graveyardOwnerId || '').trim();
  const triggers: PutIntoGraveyardTrigger[] = [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    for (const trigger of detectPutIntoGraveyardTriggers(permanent.card, permanent)) {
      if (trigger.excludesBattlefield && options?.fromBattlefield) continue;
      if (!cardMatchesPutIntoGraveyardTrigger(card, trigger)) continue;
      if (!graveyardScopeMatches(trigger, String(permanent.controller || ''), ownerId)) continue;

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        trigger.oracleClause,
        permanent,
        {
          thatCard: card,
          referencedCard: card,
          graveyardOwnerId: ownerId,
          targetPlayerId: ownerId,
          thatPlayerId: ownerId,
        } as any,
      );
      if (ok === false) continue;

      triggers.push(trigger);
    }
  }

  return triggers;
}

export function queuePutIntoGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
  options?: { fromBattlefield?: boolean; controllerId?: string },
): any[] {
  const ownerId = String(graveyardOwnerId || '').trim();
  if (!ownerId || !card) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getPutIntoGraveyardTriggers(ctx, ownerId, card, options));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = snapshotPermanentForZoneChangeTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      effectData: {
        graveyardCardId: String(card?.id || ''),
        graveyardCardName: String(card?.name || 'Card'),
        graveyardCardOwner: ownerId,
        graveyardCardController: String(options?.controllerId || ownerId),
        graveyardCardTypeLine: String(card?.type_line || ''),
        fromZone: options?.fromBattlefield ? 'battlefield' : 'nonbattlefield',
        toZone: 'graveyard',
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[zoneChangeTrigger] Failed to persist put-into-graveyard trigger:', err);
      }
    }
  }

  return queued;
}

export function detectLeftGraveyardTriggers(card: any, permanent: any): LeftGraveyardTrigger[] {
  const triggers: LeftGraveyardTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const landCardLeavesGyMatch = oracleText.match(/whenever a land card leaves your graveyard,?\s*([^.]+)/i);
  if (landCardLeavesGyMatch && !triggers.some((t) => t.oracleClause?.includes('land card leaves your graveyard'))) {
    const effect = timingTriggerEffect(oracleText, landCardLeavesGyMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_left_graveyard',
        oracleClause: landCardLeavesGyMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: false,
        oneOrMore: false,
      });
    }
  }

  const nonlandCardLeavesGyMatch = oracleText.match(/whenever a nonland card leaves your graveyard,?\s*([^.]+)/i);
  if (nonlandCardLeavesGyMatch && !triggers.some((t) => t.oracleClause?.includes('nonland card leaves your graveyard'))) {
    const effect = timingTriggerEffect(oracleText, nonlandCardLeavesGyMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_left_graveyard',
        oracleClause: nonlandCardLeavesGyMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: false,
        oneOrMore: false,
      });
    }
  }

  const artifactOrCreatureLeaveMatch = oracleText.match(
    /whenever one or more artifact and\/or creature cards leave your graveyard(?: during your turn)?,?\s*([^.]+)/i,
  );
  if (artifactOrCreatureLeaveMatch) {
    const effect = timingTriggerEffect(oracleText, artifactOrCreatureLeaveMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'card_left_graveyard',
        oracleClause: artifactOrCreatureLeaveMatch[0].trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        graveyardScope: 'your',
        creatureCardOnly: false,
        oneOrMore: true,
      });
    }
  }

  const matches = oracleText.matchAll(
    /(?:whenever|or) (a|one or more) ((?:creature\s+)?cards?) leaves? (an opponent's|a player's|a|any|your) graveyard,?\s*([^.]+)/gi,
  );

  for (const match of matches) {
    const countText = String(match[1] || '').toLowerCase();
    const subject = String(match[2] || '').toLowerCase();
    const scopeText = String(match[3] || '').toLowerCase();
    const effect = String(match[4] || '').trim().replace(/\s+/g, ' ');
    if (!effect) continue;

    const graveyardScope: LeftGraveyardTrigger['graveyardScope'] = scopeText.includes('opponent')
      ? 'opponent'
      : scopeText === 'your'
        ? 'your'
        : scopeText.includes('player')
          ? 'player'
          : 'any';

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'card_left_graveyard',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      graveyardScope,
      creatureCardOnly: /\bcreature\s+card/.test(subject),
      oneOrMore: countText === 'one or more',
    });
  }

  return triggers;
}

function graveyardLeftScopeMatches(trigger: LeftGraveyardTrigger, sourceControllerId: string, graveyardOwnerId: string): boolean {
  switch (trigger.graveyardScope) {
    case 'opponent':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId !== graveyardOwnerId);
    case 'your':
      return Boolean(sourceControllerId && graveyardOwnerId && sourceControllerId === graveyardOwnerId);
    case 'player':
    case 'any':
    default:
      return true;
  }
}

export function getLeftGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
): LeftGraveyardTrigger[] {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const ownerId = String(graveyardOwnerId || '').trim();
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  const triggers: LeftGraveyardTrigger[] = [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    for (const trigger of detectLeftGraveyardTriggers(permanent.card, permanent)) {
      if (trigger.creatureCardOnly && !typeLine.includes('creature')) continue;
      if (!graveyardLeftScopeMatches(trigger, String(permanent.controller || ''), ownerId)) continue;

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        trigger.oracleClause,
        permanent,
        {
          thatCard: card,
          referencedCard: card,
          graveyardOwnerId: ownerId,
          targetPlayerId: ownerId,
          thatPlayerId: ownerId,
        } as any,
      );
      if (ok === false) continue;

      triggers.push(trigger);
    }
  }

  return triggers;
}

export function queueLeftGraveyardTriggers(
  ctx: GameContext,
  graveyardOwnerId: string,
  card: any,
): any[] {
  const ownerId = String(graveyardOwnerId || '').trim();
  if (!ownerId || !card) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getLeftGraveyardTriggers(ctx, ownerId, card));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = snapshotPermanentForZoneChangeTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      effectData: {
        leftGraveyardCardId: String(card?.id || ''),
        leftGraveyardCardName: String(card?.name || 'Card'),
        leftGraveyardOwner: ownerId,
        leftGraveyardCardTypeLine: String(card?.type_line || card?.card?.type_line || ''),
        fromZone: 'graveyard',
        toZone: 'unknown',
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[zoneChangeTrigger] Failed to persist left-graveyard trigger:', err);
      }
    }
  }

  return queued;
}