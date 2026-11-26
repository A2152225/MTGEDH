/**
 * socket/opponentChosenTargets.ts
 *
 * Generic "target X of an opponent's choice" / "chosen by an opponent" / "an opponent chooses"
 * support for spell casts and activated abilities. The spell or ability still belongs to its
 * controller (it is their spell, and legality is checked from their side), but an opponent picks
 * the object for that target slot.
 *
 * - One eligible opponent: the TARGET_SELECTION step goes straight to that opponent.
 * - Several opponents: the controller first picks which opponent chooses (one player-target
 *   step); that answer queues the deferred target steps for the chosen opponent.
 * - AI choosers get chooseAIOpponentChosenTargets: they hand over what hurts them least.
 *
 * Steps are tagged opponentChosenTargets / targetsChosenFor (the controller's id) and, for
 * multi-clause casts, targetClauseIndex so the final target list keeps the printed order even
 * when the players answer in a different order.
 */

import type { Server } from "socket.io";
import {
  ResolutionQueueManager,
  ResolutionStepStatus,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import { broadcastGame, getPlayerName } from "./util.js";
import { chooserFacingTargetSpec, countOpponentChosenTargetSlots } from "../state/modules/opponentChosenTargetRouting.js";
import { canPermanentBeTargetedByPlayer } from "../rules-engine/targeting.js";

const OPPONENT_CHOICE_RE = /\b(?:of an opponent['\u2019]s choice|chosen by an opponent|an opponent chooses)\b/gi;
const CHOOSER_CONTROLS_RE = /\bof an opponent['\u2019]s choice they control\b/i;

export type OpponentTargetChooserFlags = {
  chosenByOpponent?: boolean;
  restrictToChooserControlled?: boolean;
};

/** True when the text names an opponent as the chooser for at least one target. */
export function isOpponentChosenTargetText(text: unknown): boolean {
  return new RegExp(OPPONENT_CHOICE_RE.source, 'i').test(String(text || ''));
}

/** True when every "target" in the text is one an opponent chooses (no slot the controller picks). */
export function opponentChoosesAllTargets(text: unknown): boolean {
  const body = String(text || '').replace(/\([^)]*\)/g, ' ');
  const choices = body.match(new RegExp(OPPONENT_CHOICE_RE.source, 'gi'))?.length || 0;
  if (choices === 0) return false;
  const targets = body.match(/\btarget\b/gi)?.length || 0;
  return choices >= targets;
}

/** "target creature of an opponent's choice they control": the chooser must pick their own object. */
export function chooserControlsTargets(text: unknown): boolean {
  return CHOOSER_CONTROLS_RE.test(String(text || ''));
}

/** Opponents still in the game who can be asked to choose. */
export function listTargetChoosingOpponents(game: any, controllerId: string): string[] {
  const players: any[] = Array.isArray(game?.state?.players) ? game.state.players : [];
  return players
    .filter((player: any) => player && String(player.id || '') && String(player.id) !== String(controllerId))
    .filter((player: any) => !player.hasLost && !player.eliminated && !player.conceded && !player.spectator && !player.isSpectator)
    .map((player: any) => String(player.id));
}

function assignChooser(spec: any, chooserId: string, game: any): any {
  const controllerId = String(spec.targetsChosenFor || '');
  const controllerName = controllerId ? getPlayerName(game, controllerId as any) : 'its controller';
  return chooserFacingTargetSpec(spec, chooserId, controllerName);
}

/**
 * Queue one TARGET_SELECTION step, routing it to an opponent when `flags.chosenByOpponent` is set.
 * Returns the queued step, or null when the spec was folded into an already-queued chooser step.
 */
export function addTargetStepWithChooser(
  gameId: string,
  game: any,
  controllerId: string,
  flags: OpponentTargetChooserFlags | null | undefined,
  clauseIndex: number | undefined,
  spec: any,
): any | null {
  const base = typeof clauseIndex === 'number' ? { ...spec, targetClauseIndex: clauseIndex } : spec;
  if (flags?.chosenByOpponent !== true) return ResolutionQueueManager.addStep(gameId, splitMixedChooserAbilitySpec(base) || base);

  const opponents = listTargetChoosingOpponents(game, controllerId);
  if (opponents.length === 0) return ResolutionQueueManager.addStep(gameId, base);

  const tagged = {
    ...base,
    opponentChosenTargets: true,
    targetsChosenFor: controllerId,
    restrictToChooserControlled: flags.restrictToChooserControlled === true,
  };
  if (opponents.length === 1) {
    debug(2, `[opponentChosenTargets] ${String(spec.sourceName || '')}: ${opponents[0]} chooses this target`);
    return ResolutionQueueManager.addStep(gameId, assignChooser(tagged, opponents[0], game));
  }

  const groupKey = String(spec.spellCastContext?.effectId || spec.sourceId || '');
  const pendingChooser: any = ResolutionQueueManager.getStepsForPlayer(gameId, controllerId as any)
    .find((step: any) => step?.opponentTargetChooserSelection === true && String(step.opponentChooserGroup || '') === groupKey);
  if (pendingChooser && Array.isArray(pendingChooser.deferredOpponentTargetSteps)) {
    pendingChooser.deferredOpponentTargetSteps.push(tagged);
    return null;
  }

  return ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: controllerId,
    description: `Choose the opponent who chooses targets for ${String(spec.sourceName || 'this')}`,
    mandatory: true,
    sourceId: spec.sourceId,
    sourceName: spec.sourceName,
    sourceImage: spec.sourceImage,
    validTargets: opponents.map((id) => ({
      id,
      label: getPlayerName(game, id as any),
      description: 'player',
      type: 'player',
      isOpponent: true,
    })),
    targetTypes: ['player'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'an opponent',
    opponentTargetChooserSelection: true,
    opponentChooserGroup: groupKey,
    deferredOpponentTargetSteps: [tagged],
    ...(spec.spellCastContext ? { spellCastContext: spec.spellCastContext } : {}),
  } as any);
}

/** Answer to the "which opponent chooses" step: queue the deferred target steps for that opponent. */
export function handleOpponentTargetChooserSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepAny = step as any;
  const controllerId = String(step.playerId || response.playerId || '');
  const opponents = listTargetChoosingOpponents(game, controllerId);
  const picked = String((response.selections as any)?.[0] || '');
  const chooserId = opponents.includes(picked) ? picked : opponents[0];
  const deferred: any[] = Array.isArray(stepAny.deferredOpponentTargetSteps) ? stepAny.deferredOpponentTargetSteps : [];
  if (!chooserId) {
    debugWarn(1, `[opponentChosenTargets] no opponent left to choose; controller ${controllerId} chooses`);
  }
  for (const spec of deferred) {
    ResolutionQueueManager.addStep(gameId, chooserId ? assignChooser(spec, chooserId, game) : { ...spec, playerId: controllerId });
  }
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}

/** Every pending step in the game's queue (all players). */
export function listPendingQueueSteps(gameId: string): ResolutionStep[] {
  const steps: any[] = (ResolutionQueueManager.getQueue(gameId) as any)?.steps || [];
  return steps.filter((step: any) => step?.status === ResolutionStepStatus.PENDING);
}

/** Store one clause's answer and return all chosen targets in clause order. */
export function mergeClauseTargets(pendingCast: any, step: any, existingTargets: string[], selections: string[]): string[] {
  const chosen = selections.map((id) => String(id));
  const clauseIndex = Number(step?.targetClauseIndex);
  if (!Number.isInteger(clauseIndex) || clauseIndex < 0) return [...existingTargets, ...chosen];
  const byClause: Record<string, string[]> = pendingCast.targetsByClause && typeof pendingCast.targetsByClause === 'object'
    ? pendingCast.targetsByClause
    : {};
  byClause[String(clauseIndex)] = chosen;
  pendingCast.targetsByClause = byClause;
  return Object.keys(byClause)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((key) => byClause[String(key)] || []);
}

function targetValueForChooser(game: any, chooserId: string, target: any): number {
  const id = String(target?.id || '');
  if (String(target?.type || '') === 'player' || String(target?.description || '') === 'player') {
    return id === chooserId ? 50 : -5;
  }
  const battlefield: any[] = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const perm = battlefield.find((p: any) => p && String(p.id) === id);
  const card = perm?.card || {};
  const worth = Number(card.cmc ?? card.mana_value ?? 0) + Number(perm?.basePower ?? card.power ?? 0) + 1;
  const controller = String(perm?.controller || target?.controller || '');
  return controller === chooserId ? worth : -worth;
}

/**
 * AI chooser for an opponent-chosen slot: the effect usually works against the chooser, so pick
 * the targets worth least to it (another player's things first, then its cheapest own object).
 */
export function chooseAIOpponentChosenTargets(game: any, chooserId: string, step: any, validTargets: readonly any[]): string[] {
  const minTargets = Math.max(0, Number(step?.minTargets || 0));
  const maxTargets = Math.max(minTargets, Number(step?.maxTargets ?? minTargets));
  const count = Math.min(validTargets.length, maxTargets, Math.max(minTargets, 1));
  return [...validTargets]
    .sort((a, b) => targetValueForChooser(game, chooserId, a) - targetValueForChooser(game, chooserId, b))
    .slice(0, count)
    .map((target: any) => String(target.id));
}

/** Replay record for a queued target step: keep the real chooser and its routing fields. */
export function withChooserRouting<T extends Record<string, any>>(serialized: T, queued: any): T {
  if (queued && (queued.opponentChosenTargets === true || queued.opponentTargetChooserSelection === true)) {
    Object.assign(serialized, { ...queued });
  }
  return serialized;
}

/**
 * Mixed choosers on one activated ability (Cuombajj Witches, Diaochan, Arena): the controller
 * picks its own targets first, then an opponent picks the rest. The controller's step carries the
 * opponent's step as `mixedChooserFollowup`; the follow-up holds the controller's picks as
 * `priorAbilityTargets` so the ability goes on the stack once, with every target in printed order.
 */
export function splitMixedChooserAbilitySpec(spec: any): any | null {
  if (spec?.battlefieldAbilityTargetSelection !== true || spec.mixedChooserFollowup || spec.priorAbilityTargets) return null;
  const text = String(spec.abilityText || '');
  const { choices, targets } = countOpponentChosenTargetSlots(text);
  if (choices === 0 || choices >= targets) return null;
  const own = targets - choices;
  return {
    ...spec,
    minTargets: own,
    maxTargets: own,
    description: `${String(spec.description || 'Choose targets')} (an opponent chooses the other target${choices > 1 ? 's' : ''})`,
    mixedChooserFollowup: {
      ...spec,
      minTargets: choices,
      maxTargets: choices,
      mixedChooserRestrictToChooser: chooserControlsTargets(text),
    },
  };
}

/** The controller's picks a follow-up step carries forward, with their prompt entries. */
export function readPriorAbilityTargets(step: any): { ids: string[]; entries: any[] } {
  const ids = Array.isArray(step?.priorAbilityTargets) ? step.priorAbilityTargets.map((id: any) => String(id)).filter(Boolean) : [];
  const entries = Array.isArray(step?.priorAbilityTargetEntries) ? step.priorAbilityTargetEntries : [];
  return { ids, entries };
}

function opponentClauseNoun(text: string): string {
  return (text.match(/\btarget (\w+) of an opponent['\u2019]s choice\b/i)?.[1] || '').toLowerCase();
}

/** Every permanent of the opponent clause's type that the controller could target. */
function opponentClauseTargetEntries(game: any, controllerId: string, noun: string): any[] {
  const battlefield: any[] = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  return battlefield
    .filter((perm: any) => perm && perm.id && (!noun || String(perm.card?.type_line || '').toLowerCase().includes(noun)))
    .filter((perm: any) => canPermanentBeTargetedByPlayer(perm as any, game.state as any, controllerId as any))
    .map((perm: any) => ({
      id: String(perm.id),
      label: perm.card?.name || 'Permanent',
      description: perm.card?.type_line || 'Permanent',
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      type: 'permanent',
      controller: perm.controller,
      typeLine: perm.card?.type_line,
      isOpponent: String(perm.controller || '') !== controllerId,
    }));
}

/**
 * After the controller answers a mixed-chooser step, queue the opponent's part. Returns true when
 * it did, so the caller waits for that answer before activating.
 */
export function queueMixedChooserFollowupTargetStep(
  io: Server,
  game: any,
  gameId: string,
  step: any,
  selectedIds: string[],
  validTargets: any[],
): boolean {
  const followup = step?.mixedChooserFollowup;
  if (!followup || typeof followup !== 'object') return false;
  const controllerId = String(step.targetsChosenFor || step.playerId || '');
  const restrict = followup.mixedChooserRestrictToChooser === true;
  const noun = opponentClauseNoun(String(followup.abilityText || ''));
  const cardName = String(followup.cardName || followup.sourceName || 'this ability');
  const spec: any = {
    ...followup,
    priorAbilityTargets: selectedIds.slice(),
    priorAbilityTargetEntries: validTargets.filter((entry: any) => selectedIds.includes(String(entry?.id || ''))),
    ...(restrict
      ? {
          validTargets: opponentClauseTargetEntries(game, controllerId, noun),
          description: `Choose a ${noun || 'permanent'} of yours for ${cardName}`,
          targetDescription: `${noun || 'permanent'} of yours`,
        }
      : {}),
  };
  delete spec.mixedChooserFollowup;
  addTargetStepWithChooser(gameId, game, controllerId, { chosenByOpponent: true, restrictToChooserControlled: restrict }, undefined, spec);
  debug(2, `[opponentChosenTargets] ${cardName}: controller picked ${selectedIds.join(', ')}; an opponent picks the rest`);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}
