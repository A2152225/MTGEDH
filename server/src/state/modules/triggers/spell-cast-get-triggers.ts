/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover getSpellCastTriggers + extractCreatureTypes
 * Public: getSpellCastTriggers
 */

import { extractCreatureTypes as extractCreatureTypesFromTypeLine } from "../../../../../shared/src/creatureTypes.js";
import { debug } from "../../../utils/debug.js";
import type { GameContext } from "../../context.js";
import { cardHasCreatureType } from "../../creatureTypeNow.js";
import { getEffectiveColors } from "../effectiveColors.js";
import { detectSpellCastTriggers } from "./spell-cast-detection.js";
import { spellSharesCreatureTypeWithSource } from "./spellCastSharedCreatureType.js";
import type { SpellCastTrigger } from "./spell-cast-trigger-type.js";
/**
 * Get all spell-cast triggers that should fire when a spell is cast
 */
export function getSpellCastTriggers(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  const isHistoricSpell = spellTypeLine.includes('artifact') || spellTypeLine.includes('legendary') || spellTypeLine.includes('saga');
  const spellColors = Array.isArray(spellCard?.colors)
    ? spellCard.colors.map((color: string) => String(color).toLowerCase())
    : (Array.isArray(spellCard?.color_identity) ? spellCard.color_identity.map((color: string) => String(color).toLowerCase()) : []);
  // Check if this is a Kindred/Tribal spell (e.g., "Kindred Sorcery — Merfolk")
  const isKindredOrTribal = spellTypeLine.includes('kindred') || spellTypeLine.includes('tribal');
  
  // Extract creature types from the spell (for tribal triggers)
  // This works for both creature spells and Kindred/Tribal spells
  const spellCreatureTypes = extractCreatureTypes(spellTypeLine);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue; // Only controller's permanents trigger
    
    const permTriggers = detectSpellCastTriggers(permanent.card, permanent, ctx.state);
    
    for (const trigger of permTriggers) {
      if (trigger.triggerEvent === 'cycle') continue; // cycle triggers never fire on a spell cast
      let shouldTrigger = false;
      
      switch (trigger.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'creature':
          shouldTrigger = isCreatureSpell;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
        case 'historic':
          shouldTrigger = isHistoricSpell;
          break;
        case 'artifact_or_creature':
          shouldTrigger = isCreatureSpell || spellTypeLine.includes('artifact');
          break;
        case 'tribal_type':
          // Check if the spell has the tribal type.
          // This includes:
          // 1. Creature spells with the subtype (e.g., "Creature — Merfolk Wizard")
          // 2. Kindred/Tribal spells with the subtype (e.g., "Kindred Sorcery — Merfolk")
          // 3. Cards with changeling, which have every creature type in every zone
          if (trigger.tribalType) {
            const tribalTypeLower = trigger.tribalType.toLowerCase();
            shouldTrigger = cardHasCreatureType(spellCard, tribalTypeLower)
              || spellCreatureTypes.includes(tribalTypeLower)
              || spellTypeLine.includes(tribalTypeLower);
            
            // Debug log for troubleshooting
            if (shouldTrigger) {
              debug(2, `[getSpellCastTriggers] Tribal trigger fired: ${trigger.cardName} for ${tribalTypeLower} spell`);
            }
          }
          break;
        case 'color':
          if (trigger.tribalType) {
            shouldTrigger = spellColors.includes(trigger.tribalType.toLowerCase());
          }
          break;
        case 'chosen_color': {
          const chosen = String(
            (permanent as any).chosenColor
            || (permanent as any).card?.chosenColor
            || '',
          ).trim().toLowerCase();
          const colorWordToSymbol: Record<string, string> = {
            white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
            w: 'w', u: 'u', b: 'b', r: 'r', g: 'g',
          };
          const chosenSymbol = colorWordToSymbol[chosen] || chosen;
          const effectiveSpellColors = getEffectiveColors(spellCard, ctx.state).map((c) => c.toLowerCase());
          shouldTrigger = Boolean(chosenSymbol) && (
            effectiveSpellColors.includes(chosen)
            || effectiveSpellColors.includes(chosenSymbol)
          );
          break;
        }
      }

      if (shouldTrigger && trigger.firstSpellDuringOpponentTurn === true) {
        const activePlayer = String((ctx.state as any)?.activePlayer || '');
        const controllerId = String(permanent.controller || '');
        const spellsCastThisTurn = (Array.isArray(ctx.state?.spellsCastThisTurn) ? ctx.state.spellsCastThisTurn : [])
          .filter((castEntry: any) => String(castEntry?.casterId || '') === casterId);
        shouldTrigger = activePlayer !== controllerId && spellsCastThisTurn.length === 1;
      }

      if (shouldTrigger && trigger.requiresSharedCreatureTypeWithSource) {
        shouldTrigger = spellSharesCreatureTypeWithSource(spellCard, permanent);
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  return extractCreatureTypesFromTypeLine(typeLine).map((type) => String(type || '').toLowerCase());
}
