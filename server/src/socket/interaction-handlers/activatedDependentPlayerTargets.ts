/**
 * "Choose target opponent who has ... Destroy target nonblack creature that player controls" (Keeper of
 * the Dead): the object target depends on the player target (CR 601.2c / 602.2b). One prompt for the
 * object, limited to objects whose controller is a legal player target; the player target is that
 * object's controller and is prepended on submit.
 */
import type { PlayerID } from "../../../../shared/src/index.js";
import { canPermanentBeTargetedByPlayer, canPlayerBeTargetedByPlayer } from "../../rules-engine/targeting.js";
import { permanentMatchesTargetTypeEntry } from "../permanentTargetTypeFilter.js";

const OBJECT_TYPES = 'creature|permanent|artifact|enchantment|land|planeswalker|battle';
const DEPENDENT_RE = new RegExp(
  String.raw`\btarget (player|opponent)\b([^.]*)\.[^.]*?\btarget ((?:[a-z-]+ )*?)(${OBJECT_TYPES})s? (?:that player|that opponent|he or she|they) controls?\b`,
  'i',
);

export interface DependentPlayerObjectTarget {
  readonly playerKind: 'player' | 'opponent';
  readonly playerCondition: string;
  readonly objectEntry: string;
  readonly description: string;
}

export function parseDependentPlayerObjectTarget(abilityText: string): DependentPlayerObjectTarget | null {
  const text = String(abilityText || '').replace(/[\u2018\u2019]/g, "'");
  const m = text.match(DEPENDENT_RE);
  if (!m) return null;
  const words = String(m[3] || '').trim();
  const type = String(m[4] || '').toLowerCase();
  return {
    playerKind: String(m[1]).toLowerCase() === 'opponent' ? 'opponent' : 'player',
    playerCondition: String(m[2] || '').trim(),
    objectEntry: `${words ? `${words} ` : ''}${type}`.toLowerCase(),
    description: `${words ? `${words} ` : ''}${type} that player controls`.toLowerCase(),
  };
}

function zoneCount(state: any, playerId: string, zone: 'graveyard' | 'hand', typeWord: string): number {
  const cards = state?.zones?.[playerId]?.[zone];
  const list = Array.isArray(cards) ? cards : [];
  if (!typeWord) return list.length;
  return list.filter((card: any) => String(card?.type_line || card?.card?.type_line || '').toLowerCase().includes(typeWord)).length;
}

/** "who has at least two fewer creature cards in their graveyard than you do"; unknown wording passes. */
export function playerMeetsTargetCondition(state: any, playerId: string, controllerId: string, condition: string): boolean {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const m = String(condition || '').toLowerCase().match(
    /\bwho has at least (\w+) (fewer|more) (?:([a-z]+) )?cards in (?:their|his or her) (graveyard|hand) than you\b/,
  );
  if (!m) return true;
  const amount = Number.isFinite(Number(m[1])) ? Number(m[1]) : (words[m[1]] ?? 1);
  const typeWord = m[3] && m[3] !== 'card' ? m[3] : '';
  const zone = m[4] as 'graveyard' | 'hand';
  const theirs = zoneCount(state, playerId, zone, typeWord);
  const yours = zoneCount(state, controllerId, zone, typeWord);
  return m[2] === 'fewer' ? yours - theirs >= amount : theirs - yours >= amount;
}

export function buildDependentPlayerObjectTargets(game: any, controllerId: string, info: DependentPlayerObjectTarget): any[] {
  const state = game?.state || {};
  const legalPlayers = new Set(
    (Array.isArray(state.players) ? state.players : [])
      .map((player: any) => String(player?.id || ''))
      .filter((id: string) => id && !(info.playerKind === 'opponent' && id === controllerId))
      .filter((id: string) => canPlayerBeTargetedByPlayer(id as PlayerID, state, controllerId as PlayerID))
      .filter((id: string) => playerMeetsTargetCondition(state, id, controllerId, info.playerCondition)),
  );
  return (Array.isArray(state.battlefield) ? state.battlefield : [])
    .filter((perm: any) => perm?.id && legalPlayers.has(String(perm.controller || '')))
    .filter((perm: any) => permanentMatchesTargetTypeEntry(perm, info.objectEntry))
    .filter((perm: any) => canPermanentBeTargetedByPlayer(perm, state, controllerId as PlayerID))
    .map((perm: any) => ({
      id: String(perm.id),
      label: perm.card?.name || String(perm.id),
      name: perm.card?.name || String(perm.id),
      description: perm.card?.type_line || 'Permanent',
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      type: 'permanent',
      controller: perm.controller,
      isOpponent: String(perm.controller || '') !== controllerId,
      tapped: perm.tapped === true,
      typeLine: perm.card?.type_line,
    }));
}

/** On submit: the player target (the chosen object's controller) comes first, as printed. */
export function prependDependentPlayerTarget(game: any, selectedIds: readonly string[], validTargets: any[]): string[] {
  const objectId = String(selectedIds[0] || '');
  const perm = (Array.isArray(game?.state?.battlefield) ? game.state.battlefield : []).find((entry: any) => String(entry?.id || '') === objectId);
  const playerId = String(perm?.controller || validTargets.find((target) => String(target?.id) === objectId)?.controller || '');
  if (!playerId) return [...selectedIds];
  if (!validTargets.some((target) => String(target?.id) === playerId)) {
    const player = (game?.state?.players || []).find((entry: any) => String(entry?.id) === playerId);
    validTargets.push({ id: playerId, type: 'player', name: player?.name || playerId, label: player?.name || playerId });
  }
  return [playerId, ...selectedIds];
}
