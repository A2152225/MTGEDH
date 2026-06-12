import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { canPermanentBeTargetedByPlayer, requiresTargeting } from '../../rules-engine/targeting.js';
import { debug } from '../../utils/debug.js';
import { shouldExileStackCardInsteadOfGraveyard } from './stack-zone-replacements.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';

export type StackTargetLocation = 'battlefield' | 'player' | 'stack' | 'graveyard' | 'exile' | 'hand';

export function getStackTargetId(target: any): string {
  if (typeof target === 'string') return target.trim();
  return String(target?.id || target?.targetId || target?.permanentId || target?.cardId || '').trim();
}

export function getStackTargetKind(target: any): string {
  if (!target || typeof target === 'string') return '';
  return String(target.kind || target.type || target.zone || '').trim().toLowerCase();
}

export function inferStackTargetLocations(oracleText: string): Set<StackTargetLocation> {
  const normalized = String(oracleText || '').toLowerCase();
  const locations = new Set<StackTargetLocation>();

  if (/\bany target\b/.test(normalized)) {
    locations.add('battlefield');
    locations.add('player');
  }

  if (/\btarget\s+(?:opponent|player)\b/.test(normalized)) {
    locations.add('player');
  }

  if (
    /\btarget\s+(?:(?:noncreature|creature|instant|sorcery|artifact|enchantment)\s+)?spell\b/.test(normalized) ||
    /\btarget\s+(?:activated|triggered)?\s*ability\b/.test(normalized)
  ) {
    locations.add('stack');
  }

  // "Copy target instant or sorcery spell you control" — instant/sorcery are two words before spell.
  if (/\btarget\s+instant\s+or\s+sorcery\s+spell\b/.test(normalized)) {
    locations.add('stack');
  }

  // Battlefield bounce: "return target creature to its owner's hand" targets a permanent, not a hand card.
  if (
    /\breturn\s+(?:up to \w+\s+)?target\b/.test(normalized) &&
    /\bto\s+(?:its owner's|their owner's|that permanent's owner's|the)\s+(?:hand|library)\b/.test(normalized) &&
    !/\btarget\b[^.]*\b(?:from|in)\b[^.]*\b(?:graveyard|hand|exile)\b/.test(normalized)
  ) {
    locations.add('battlefield');
    return locations;
  }

  if (/\btarget\b[^.]*\b(?:from|in)\b[^.]*\bgraveyard\b/.test(normalized)) {
    locations.add('graveyard');
  }

  if (/\btarget\b[^.]*\b(?:from|in)\b[^.]*\bexile\b/.test(normalized)) {
    locations.add('exile');
  }

  if (/\btarget\b[^.]*\b(?:from|in)\b[^.]*\bhand\b/.test(normalized)) {
    locations.add('hand');
  }

  if (locations.size === 0 && /\btarget\b/.test(normalized)) {
    locations.add('battlefield');
  }

  return locations;
}

function zoneContainsCardId(state: any, zoneName: StackTargetLocation, cardId: string): boolean {
  if (!state?.zones || !cardId) return false;

  for (const playerZones of Object.values(state.zones as Record<string, any>)) {
    const zone = (playerZones as any)?.[zoneName];
    if (Array.isArray(zone) && zone.some((card: any) => String(card?.id || '') === cardId)) {
      return true;
    }
  }

  return false;
}

