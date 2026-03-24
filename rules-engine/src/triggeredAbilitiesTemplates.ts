import { TriggerEvent, TriggerKeyword, type TriggeredAbility } from './triggeredAbilitiesTypes';

/**
 * Common triggered ability templates.
 */

export function createETBTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  targets?: string[]
): TriggeredAbility {
  return {
    id: `${sourceId}-etb`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.ENTERS_BATTLEFIELD,
    effect,
    targets,
  };
}

export function createDiesTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-dies`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.DIES,
    effect,
  };
}

export function createUpkeepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-upkeep`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.AT,
    event: TriggerEvent.BEGINNING_OF_UPKEEP,
    effect,
  };
}

export function createAttacksTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-attacks`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.ATTACKS,
    effect,
  };
}

export function createEndStepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-end-step`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.AT,
    event: TriggerEvent.BEGINNING_OF_END_STEP,
    effect,
  };
}

export function createLandfallTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-landfall`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.LANDFALL,
    effect,
  };
}

export function createCombatDamageToPlayerTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-combat-damage-player`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
    effect,
  };
}

export function createSpellCastTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  filter?: { cardType?: string; controller?: 'you' | 'opponent' | 'any' }
): TriggeredAbility {
  let event = TriggerEvent.SPELL_CAST;
  if (filter?.cardType === 'creature') {
    event = TriggerEvent.CREATURE_SPELL_CAST;
  } else if (filter?.cardType === 'noncreature') {
    event = TriggerEvent.NONCREATURE_SPELL_CAST;
  } else if (filter?.cardType === 'instant' || filter?.cardType === 'sorcery') {
    event = TriggerEvent.INSTANT_OR_SORCERY_CAST;
  }

  return {
    id: `${sourceId}-spell-cast`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
    condition: filter?.controller,
  };
}

export function createLifeGainTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-life-gain`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.GAINED_LIFE,
    effect,
  };
}

export function createSacrificeTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  filter?: { permanentType?: string }
): TriggeredAbility {
  let event = TriggerEvent.SACRIFICED;
  if (filter?.permanentType === 'creature') {
    event = TriggerEvent.CREATURE_SACRIFICED;
  } else if (filter?.permanentType === 'artifact') {
    event = TriggerEvent.ARTIFACT_SACRIFICED;
  }

  return {
    id: `${sourceId}-sacrifice`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
  };
}

export function checkMultipleTriggers(
  events: TriggerEvent[],
  currentEvent: TriggerEvent
): boolean {
  return events.includes(currentEvent);
}

export function createCompoundTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  events: TriggerEvent[],
  effect: string
): TriggeredAbility[] {
  return events.map((event, index) => ({
    id: `${sourceId}-compound-${index}`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event,
    effect,
  }));
}
