/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: turning a spell's parsed target requirements into the target
 * list, grouped metadata and per-clause selection prompts the client renders,
 * plus the target-type matching helpers and oracle clause splitting they rely on.
 *
 * Public entry symbols: buildSpellTargetListFromRequirements,
 * buildGroupedSpellTargetMetadata, buildSpellTargetSelectionClauses,
 * mapSpellTargetRefToDisplay, shouldPreferParsedTargetReqs (re-export),
 * resolveTargetCount.
 */
import type { PlayerID } from "../../../../shared/src/index.js";
import { normalizeGameplayEffectText } from "../../../../rules-engine/src/oracleReminderText.js";
import {
  canPermanentBeTargetedByPlayer,
  canPlayerBeTargetedByPlayer,
  evaluateTargeting,
  matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType,
} from "../../rules-engine/targeting";
import { permanentMatchesTargetRequirementStatKeywordFilters } from "../../rules-engine/targeting-handlers/targetingParseTargetRequirementRestrictions.js";
import { stackItemMeetsSingleTargetRequirement } from "../../rules-engine/targeting-handlers/targetingStackObjectSingleTarget.js";
import { cardManaValue } from "../../state/utils";
import { resolveCastSpellParsedTargeting } from "./gameActionsCastSpellParsedTargeting.js";

export { shouldPreferParsedTargetReqs } from "./gameActionsCastSpellParsedTargeting.js";

export function resolveTargetCount(baseCount: number | undefined, countIsX: boolean | undefined, xValue?: number): number {
  if (countIsX) {
    return Number.isFinite(xValue) ? Math.max(0, Math.floor(Number(xValue))) : 0;
  }
  return Math.max(0, Number(baseCount ?? 0));
}

export function mapSpellTargetRefToDisplay(game: any, playerId: string, targetRef: any): any {
  if (targetRef?.kind === 'permanent') {
    const permanent = (game.state.battlefield || []).find((entry: any) => entry.id === targetRef.id);
    return {
      id: targetRef.id,
      kind: targetRef.kind,
      name: permanent?.card?.name || 'Unknown',
      imageUrl: permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal,
      controller: permanent?.controller,
      typeLine: permanent?.card?.type_line,
      isOpponent: permanent?.controller !== playerId,
    };
  }

  if (targetRef?.kind === 'stack') {
    const stackItem = (game.state.stack || []).find((entry: any) => entry.id === targetRef.id);
    return {
      id: targetRef.id,
      kind: targetRef.kind,
      name: stackItem?.card?.name || stackItem?.sourceName || stackItem?.description || 'Unknown Spell or Ability',
      imageUrl: stackItem?.card?.image_uris?.small || stackItem?.card?.image_uris?.normal || stackItem?.sourceImage || stackItem?.imageUrl,
      controller: stackItem?.controller,
      typeLine: stackItem?.card?.type_line || stackItem?.type,
      isOpponent: stackItem?.controller !== playerId,
    };
  }

  const player = (game.state.players || []).find((entry: any) => entry.id === targetRef?.id);
  return {
    id: targetRef?.id,
    kind: targetRef?.kind,
    name: player?.name || targetRef?.id,
    life: player?.life,
    isOpponent: targetRef?.id !== playerId,
  };
}

function splitSpellTargetClauses(oracleText: string): string[] {
  const normalized = normalizeGameplayEffectText(
    String(oracleText || '')
      .replace(/[�]/g, "'")
      .replace(/[-��]/g, '-')
      .replace(/\r\n?/g, '\n')
      .trim(),
  );

  if (!normalized) return [];

  return normalized
    .split(/\n+/)
    .map((line) => line.replace(/^(?:�|\*|-)\s*/, '').trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/(?<=[.;])\s+/))
    .flatMap((chunk) => chunk.split(/\bthen\b/i).map((part, index) => (index === 0 ? part : `then ${part}`).trim()))
    .map((chunk) => chunk.replace(/[.;]\s*$/g, '').trim())
    .filter(Boolean);
}

