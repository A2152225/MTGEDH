/**
 * socket/interaction-handlers/interactionGraveyardSpellCastTargeting.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: building the stack card for a graveyard cast (disturb back
 *   face included), deriving aura enchant restrictions, enumerating valid
 *   targets for a graveyard-cast spell, and queuing the TARGET_SELECTION step
 *   for it.
 * Public entry symbols: buildGraveyardCastSpellCard, normalizeSelectedTargetIds,
 *   queueGraveyardSpellCastTargetSelection.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { graveyardCardsAreUntargetable } from '../../state/modules/graveyardTargetingRestriction.js';
import { buildCastFromGraveyardCard } from "../../state/modules/graveyard-permissions.js";
import {
  canPermanentBeTargetedByPlayer,
  matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType,
  normalizeRequirementTargetType,
  parseTargetRequirements,
} from "../../rules-engine/targeting.js";
import { cardManaValue } from "../../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { persistQueuedGraveyardAbilityStepActivation } from "./interactionActivationEventPersistence.js";

function buildDisturbCastCard(card: any): any {
  const disturbFace = Array.isArray(card?.card_faces) ? card.card_faces[1] : undefined;
  const manaCost = disturbFace?.mana_cost ?? disturbFace?.manaCost ?? card?.mana_cost ?? card?.manaCost;
  return {
    ...card,
    ...(disturbFace || {}),
    id: card?.id,
    name: disturbFace?.name || card?.name,
    type_line: disturbFace?.type_line || disturbFace?.typeLine || card?.type_line,
    oracle_text: disturbFace?.oracle_text || disturbFace?.oracleText || card?.oracle_text,
    mana_cost: manaCost,
    manaCost,
    colors: Array.isArray(disturbFace?.colors) ? disturbFace.colors : card?.colors,
    image_uris: disturbFace?.image_uris || card?.image_uris,
    faceIndex: disturbFace ? 1 : (card?.faceIndex ?? 0),
    zone: 'stack',
    castWithAbility: 'disturb',
    transformed: true,
  };
}

export function buildGraveyardCastSpellCard(card: any, abilityId: string): any {
  if (String(abilityId || '').trim().toLowerCase() === 'disturb') {
    return buildDisturbCastCard(card);
  }

  return buildCastFromGraveyardCard(card, abilityId);
}

function getAuraEnchantTargeting(card: any): {
  auraTargetType: 'creature' | 'player' | 'opponent' | 'permanent' | 'artifact' | 'land' | 'enchantment';
  auraControllerRestriction: 'you_control' | 'opponent_controls' | 'any';
} | null {
  const typeLine = String(card?.type_line || '').toLowerCase();
  const oracleText = String(card?.oracle_text || '');
  if (!typeLine.includes('aura') || !/^enchant\s+/i.test(oracleText)) {
    return null;
  }

  const enchantMatch = oracleText.match(/enchant\s+(creature|player|opponent|permanent|artifact|land|enchantment)(?:\s+(you control|an opponent controls))?/i);
  if (!enchantMatch) {
    return null;
  }

  let auraControllerRestriction: 'you_control' | 'opponent_controls' | 'any' = 'any';
  const restriction = String(enchantMatch[2] || '').toLowerCase();
  if (restriction === 'you control') {
    auraControllerRestriction = 'you_control';
  } else if (restriction === 'an opponent controls') {
    auraControllerRestriction = 'opponent_controls';
  }

  return {
    auraTargetType: String(enchantMatch[1] || 'creature').toLowerCase() as 'creature' | 'player' | 'opponent' | 'permanent' | 'artifact' | 'land' | 'enchantment',
    auraControllerRestriction,
  };
}

function buildGraveyardAuraValidTargets(
  game: any,
  controllerId: string,
  auraTargetType: 'creature' | 'player' | 'opponent' | 'permanent' | 'artifact' | 'land' | 'enchantment',
  auraControllerRestriction: 'you_control' | 'opponent_controls' | 'any',
): Array<{ id: string; name: string; type: string; controller?: string; imageUrl?: string; life?: number; isOpponent?: boolean; typeLine?: string }> {
  const players = Array.isArray(game.state?.players) ? game.state.players : [];
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const lifeDict = game.state?.life || {};
  const startingLife = game.state?.startingLife || 40;

  if (auraTargetType === 'player') {
    return players
      .filter((player: any) => player?.id)
      .map((player: any) => ({
        id: String(player.id),
        name: player.name || String(player.id),
        type: 'player',
        life: lifeDict[player.id] ?? player.life ?? startingLife,
        isOpponent: String(player.id) !== controllerId,
      }));
  }

  if (auraTargetType === 'opponent') {
    return players
      .filter((player: any) => player?.id && String(player.id) !== controllerId)
      .map((player: any) => ({
        id: String(player.id),
        name: player.name || String(player.id),
        type: 'player',
        life: lifeDict[player.id] ?? player.life ?? startingLife,
        isOpponent: true,
      }));
  }

  return battlefield
    .filter((permanent: any) => {
      if (!permanent?.id || !permanent?.card) return false;
      if (!canPermanentBeTargetedByPlayer(permanent as any, game.state as any, controllerId as any)) return false;

      if (auraControllerRestriction === 'you_control' && String(permanent.controller || '') !== controllerId) return false;
      if (auraControllerRestriction === 'opponent_controls' && String(permanent.controller || '') === controllerId) return false;

      const typeLine = String(permanent.card?.type_line || '').toLowerCase();
      if (auraTargetType === 'permanent') return true;
      return typeLine.includes(auraTargetType);
    })
    .map((permanent: any) => ({
      id: String(permanent.id),
      name: permanent.card?.name || 'Permanent',
      type: 'permanent',
      controller: String(permanent.controller || ''),
      imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
      isOpponent: String(permanent.controller || '') !== controllerId,
      typeLine: permanent.card?.type_line,
    }));
}

export function normalizeSelectedTargetIds(targets: unknown): string[] {
  if (!Array.isArray(targets)) {
    return [];
  }

  return Array.from(new Set(
    targets
      .map((entry: any) => {
        if (typeof entry === 'string') return String(entry || '').trim();
        if (entry && typeof entry === 'object') return String((entry as any).id || '').trim();
        return '';
      })
      .filter(Boolean),
  ));
}

function buildGraveyardSpellCastValidTargets(
  game: any,
  controllerId: string,
  targetReqs: ReturnType<typeof parseTargetRequirements>,
): Array<{ id: string; name: string; type: string; controller?: string; zoneOwnerId?: string; imageUrl?: string; life?: number; isOpponent?: boolean; typeLine?: string }> {
  const validTargets: Array<{ id: string; name: string; type: string; controller?: string; zoneOwnerId?: string; imageUrl?: string; life?: number; isOpponent?: boolean; typeLine?: string }> = [];
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const players = Array.isArray(game.state?.players) ? game.state.players : [];
  const zones = game.state?.zones || {};
  const lifeDict = game.state?.life || {};
  const startingLife = game.state?.startingLife || 40;
  const targetControllerConstraint = String((targetReqs as any)?.targetControllerConstraint || 'any').toLowerCase();
  const targetFilterExcludeTypes = Array.isArray((targetReqs as any)?.targetFilterExcludeTypes)
    ? ((targetReqs as any).targetFilterExcludeTypes as any[]).map((value: any) => String(value || '').toLowerCase()).filter(Boolean)
    : [];

  const controllerMatches = (candidateController: string | undefined): boolean => {
    const normalizedController = String(candidateController || '').trim();
    if (!normalizedController) return targetControllerConstraint === 'any';
    if (targetControllerConstraint === 'you') return normalizedController === controllerId;
    if (targetControllerConstraint === 'opponent') return normalizedController !== controllerId;
    return true;
  };

  for (const rawTargetType of targetReqs.targetTypes || []) {
    const targetType = normalizeRequirementTargetType(String(rawTargetType || ''));
    switch (targetType) {
      case 'creature':
      case 'permanent':
      case 'artifact':
      case 'enchantment':
      case 'planeswalker':
      case 'land':
      case 'nonland permanent':
      case 'nonland_permanent':
      case 'nonland':
      case 'noncreature':
      case 'noncreature permanent':
        validTargets.push(...battlefield
          .filter((permanent: any) => {
            if (!permanent?.id || !permanent?.card) return false;
            if (!controllerMatches(String(permanent.controller || ''))) return false;
            if (!canPermanentBeTargetedByPlayer(permanent as any, game.state as any, controllerId as any)) return false;

            const typeLine = String(permanent.card?.type_line || '').toLowerCase();
            if (targetFilterExcludeTypes.length > 0 && targetFilterExcludeTypes.some((typeWord) => typeLine.includes(typeWord))) {
              return false;
            }
            if (targetType === 'permanent') return true;
            if (targetType === 'nonland' || targetType === 'nonland permanent' || targetType === 'nonland_permanent') return !typeLine.includes('land');
            if (targetType === 'noncreature' || targetType === 'noncreature permanent') return !typeLine.includes('creature');
            return typeLine.includes(targetType);
          })
          .map((permanent: any) => ({
            id: String(permanent.id),
            name: permanent.card?.name || 'Permanent',
            type: 'permanent',
            controller: String(permanent.controller || ''),
            imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
            isOpponent: String(permanent.controller || '') !== controllerId,
            typeLine: permanent.card?.type_line,
          })));
        break;
      case 'player':
      case 'opponent':
        validTargets.push(...players
          .filter((player: any) => player?.id)
          .filter((player: any) => targetType !== 'opponent' || String(player.id) !== controllerId)
          .map((player: any) => ({
            id: String(player.id),
            name: player.name || String(player.id),
            type: 'player',
            life: lifeDict[player.id] ?? player.life ?? startingLife,
            isOpponent: String(player.id) !== controllerId,
          })));
        break;
      case 'spell':
        validTargets.push(...((Array.isArray(game.state?.stack) ? game.state.stack : [])
          .filter((item: any) => item?.card)
          .map((item: any) => ({
            id: String(item.id),
            name: item.card?.name || item.sourceName || 'Spell',
            type: 'card',
            controller: String(item.controller || ''),
            imageUrl: item.card?.image_uris?.small || item.card?.image_uris?.normal,
            isOpponent: String(item.controller || '') !== controllerId,
            typeLine: item.card?.type_line,
          }))));
        break;
      case 'ability':
        validTargets.push(...((Array.isArray(game.state?.stack) ? game.state.stack : [])
          .filter((item: any) => item?.type === 'ability' || item?.type === 'triggered_ability' || item?.type === 'activated_ability')
          .map((item: any) => ({
            id: String(item.id),
            name: item.sourceName || item.description || 'Ability',
            type: 'card',
            controller: String(item.controller || ''),
            imageUrl: item.sourceImage || item.imageUrl,
            isOpponent: String(item.controller || '') !== controllerId,
            typeLine: item.type,
          }))));
        break;
      case 'any':
        validTargets.push(...battlefield
          .filter((permanent: any) => {
            if (!permanent?.id || !permanent?.card) return false;
            if (!controllerMatches(String(permanent.controller || ''))) return false;
            if (!canPermanentBeTargetedByPlayer(permanent as any, game.state as any, controllerId as any)) return false;
            const typeLine = String(permanent.card?.type_line || '').toLowerCase();
            return typeLine.includes('creature') || typeLine.includes('planeswalker');
          })
          .map((permanent: any) => ({
            id: String(permanent.id),
            name: permanent.card?.name || 'Permanent',
            type: 'permanent',
            controller: String(permanent.controller || ''),
            imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
            isOpponent: String(permanent.controller || '') !== controllerId,
            typeLine: permanent.card?.type_line,
          })));
        validTargets.push(...players
          .filter((player: any) => player?.id)
          .map((player: any) => ({
            id: String(player.id),
            name: player.name || String(player.id),
            type: 'player',
            life: lifeDict[player.id] ?? player.life ?? startingLife,
            isOpponent: String(player.id) !== controllerId,
          })));
        break;
      default:
        if (!targetType.startsWith('graveyard_')) {
          break;
        }

        for (const ownerId of (targetReqs.graveyardScope === 'any'
          ? players.filter((player: any) => player?.id).map((player: any) => String(player.id))
          : [controllerId])) {
          const graveyard = graveyardCardsAreUntargetable(game.state, String(controllerId), String(ownerId)) ? [] : (Array.isArray(zones?.[ownerId]?.graveyard) ? zones[ownerId].graveyard : []);
          validTargets.push(...graveyard
            .filter((card: any) => {
              if (!matchesSharedGraveyardCardTargetType(card, targetType)) {
                return false;
              }
              if (typeof (targetReqs as any).targetFilterExactManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterExactManaValue)) {
                if (cardManaValue(card) !== Number((targetReqs as any).targetFilterExactManaValue)) {
                  return false;
                }
              }
              if (typeof (targetReqs as any).targetFilterMinManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMinManaValue)) {
                if (cardManaValue(card) < Number((targetReqs as any).targetFilterMinManaValue)) {
                  return false;
                }
              }
              if (typeof (targetReqs as any).targetFilterMaxManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMaxManaValue)) {
                if (cardManaValue(card) > Number((targetReqs as any).targetFilterMaxManaValue)) {
                  return false;
                }
              }
              return true;
            })
            .map((card: any) => ({
              id: String(card.id),
              name: card.name || 'Card',
              type: 'graveyard_card',
              controller: ownerId,
              zoneOwnerId: ownerId,
              imageUrl: card.image_uris?.small || card.image_uris?.normal,
              isOpponent: ownerId !== controllerId,
              typeLine: card.type_line,
            })));
        }
        break;
    }
  }

  return validTargets.filter((target, index, all) => all.findIndex((candidate) => candidate.id === target.id) === index);
}

export function queueGraveyardSpellCastTargetSelection(params: {
  gameId: string;
  game: any;
  playerId: string;
  cardId: string;
  abilityId: string;
  card: any;
  manaCost?: string;
  lifeToPayForCost?: number;
  discardedCardIdsForCost?: string[];
  exiledCardIdsFromHandForCost?: string[];
  exiledCardIdsFromGraveyardForCost?: string[];
  sacrificedPermanentIdsForCost?: string[];
  xValue?: number;
  emitError: (payload: { code: string; message: string }) => void;
}): 'queued' | 'error' | null {
  const spellCard = buildGraveyardCastSpellCard(params.card, params.abilityId);
  const cardName = String(spellCard?.name || params.card?.name || 'Spell');
  const auraTargeting = getAuraEnchantTargeting(spellCard);

  let minTargets = 1;
  let maxTargets = 1;
  let targetDescription = 'target';
  let targetTypes: string[] = ['spell_target'];
  let validTargets: Array<{ id: string; name: string; type: string; controller?: string; zoneOwnerId?: string; imageUrl?: string; life?: number; isOpponent?: boolean; typeLine?: string }> = [];

  if (auraTargeting) {
    targetDescription = `Enchant ${auraTargeting.auraTargetType}`;
    targetTypes = ['aura_target'];
    validTargets = buildGraveyardAuraValidTargets(
      params.game,
      String(params.playerId),
      auraTargeting.auraTargetType,
      auraTargeting.auraControllerRestriction,
    );
  } else {
    const targetReqs = parseTargetRequirements(String(spellCard?.oracle_text || ''), {
      gameState: params.game.state,
      controllerId: String(params.playerId),
      sourceName: cardName,
    });
    if (!targetReqs.needsTargets) {
      return null;
    }

    minTargets = Number(targetReqs.minTargets ?? 1);
    maxTargets = Number(targetReqs.maxTargets ?? minTargets);
    targetDescription = String(targetReqs.targetDescription || 'target');
    targetTypes = Array.isArray(targetReqs.targetTypes) ? targetReqs.targetTypes : ['spell_target'];
    validTargets = buildGraveyardSpellCastValidTargets(params.game, String(params.playerId), targetReqs);
  }

  if (validTargets.length < minTargets) {
    params.emitError({
      code: 'NO_VALID_TARGETS',
      message: `${cardName} requires at least ${minTargets} target(s), but only ${validTargets.length} are available.`,
    });
    return 'error';
  }

  const existing = ResolutionQueueManager
    .getStepsForPlayer(params.gameId, params.playerId as any)
    .find((step: any) =>
      step?.type === ResolutionStepType.TARGET_SELECTION
      && (step as any)?.graveyardSpellCastTargetSelection === true
      && String((step as any)?.cardId || step?.sourceId || '') === String(params.cardId)
    );
  if (!existing) {
    const targetStep = ResolutionQueueManager.addStep(params.gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: params.playerId as PlayerID,
      sourceId: params.cardId,
      sourceName: cardName,
      sourceImage: spellCard?.image_uris?.small || spellCard?.image_uris?.normal || params.card?.image_uris?.small || params.card?.image_uris?.normal,
      description: `Choose ${targetDescription} for ${cardName}`,
      mandatory: minTargets > 0,
      validTargets: validTargets.map((target) => ({
        id: target.id,
        label: target.name,
        description: target.typeLine || target.type,
        imageUrl: target.imageUrl,
        type: target.type === 'player' ? 'player' : (target.type === 'card' ? 'card' : 'permanent'),
        controller: target.controller,
        life: target.life,
        isOpponent: target.isOpponent,
        typeLine: target.typeLine,
        zoneOwnerId: target.zoneOwnerId,
      })),
      targetTypes,
      minTargets,
      maxTargets,
      targetDescription,
      graveyardSpellCastTargetSelection: true,
      cardId: params.cardId,
      abilityId: params.abilityId,
      cardName,
      manaCost: params.manaCost || undefined,
      lifeToPayForCost: Number(params.lifeToPayForCost || 0) > 0 ? Number(params.lifeToPayForCost || 0) : undefined,
      discardedCardIdsForCost: Array.isArray(params.discardedCardIdsForCost) && params.discardedCardIdsForCost.length > 0
        ? params.discardedCardIdsForCost.slice()
        : undefined,
      exiledCardIdsFromHandForCost: Array.isArray(params.exiledCardIdsFromHandForCost) && params.exiledCardIdsFromHandForCost.length > 0
        ? params.exiledCardIdsFromHandForCost.slice()
        : undefined,
      exiledCardIdsFromGraveyardForCost: Array.isArray(params.exiledCardIdsFromGraveyardForCost) && params.exiledCardIdsFromGraveyardForCost.length > 0
        ? params.exiledCardIdsFromGraveyardForCost.slice()
        : undefined,
      sacrificedPermanentIdsForCost: Array.isArray(params.sacrificedPermanentIdsForCost) && params.sacrificedPermanentIdsForCost.length > 0
        ? params.sacrificedPermanentIdsForCost.slice()
        : undefined,
      xValue: Number.isFinite(Number(params.xValue)) ? Math.max(0, Math.floor(Number(params.xValue))) : undefined,
    } as any);

    persistQueuedGraveyardAbilityStepActivation({
      gameId: params.gameId,
      game: params.game,
      playerId: String(params.playerId),
      cardId: String(params.cardId),
      abilityId: String(params.abilityId),
      queuedStep: {
        ...(targetStep as any),
      },
    });
  }

  return 'queued';
}
