/**
 * actions/triggersHandler.ts
 * 
 * Handles triggered abilities (Rule 603).
 * Processes events and queues triggers for the stack.
 */

import type { GameState, KnownCardRef, BattlefieldPermanent } from '../../../shared/src';
import {
  TriggerEvent,
  processEvent,
  putTriggersOnStack,
  createEmptyTriggerQueue,
  type TriggeredAbility,
  parseTriggeredAbilitiesFromText,
} from '../triggeredAbilities';
import { 
  hasSpecialTriggeredAbility, 
  getTriggeredAbilityConfig,
  isETBTokenCreator,
  getETBTokenConfig,
} from '../cards';
import { hasChangeling, getAllCreatureTypes } from '../tribalSupport';

export interface TriggerResult {
  state: GameState;
  triggersAdded: number;
  logs: string[];
}

/**
 * Process triggered abilities for an event
 */
export function processTriggers(
  state: GameState,
  event: TriggerEvent,
  registeredAbilities: TriggeredAbility[]
): TriggerResult {
  const logs: string[] = [];
  const triggerInstances = processEvent(event, registeredAbilities);
  
  if (triggerInstances.length === 0) {
    return { state, triggersAdded: 0, logs };
  }
  
  // Queue triggers
  let queue = createEmptyTriggerQueue();
  for (const trigger of triggerInstances) {
    queue = { triggers: [...queue.triggers, trigger] };
  }
  
  // Put on stack in APNAP order
  const activePlayerId = state.players[state.activePlayerIndex || 0]?.id || '';
  const { stackObjects, log } = putTriggersOnStack(queue, activePlayerId);
  
  logs.push(...log);
  
  // Add to game stack
  const updatedStack = [...(state.stack || []), ...stackObjects];
  
  return {
    state: { ...state, stack: updatedStack as any },
    triggersAdded: stackObjects.length,
    logs,
  };
}

/**
 * Find all triggered abilities on permanents
 * 
 * This enhanced version checks:
 * 1. Card-specific configurations from our cards module
 * 2. Parsed oracle text patterns
 * 3. Special trigger types (tribal, landfall, etc.)
 */
export function findTriggeredAbilities(state: GameState): TriggeredAbility[] {
  const abilities: TriggeredAbility[] = [];
  
  // Scan all permanents on centralized battlefield for triggered abilities
  for (const perm of state.battlefield || []) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;
    
    const cardName = card.name || '';
    const oracleText = card.oracle_text || '';
    const controllerId = perm.controller || '';
    
    // Check for special card-specific triggers first
    if (hasSpecialTriggeredAbility(cardName)) {
      const config = getTriggeredAbilityConfig(cardName);
      if (config) {
        abilities.push({
          id: `${perm.id}-special-trigger`,
          sourceId: perm.id,
          sourceName: cardName,
          controllerId: controllerId,
          keyword: 'whenever' as any,
          event: config.triggerEvent,
          condition: config.triggerCondition,
          effect: config.effect,
          optional: config.requiresChoice,
        });
      }
    }
    
    // Check for ETB token creator triggers
    if (isETBTokenCreator(cardName)) {
      const etbConfig = getETBTokenConfig(cardName);
      if (etbConfig) {
        abilities.push({
          id: `${perm.id}-etb-tokens`,
          sourceId: perm.id,
          sourceName: cardName,
          controllerId: controllerId,
          keyword: 'when' as any,
          event: TriggerEvent.ENTERS_BATTLEFIELD,
          effect: `Create ${etbConfig.tokenCount} ${etbConfig.tokenType} token(s).`,
        });
      }
    }
    
    // Parse additional triggers from oracle text
    const parsedTriggers = parseTriggeredAbilitiesFromText(
      oracleText,
      perm.id,
      controllerId,
      cardName
    );
    abilities.push(...parsedTriggers);
  }
  
  return abilities;
}

/**
 * Check for enter the battlefield triggers
 */
export function checkETBTriggers(
  state: GameState,
  permanentId: string,
  controllerId: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const etbAbilities = abilities.filter(a => 
    a.sourceId === permanentId && 
    a.event === TriggerEvent.ENTERS_BATTLEFIELD
  );
  
  if (etbAbilities.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }
  
  return processTriggers(state, TriggerEvent.ENTERS_BATTLEFIELD, etbAbilities);
}

/**
 * Check for dies triggers
 */