function expandEmbeddedTargetClauses(clauseText: string): string[] {
  const normalized = String(clauseText || '').trim();
  if (!normalized) {
    return [];
  }

  const donateMatch = normalized.match(/target\s+(opponent|player)\s+gains\s+control\s+of\s+target\s+([^.]+)$/i);
  if (donateMatch) {
    return [
      `target ${String(donateMatch[1] || '').trim()}`,
      `target ${String(donateMatch[2] || '').trim()}`,
    ];
  }

  const exchangeMatch = normalized.match(/exchange\s+control\s+of\s+target\s+(.+?)\s+and\s+target\s+([^.]+)$/i);
  if (exchangeMatch) {
    return [
      `target ${String(exchangeMatch[1] || '').trim()}`,
      `target ${String(exchangeMatch[2] || '').trim()}`,
    ];
  }

  return [normalized];
}

function normalizeRequirementTargetType(rawTargetType: string | undefined): string {
  return String(rawTargetType || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\bthat share a card type\b/g, ' ')
    .replace(/\bthat player controls\b/g, ' ')
    .replace(/\byou control\b/g, ' ')
    .replace(/\ban opponent controls\b/g, ' ')
    .replace(/\bwith different controllers\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^nonland permanents?$/g, 'nonland permanent')
    .replace(/^noncreature permanents?$/g, 'noncreature permanent')
    .replace(/^creatures?$/g, 'creature')
    .replace(/^permanents?$/g, 'permanent')
    .replace(/^artifacts?$/g, 'artifact')
    .replace(/^enchantments?$/g, 'enchantment')
    .replace(/^lands?$/g, 'land')
    .replace(/^battles?$/g, 'battle')
    .replace(/^planeswalkers?$/g, 'planeswalker');
}

function isRequirementStackSpellTargetType(targetTypeLower: string): boolean {
  const normalized = String(targetTypeLower || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'spell') return true;
  return (
    normalized.endsWith(' spell')
    || normalized.includes(' spell')
    || /\b(?:instant|sorcery)\b/.test(normalized) && !normalized.includes('permanent')
  );
}

function stackItemMatchesSpellTargetType(stackItem: any, targetTypeLower: string): boolean {
  if (!stackItem) return false;
  if (
    stackItem.type === 'ability'
    || stackItem.type === 'triggered_ability'
    || stackItem.type === 'activated_ability'
    || stackItem.type === 'mana_ability'
  ) {
    return false;
  }
  if (stackItem.canBeCountered === false || stackItem.cantBeCountered === true) {
    return false;
  }

  const typeLine = String(stackItem?.card?.type_line || '').toLowerCase();
  const normalized = String(targetTypeLower || '').trim().toLowerCase();
  if (normalized === 'spell') return true;
  if (normalized.includes('noncreature')) return !typeLine.includes('creature');
  if (normalized.includes('creature spell') || normalized === 'creature spell') return typeLine.includes('creature');
  if (normalized.includes('instant or sorcery')) {
    return typeLine.includes('instant') || typeLine.includes('sorcery');
  }
  if (normalized.includes('instant')) return typeLine.includes('instant');
  if (normalized.includes('sorcery')) return typeLine.includes('sorcery');
  return true;
}

function matchesSpellGraveyardCardTargetType(card: any, targetType: string): boolean {
  return matchesSharedGraveyardCardTargetType(card, targetType);
}

