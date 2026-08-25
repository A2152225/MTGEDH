// Origin parent: rules-engine/src/actions/triggersHandler.ts
// Cluster moved: findTriggeredAbilities.
// Public entry symbols: findTriggeredAbilities.
// Leaf must not import actions/triggersHandler.ts or triggersHandler-handlers/index.ts.

import type { GameState, KnownCardRef } from '../../../../shared/src';
import {
  TriggerEvent,
  type TriggeredAbility,
  parseTriggeredAbilitiesFromText,
} from '../../triggeredAbilities';
import {
  hasSpecialTriggeredAbility,
  getTriggeredAbilityConfig,
  isETBTokenCreator,
  getETBTokenConfig,
} from '../../cards';
import { getStackItems } from './triggersHandlerStackItems.js';

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
  const looksLikeZoneActiveGraveyardTrigger = (oracleText: string): boolean => {
    const normalized = String(oracleText || '').replace(/\u2019/g, "'").toLowerCase();
    if (!/\b(?:when|whenever|at)\b/.test(normalized)) return false;
    return (
      normalized.includes('this card is in your graveyard') ||
      normalized.includes('return this card from your graveyard') ||
      normalized.includes('cast it from your graveyard') ||
      normalized.includes('cast this card from your graveyard')
    );
  };
  const normalizeTriggerEffectText = (text: string): string =>
    String(text || '')
      .replace(/\u2019/g, "'")
      .trim()
      .toLowerCase()
      .replace(
        /\bthat player may pay (\{[^}]+\})\.\s*if they do(?:n't| not),\s*/g,
        'unless that player pays $1 '
      )
      .replace(
        /\byou create a ([^.]+?) unless that player pays (\{[^}]+\})\.?/g,
        'unless that player pays $2 create a $1'
      )
      .replace(/\byou\s+(create|gain|draw|return|put|copy|sacrifice|exile|destroy|tap|untap)\b/g, '$1')
      .replace(/^you\s+/, '')
      .replace(/\s+/g, ' ');
  
  // Scan all permanents on centralized battlefield for triggered abilities
  for (const perm of state.battlefield || []) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;
    
    const cardName = card.name || '';
    const oracleText = card.oracle_text || '';
    const controllerId = perm.controller || '';
    
    // Check for special card-specific triggers first
    const specialTriggerConfig = hasSpecialTriggeredAbility(cardName)
      ? getTriggeredAbilityConfig(cardName)
      : undefined;

    if (specialTriggerConfig) {
        abilities.push({
          id: `${perm.id}-special-trigger`,
          sourceId: perm.id,
          sourceName: cardName,
          controllerId: controllerId,
          keyword: 'whenever' as any,
          event: specialTriggerConfig.triggerEvent,
          condition: specialTriggerConfig.triggerCondition,
          effect: specialTriggerConfig.effect,
          optional: specialTriggerConfig.requiresChoice,
        });
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
    ).filter(trigger => {
      if (!specialTriggerConfig) return true;
      return !(
        trigger.event === specialTriggerConfig.triggerEvent &&
        normalizeTriggerEffectText(String(trigger.effect || '')) ===
          normalizeTriggerEffectText(String(specialTriggerConfig.effect || ''))
      );
    });
    abilities.push(...parsedTriggers);
  }

  for (const player of state.players || []) {
    const controllerId = String((player as any)?.id || '').trim();
    if (!controllerId) continue;

    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    for (const card of graveyard) {
      const cardId = String((card as any)?.id || '').trim();
      const cardName = String((card as any)?.name || '').trim();
      const oracleText = String((card as any)?.oracle_text || '').trim();
      if (!cardId || !cardName || !oracleText || !looksLikeZoneActiveGraveyardTrigger(oracleText)) continue;

      const parsedTriggers = parseTriggeredAbilitiesFromText(
        oracleText,
        cardId,
        controllerId,
        cardName
      );
      abilities.push(...parsedTriggers);
    }

    const emblems = Array.isArray((player as any)?.emblems) ? (player as any).emblems : [];
    for (const emblem of emblems) {
      const emblemId = String((emblem as any)?.id || '').trim();
      const emblemName = String((emblem as any)?.name || 'Emblem').trim() || 'Emblem';
      const abilityTexts = Array.isArray((emblem as any)?.abilities) ? (emblem as any).abilities : [];

      for (const abilityText of abilityTexts) {
        const parsedTriggers = parseTriggeredAbilitiesFromText(
          String(abilityText || ''),
          emblemId || `${controllerId}-emblem`,
          controllerId,
          emblemName
        );
        abilities.push(...parsedTriggers);
      }
    }
  }

  for (const stackItem of getStackItems(state)) {
    if (String((stackItem as any)?.type || '').trim().toLowerCase() !== 'spell') continue;

    const stackCard = (((stackItem as any)?.card || (stackItem as any)?.spell || {}) as KnownCardRef);
    const stackSpellId = String((stackItem as any)?.id || '').trim();
    const stackControllerId = String((stackItem as any)?.controller || (stackItem as any)?.controllerId || '').trim();
    const stackCardName = String((stackItem as any)?.cardName || stackCard?.name || '').trim();
    const stackOracleText = String(stackCard?.oracle_text || (stackItem as any)?.oracle_text || '').trim();
    if (!stackSpellId || !stackControllerId || !stackCardName || !stackOracleText) continue;

    const parsedTriggers = parseTriggeredAbilitiesFromText(
      stackOracleText,
      stackSpellId,
      stackControllerId,
      stackCardName
    );
    abilities.push(...parsedTriggers);
  }

  const dedupedAbilities: TriggeredAbility[] = [];
  const seenAbilitySignatures = new Set<string>();
  const normalizeSignaturePart = (value: unknown): string =>
    String(value ?? '')
      .replace(/\u2019/g, "'")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  for (const ability of abilities) {
    const signature = [
      normalizeSignaturePart((ability as any)?.sourceId),
      normalizeSignaturePart((ability as any)?.controllerId),
      normalizeSignaturePart((ability as any)?.event),
      normalizeSignaturePart((ability as any)?.condition),
      normalizeSignaturePart((ability as any)?.triggerFilter),
      normalizeSignaturePart((ability as any)?.interveningIfClause),
      normalizeTriggerEffectText(String((ability as any)?.effect || '')),
    ].join('|');

    if (seenAbilitySignatures.has(signature)) continue;
    seenAbilitySignatures.add(signature);
    dedupedAbilities.push(ability);
  }

  return dedupedAbilities;
}
