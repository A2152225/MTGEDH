/**
 * Match filters for round 67 trigger conditions.
 * Origin parent: match.ts triggerConditionMatches (late checks).
 * Public: matchRound67Filters.
 */
import type { TriggerConditionIR, TriggerMatchContext, TriggerMatchPermanent } from './types.js';

const COLOR_LETTER: Record<string, string> = {
  white: 'W', w: 'W', blue: 'U', u: 'U', black: 'B', b: 'B', red: 'R', r: 'R', green: 'G', g: 'G',
};

function colorLetter(raw: string): string {
  const text = String(raw || '').trim().toLowerCase();
  return COLOR_LETTER[text] || text.toUpperCase();
}

/** False when a round-67 filter is present and the event does not satisfy it. */
export function matchRound67Filters(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchPermanent,
  context?: TriggerMatchContext,
): boolean {
  if (condition.crewedBySourceThisTurn) {
    const ids = context?.crewedByPermanentIds || [];
    if (!source.id || !ids.some((id) => String(id) === source.id)) return false;
  }
  if (condition.spellTargetsSingleCreature) {
    const only = String(context?.singleCreatureTargetId || '');
    const damaged = String(context?.damagedPermanentId || '');
    if (!only || !damaged || only !== damaged) return false;
  }
  if (condition.putOntoBattlefieldWithSource) {
    const by = String(context?.enteredBySourceId || '');
    if (!by || by !== String(source.id || '')) return false;
  }
  if (condition.chosenCreatureLeaves) {
    const chosen = String((source as { chosenCreatureId?: string }).chosenCreatureId || '');
    if (!chosen || chosen !== String(subject.id || '')) return false;
  }
  if (condition.linkedEquipment) {
    const linked = String((source as { linkedEquipmentId?: string }).linkedEquipmentId || '');
    if (!linked || linked !== String(subject.id || '')) return false;
  }
  if (condition.eitherOfLinkedAttackers) {
    const ids = context?.linkedAttackerIds || [];
    if (!subject.id || !ids.some((id) => String(id) === subject.id)) return false;
  }
  if (condition.blockedByChosenColor) {
    const chosen = colorLetter(String(source.chosenColor || ''));
    const watch = Number((source as { blockColorWatchTurn?: number }).blockColorWatchTurn);
    const turn = Number(context?.turnNumber);
    if (!chosen || !Number.isFinite(watch) || !Number.isFinite(turn) || watch !== turn) return false;
    const colors = (context?.blockPartner?.colors || []).map((c) => colorLetter(String(c)));
    if (!colors.includes(chosen)) return false;
  }
  if (condition.causedKind) {
    const event = context?.causeEvent;
    const specific = context?.causedKind;
    if (specific && specific !== condition.causedKind && event == null) return false;
    if (condition.causedKind === 'etb' && event !== 'etb' && specific !== 'etb') return false;
    if (condition.causedKind === 'attack_own_creature' || condition.causedKind === 'etb_opponent_creature') {
      const wantEvent = condition.causedKind === 'attack_own_creature' ? 'attack' : 'etb';
      if (event !== wantEvent && specific !== condition.causedKind) return false;
      if (context?.causedSourceIsCreature !== true) return false;
      const causedController = String(context?.causedSourceControllerId || '');
      const sourceController = String(source.controllerId || '');
      if (!causedController || !sourceController) return false;
      if (condition.causedKind === 'attack_own_creature' && causedController !== sourceController) return false;
      if (condition.causedKind === 'etb_opponent_creature' && causedController === sourceController) return false;
      const abilitySource = String(context?.causedAbilitySourceId || '');
      const creatureId = String(context?.causedSourceId || '');
      if (!abilitySource || !creatureId || abilitySource !== creatureId) return false;
    }
  }
  return true;
}