/** Exported for counterspell / stack-target unit tests. */
export function buildSpellTargetListFromRequirements(game: any, playerId: string, targetReqs: any): Array<{ id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string; typeLine?: string; life?: number }> {
  const validTargetList: Array<{ id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string; typeLine?: string; life?: number }> = [];
  const targetControllerConstraint = String(targetReqs?.targetControllerConstraint || 'any').toLowerCase();

  for (const rawTargetType of Array.isArray(targetReqs?.targetTypes) ? targetReqs.targetTypes : []) {
    const targetTypeLower = normalizeRequirementTargetType(rawTargetType);

    // Stack spells must be checked before battlefield "noncreature"/"nonland" substring matches.
    if (isRequirementStackSpellTargetType(targetTypeLower) || targetTypeLower === 'spell') {
      const stackItems = (game.state.stack || []).filter((entry: any) =>
        stackItemMatchesSpellTargetType(entry, targetTypeLower)
        && stackItemMeetsSingleTargetRequirement(entry, targetReqs)
      );
      for (const item of stackItems) {
        validTargetList.push({
          id: item.id,
          kind: 'stack',
          name: item.card?.name || item.sourceName || 'Unknown Spell',
          imageUrl: item.card?.image_uris?.small || item.card?.image_uris?.normal,
          controller: item.controller,
          isOpponent: item.controller !== playerId,
          typeLine: item.card?.type_line || 'Spell on the stack',
        });
      }
      continue;
    }

    if (targetTypeLower === 'creature' || targetTypeLower === 'permanent' || targetTypeLower === 'artifact' ||
        targetTypeLower === 'enchantment' || targetTypeLower === 'land' || targetTypeLower === 'planeswalker' ||
        targetTypeLower === 'battle' ||
        targetTypeLower === 'nonland permanent' || targetTypeLower === 'noncreature permanent' ||
        ((targetTypeLower.includes('nonland') || targetTypeLower.includes('noncreature')) && !targetTypeLower.includes('spell'))) {
      const permanents = (game.state.battlefield || []).filter((permanent: any) => {
        const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
        if (targetControllerConstraint === 'you' && String(permanent?.controller || '') !== playerId) return false;
        if (targetControllerConstraint === 'opponent' && String(permanent?.controller || '') === playerId) return false;
        const excludedTypes = Array.isArray(targetReqs?.targetFilterExcludeTypes)
          ? targetReqs.targetFilterExcludeTypes.map((type: unknown) => String(type || '').toLowerCase())
          : [];
        if (excludedTypes.some((type: string) => type && typeLine.includes(type))) return false;
        let typeMatches = false;
        if (targetTypeLower === 'permanent') typeMatches = true;
        else if (targetTypeLower.includes('nonland')) typeMatches = !typeLine.includes('land');
        else if (targetTypeLower.includes('noncreature')) typeMatches = !typeLine.includes('creature');
        else typeMatches = typeLine.includes(targetTypeLower);
        if (!typeMatches) return false;
        return permanentMatchesTargetRequirementStatKeywordFilters(permanent, game.state, targetReqs, playerId);
      });

      for (const permanent of permanents) {
        if (!canPermanentBeTargetedByPlayer(permanent, game.state, playerId as PlayerID)) {
          continue;
        }
        validTargetList.push({
          id: permanent.id,
          kind: 'permanent',
          name: permanent.card?.name || 'Unknown',
          imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
          controller: permanent.controller,
          isOpponent: permanent.controller !== playerId,
          typeLine: permanent.card?.type_line,
        });
      }
      continue;
    }

    if (targetTypeLower === 'player' || targetTypeLower === 'opponent' || targetTypeLower === 'any') {
      const players = (game.state.players || []).filter((player: any) => {
        if (targetTypeLower === 'opponent' && player.id === playerId) return false;
        if (targetControllerConstraint === 'opponent' && player.id === playerId) return false;
        if (!canPlayerBeTargetedByPlayer(player.id, game.state, playerId as PlayerID)) return false;
        return true;
      });
      for (const player of players) {
        validTargetList.push({
          id: player.id,
          kind: 'player',
          name: player.name || player.id,
          isOpponent: player.id !== playerId,
          life: player.life,
        });
      }

      if (targetTypeLower === 'any') {
        const permanents = (game.state.battlefield || []).filter((permanent: any) => {
          const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
          return typeLine.includes('creature') || typeLine.includes('planeswalker');
        });

        for (const permanent of permanents) {
          if (!canPermanentBeTargetedByPlayer(permanent, game.state, playerId as PlayerID)) {
            continue;
          }
          validTargetList.push({
            id: permanent.id,
            kind: 'permanent',
            name: permanent.card?.name || 'Unknown',
            imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
            controller: permanent.controller,
            isOpponent: permanent.controller !== playerId,
            typeLine: permanent.card?.type_line,
          });
        }
      }
      continue;
    }

    if (targetTypeLower.startsWith('graveyard_')) {
      const graveyardOwnerIds = (targetReqs?.graveyardScope === 'any'
        ? (game.state.players || []).filter((player: any) => player?.id).map((player: any) => String(player.id))
        : [String(playerId)]) as string[];

      for (const ownerId of graveyardOwnerIds) {
        const graveyard = Array.isArray((game.state?.zones || {})?.[ownerId]?.graveyard)
          ? game.state.zones[ownerId].graveyard
          : [];

        for (const card of graveyard) {
          if (!matchesSpellGraveyardCardTargetType(card, targetTypeLower)) {
            continue;
          }
          if (typeof targetReqs?.targetFilterExactManaValue === 'number' && Number.isFinite(targetReqs.targetFilterExactManaValue)) {
            if (cardManaValue(card) !== Number(targetReqs.targetFilterExactManaValue)) {
              continue;
            }
          }
          if (typeof targetReqs?.targetFilterMinManaValue === 'number' && Number.isFinite(targetReqs.targetFilterMinManaValue)) {
            if (cardManaValue(card) < Number(targetReqs.targetFilterMinManaValue)) {
              continue;
            }
          }
          if (typeof targetReqs?.targetFilterMaxManaValue === 'number' && Number.isFinite(targetReqs.targetFilterMaxManaValue)) {
            if (cardManaValue(card) > Number(targetReqs.targetFilterMaxManaValue)) {
              continue;
            }
          }

          validTargetList.push({
            id: String(card.id),
            kind: 'graveyard_card',
            name: card.name || 'Card',
            imageUrl: card.image_uris?.small || card.image_uris?.normal,
            controller: ownerId,
            isOpponent: ownerId !== playerId,
            typeLine: card.type_line,
          });
        }
      }
      continue;
    }

    if (targetTypeLower === 'ability') {
      const stackItems = (game.state.stack || []).filter((entry: any) =>
        (entry?.type === 'ability' || entry?.type === 'triggered_ability' || entry?.type === 'activated_ability')
        && stackItemMeetsSingleTargetRequirement(entry, targetReqs)
      );
      for (const item of stackItems) {
        validTargetList.push({
          id: item.id,
          kind: 'stack',
          name: item.sourceName || item.description || 'Ability',
          imageUrl: item.sourceImage || item.imageUrl,
          controller: item.controller,
          isOpponent: item.controller !== playerId,
          typeLine: item.type,
        });
      }
    }
  }

  return validTargetList.filter((target, index, all) => all.findIndex((candidate) => String(candidate.id) === String(target.id)) === index);
}