export function stackTargetStillLegal(
  state: any,
  controller: PlayerID,
  target: any,
  allowedLocations: Set<StackTargetLocation>,
): boolean {
  const targetId = getStackTargetId(target);
  if (!targetId) return false;

  const targetKind = getStackTargetKind(target);
  if (targetKind === 'player') {
    return Array.isArray(state?.players) && state.players.some((player: any) => String(player?.id || '') === targetId);
  }

  if (targetKind === 'stack') {
    return Array.isArray(state?.stack) && state.stack.some((stackItem: any) => String(stackItem?.id || '') === targetId);
  }

  if (targetKind === 'permanent' || targetKind === 'battlefield') {
    const permanent = Array.isArray(state?.battlefield)
      ? state.battlefield.find((entry: any) => String(entry?.id || '') === targetId)
      : undefined;
    return Boolean(permanent && canPermanentBeTargetedByPlayer(permanent, state, controller as any));
  }

  if (targetKind === 'card' || targetKind === 'graveyard' || targetKind === 'exile' || targetKind === 'hand') {
    const zoneName = (targetKind === 'card' ? String(target?.zone || '').toLowerCase() : targetKind) as StackTargetLocation;
    if (zoneName === 'graveyard' || zoneName === 'exile' || zoneName === 'hand') {
      return zoneContainsCardId(state, zoneName, targetId);
    }
  }

  if (
    allowedLocations.has('player') &&
    Array.isArray(state?.players) &&
    state.players.some((player: any) => String(player?.id || '') === targetId)
  ) {
    return true;
  }

  if (
    allowedLocations.has('stack') &&
    Array.isArray(state?.stack) &&
    state.stack.some((stackItem: any) => String(stackItem?.id || '') === targetId)
  ) {
    return true;
  }

  if (allowedLocations.has('battlefield') && Array.isArray(state?.battlefield)) {
    const permanent = state.battlefield.find((entry: any) => String(entry?.id || '') === targetId);
    if (permanent && canPermanentBeTargetedByPlayer(permanent, state, controller as any)) {
      return true;
    }
  }

  if (allowedLocations.has('graveyard') && zoneContainsCardId(state, 'graveyard', targetId)) return true;
  if (allowedLocations.has('exile') && zoneContainsCardId(state, 'exile', targetId)) return true;
  if (allowedLocations.has('hand') && zoneContainsCardId(state, 'hand', targetId)) return true;

  return false;
}

export function shouldFizzleStackSpellForMissingTargets(
  state: any,
  item: any,
  effectiveCard: any,
  controller: PlayerID,
): boolean {
  if (!item?.card || item?.type === 'ability' || item?.type === 'triggered_ability' || item?.type === 'activated_ability') {
    return false;
  }

  const isMutatingSpell =
    (effectiveCard as any)?.isMutating === true ||
    String(item?.alternateCostId || effectiveCard?.alternateCostId || '')
      .toLowerCase()
      .trim() === 'mutate';
  if (isMutatingSpell) {
    return false;
  }

  const targets = Array.isArray(item?.targets) ? item.targets : [];
  if (targets.length === 0) return false;

  const oracleText = String(effectiveCard?.oracle_text || item?.card?.oracle_text || item?.description || '');
  if (!requiresTargeting(oracleText)) return false;

  const allowedLocations = inferStackTargetLocations(oracleText);
  if (allowedLocations.size === 0) return false;

  return !targets.some((target: any) => stackTargetStillLegal(state, controller, target, allowedLocations));
}

export function moveFizzledStackSpellCard(ctx: GameContext, item: any, controller: PlayerID): void {
  const card = item?.card;
  if (!card || !controller) return;

  if (card?.ceaseOnResolution === true || card?.ceaseOnCounter === true || item?.ceaseOnResolution === true) {
    debug(2, `[moveFizzledStackSpellCard] Fizzled copied spell ${card.name || 'unnamed'} ceased to exist`);
    return;
  }

  const zones = ctx.state.zones = ctx.state.zones || {};
  zones[controller] = zones[controller] || {
    hand: [],
    handCount: 0,
    libraryCount: ctx.libraries?.get(controller)?.length ?? 0,
    graveyard: [],
    graveyardCount: 0,
  };

  const playerZones = zones[controller] as any;
  if (shouldExileStackCardInsteadOfGraveyard(item)) {
    playerZones.exile = playerZones.exile || [];
    playerZones.exile.push({ ...card, zone: 'exile' });
    playerZones.exileCount = playerZones.exile.length;
    debug(2, `[moveFizzledStackSpellCard] Fizzled graveyard-cast spell ${card.name || 'unnamed'} exiled for ${controller}`);
  } else {
    playerZones.graveyard = playerZones.graveyard || [];
    pushCardToPlayerGraveyardWithReplacements(ctx, String(controller), card, playerZones.graveyard);
    playerZones.graveyardCount = playerZones.graveyard.length;
    debug(2, `[moveFizzledStackSpellCard] Fizzled spell ${card.name || 'unnamed'} moved to graveyard for ${controller}`);
  }
}