export function checkDiesTriggers(
  state: GameState,
  permanentId: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const diesAbilities = abilities.filter(a => 
    a.event === TriggerEvent.DIES
  );
  
  return processTriggers(state, TriggerEvent.DIES, diesAbilities);
}

/**
 * Check for beginning of step triggers
 */
export function checkStepTriggers(
  state: GameState,
  event: TriggerEvent
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const stepAbilities = abilities.filter(a => a.event === event);
  
  return processTriggers(state, event, stepAbilities);
}

/**
 * Check for tribal creature cast triggers (e.g., Deeproot Waters for Merfolk)
 * Takes into account changeling creatures
 */
export function checkTribalCastTriggers(
  state: GameState,
  castCard: KnownCardRef,
  casterId: string
): TriggerResult {
  const logs: string[] = [];
  const triggeredAbilities: TriggeredAbility[] = [];
  
  // Get the creature types of the cast card
  const typeLine = castCard.type_line || '';
  const oracleText = castCard.oracle_text || '';
  const isCreature = typeLine.toLowerCase().includes('creature');
  
  if (!isCreature) {
    return { state, triggersAdded: 0, logs: [] };
  }
  
  // Get all creature types including changeling check
  const isChangelingCard = hasChangeling(oracleText, typeLine);
  const creatureTypes = isChangelingCard 
    ? getAllCreatureTypes(typeLine, oracleText)
    : getAllCreatureTypes(typeLine, '');
  
  // Find all tribal triggers on battlefield (only for controller)
  for (const perm of state.battlefield || []) {
    if (perm.controller !== casterId) continue; // Only trigger for controller
    
    const permCard = perm.card as KnownCardRef;
    if (!permCard) continue;
    
    const cardName = permCard.name || '';
    
    // Check for special tribal triggers (Deeproot Waters, etc.)
    if (hasSpecialTriggeredAbility(cardName)) {
      const config = getTriggeredAbilityConfig(cardName);
      if (config?.triggerEvent === TriggerEvent.CREATURE_SPELL_CAST && config.creatureTypeFilter) {
        // Check if the cast creature matches the required type
        const requiredType = config.creatureTypeFilter.toLowerCase();
        const matchesType = creatureTypes.some(t => t.toLowerCase() === requiredType);
        
        if (matchesType) {
          logs.push(`${cardName} triggered from casting ${castCard.name}`);
          triggeredAbilities.push({
            id: `${perm.id}-tribal-cast-${Date.now()}`,
            sourceId: perm.id,
            sourceName: cardName,
            controllerId: perm.controller || casterId,
            keyword: 'whenever' as any,
            event: TriggerEvent.CREATURE_SPELL_CAST,
            effect: config.effect,
            optional: config.requiresChoice,
          });
        }
      }
    }
  }
  
  if (triggeredAbilities.length === 0) {
    return { state, triggersAdded: 0, logs };
  }
  
  return processTriggers(state, TriggerEvent.CREATURE_SPELL_CAST, triggeredAbilities);
}

/**
 * Check for landfall triggers (e.g., Tireless Provisioner)
 */
export function checkLandfallTriggers(
  state: GameState,
  landPlayerId: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const landfallAbilities = abilities.filter(a => 
    a.event === TriggerEvent.LANDFALL &&
    a.controllerId === landPlayerId
  );
  
  return processTriggers(state, TriggerEvent.LANDFALL, landfallAbilities);
}

/**
 * Check for spell cast triggers (e.g., Aetherflux Reservoir)
 */
export function checkSpellCastTriggers(
  state: GameState,
  casterId: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const spellCastAbilities = abilities.filter(a => 
    a.event === TriggerEvent.SPELL_CAST &&
    a.controllerId === casterId
  );
  
  return processTriggers(state, TriggerEvent.SPELL_CAST, spellCastAbilities);
}

/**
 * Check for card draw triggers (e.g., Smothering Tithe)
 */
export function checkDrawTriggers(
  state: GameState,
  drawingPlayerId: string,
  isOpponentDraw: boolean = false
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const drawAbilities = abilities.filter(a => {
    if (a.event !== TriggerEvent.DRAWN) return false;
    
    // Filter by condition (opponent draw, etc.)
    if (a.condition === 'opponent' && !isOpponentDraw) return false;
    if (a.condition === 'you' && isOpponentDraw) return false;
    
    return true;
  });
  
  return processTriggers(state, TriggerEvent.DRAWN, drawAbilities);
}