export function buildGroupedSpellTargetMetadata(
  game: any,
  casterId: string,
  targetReqs: any,
  validTargets: readonly any[],
): { metadata?: any; missingRequiredPlayerIds: string[] } {
  const requirement = targetReqs?.groupedTargets;
  if (!requirement || requirement.groupBy !== 'controller') {
    return { missingRequiredPlayerIds: [] };
  }

  const eligiblePlayers = (Array.isArray(game?.state?.players) ? game.state.players : [])
    .filter((player: any) =>
      player?.id &&
      !player.spectator &&
      !player.isSpectator &&
      !player.hasLost &&
      !player.eliminated &&
      !player.conceded &&
      (requirement.groupPlayers !== 'each_opponent' || String(player.id) !== String(casterId)),
    );
  const scopedPlayers = Number.isFinite(requirement.maxGroups)
    ? eligiblePlayers.slice(0, Math.max(0, Number(requirement.maxGroups)))
    : eligiblePlayers;
  const minTargetsPerGroup = Math.max(0, Number(requirement.minTargetsPerGroup ?? 0));
  const maxTargetsPerGroup = Math.max(minTargetsPerGroup, Number(requirement.maxTargetsPerGroup ?? 1));
  const groups = scopedPlayers.map((player: any) => {
    const targets = validTargets
      .filter((target: any) => String(target?.controller || '') === String(player.id))
      .map((target: any) => ({
        id: String(target.id),
        label: target.name || target.label || 'Target',
        description: target.kind || target.description || 'permanent',
        imageUrl: target.imageUrl,
        type: target.kind === 'player' ? 'player' : (target.kind === 'stack' ? 'stack' : 'permanent'),
        controller: String(player.id),
        typeLine: target.typeLine,
        life: target.life,
        isOpponent: String(player.id) !== String(casterId),
      }));
    return {
      playerId: String(player.id),
      label: String(player.name || player.id),
      required: minTargetsPerGroup > 0,
      minTargets: minTargetsPerGroup,
      maxTargets: maxTargetsPerGroup,
      targets,
    };
  });
  const missingRequiredPlayerIds = groups
    .filter((group: any) => group.required && group.targets.length < group.minTargets)
    .map((group: any) => group.playerId);

  return {
    metadata: {
      groupBy: 'controller',
      groupPlayers: requirement.groupPlayers,
      minTargetsPerGroup,
      maxTargetsPerGroup,
      ...(Number.isFinite(requirement.maxGroups) ? { maxGroups: Number(requirement.maxGroups) } : {}),
      groups,
    },
    missingRequiredPlayerIds,
  };
}

