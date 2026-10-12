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
import { spellOrdinalForCaster } from "./spell-cast.js";
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource, spellCastConditionMatches } from "./triggerConditionFamilyMatch.js";
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
      const parsedSpellMatch = spellCastConditionMatches({
        spellCondition: trigger.spellCondition,
        casterScope: 'you',
        spellCard,
        sourceControllerId: String(permanent.controller || casterId || ''),
        casterId,
        tribalType: spellDetailForTrigger(trigger, permanent),
        effectiveSpellColors: getEffectiveColors(spellCard, ctx.state),
      });
      let shouldTrigger = false;

      if (parsedSpellMatch !== null) {
        shouldTrigger = parsedSpellMatch;
      } else switch (trigger.spellCondition) {
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

    const spellOrdinal = spellOrdinalForCaster(ctx.state, casterId, spellCard);
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'spell_cast',
      subjectPermanent: spellCard,
      subjectControllerId: casterId,
      sourcePermanent: permanent,
      spellOrdinal,
      castFromZone: String(spellCard?.castSourceZone || spellCard?.fromZone || ''),
    })) {
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates([existing.effect, existing.description], line)
      ))) continue;
      const subject = line.condition?.alternatives[0]?.subject;
      const types = (subject?.typeGroups || []).flat();
      const subtype = (subject?.subtypeGroups || []).flat()[0];
      const spellCondition: SpellCastTrigger['spellCondition'] = subject?.historic
        ? 'historic'
        : subject?.colors?.length
          ? 'color'
          : types.includes('instant') || types.includes('sorcery')
            ? 'instant_sorcery'
            : subject?.excludedWords?.includes('creature')
              ? 'noncreature'
              : types.length === 1 && types[0] === 'creature'
                ? 'creature'
                : subtype
                  ? 'tribal_type'
                  : 'any';
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || casterId),
        description: line.effect,
        effect: line.effect,
        spellCondition,
        ...(subtype ? { tribalType: subtype } : {}),
        ...(subject?.colors?.length === 1 ? { tribalType: subject.colors[0] } : {}),
        mandatory: !/\byou may\b/i.test(line.effect),
        ...(line.condition?.ordinal === 'first' ? { firstSpellThisTurn: true } : {}),
      });
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

const SPELL_COLOR_WORD: Readonly<Record<string, string>> = {
  white: 'white', blue: 'blue', black: 'black', red: 'red', green: 'green',
  w: 'white', u: 'blue', b: 'black', r: 'red', g: 'green',
};

function spellDetailForTrigger(trigger: SpellCastTrigger, permanent: any): string | undefined {
  if (trigger.spellCondition === 'tribal_type' || trigger.spellCondition === 'color') {
    return trigger.tribalType;
  }
  if (trigger.spellCondition !== 'chosen_color') return undefined;
  const chosen = String(
    permanent?.chosenColor || permanent?.card?.chosenColor || '',
  ).trim().toLowerCase();
  return SPELL_COLOR_WORD[chosen] || chosen || undefined;
}