export function buildSpellTargetSelectionClauses(
  game: any,
  playerId: string,
  cardName: string,
  oracleText: string,
  xValue?: number,
): Array<{
  clauseText: string;
  validTargetList: Array<{ id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string; typeLine?: string; life?: number }>;
  minTargets: number;
  maxTargets: number;
  targetDescription: string;
}> {
  const clauses = splitSpellTargetClauses(oracleText).flatMap((clauseText) => expandEmbeddedTargetClauses(clauseText));
  const targetClauses: Array<{
    clauseText: string;
    validTargetList: Array<{ id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string; typeLine?: string; life?: number }>;
    minTargets: number;
    maxTargets: number;
    targetDescription: string;
  }> = [];

  for (const clauseText of clauses) {
    const { spellSpec, targetReqs, preferParsedTargetReqs } = resolveCastSpellParsedTargeting({
      cardName,
      oracleText: clauseText,
      xValue,
      gameState: game.state,
      controllerId: String(playerId),
    });
    const minTargets = spellSpec && !preferParsedTargetReqs
      ? resolveTargetCount(spellSpec.minTargets, (spellSpec as any).minTargetsIsX === true, xValue)
      : resolveTargetCount(targetReqs?.minTargets, (targetReqs as any)?.minTargetsIsX === true, xValue);
    const maxTargets = spellSpec && !preferParsedTargetReqs
      ? resolveTargetCount(spellSpec.maxTargets, (spellSpec as any).maxTargetsIsX === true, xValue)
      : resolveTargetCount(targetReqs?.maxTargets, (targetReqs as any)?.maxTargetsIsX === true, xValue);

    if (targetReqs?.perOpponent) {
      return [];
    }

    const needsTargets = spellSpec && !preferParsedTargetReqs ? maxTargets > 0 : Boolean(targetReqs?.needsTargets) && maxTargets > 0;
    if (!needsTargets) continue;

    const validTargetList = spellSpec && !preferParsedTargetReqs
      ? evaluateTargeting(game.state as any, playerId, spellSpec).map((targetRef: any) => mapSpellTargetRefToDisplay(game, playerId, targetRef))
      : buildSpellTargetListFromRequirements(game, playerId, targetReqs);

    if (validTargetList.length === 0 && minTargets === 0) continue;

    targetClauses.push({
      clauseText,
      validTargetList,
      minTargets,
      maxTargets,
      targetDescription: preferParsedTargetReqs
        ? targetReqs?.targetDescription || spellSpec?.targetDescription || 'target'
        : spellSpec?.targetDescription || targetReqs?.targetDescription || 'target',
    });
  }

  return targetClauses.length > 1 ? targetClauses : [];
}
