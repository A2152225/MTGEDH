import type { GameState, PlayerID } from '../../../shared/src';
import { sanitizeOracleTextForStaticEffectScan } from '../../../rules-engine/src/staticEffectOracleSanitize.js';

import { getTotalManaFromPool } from '../state/modules/mana-check.js';
import { infinityGrantedAbility, maxSpeedGrantedAbility } from '../state/modules/statefulPaperKeywords.js';
export { KNOWN_STATIC_EFFECT_CARDS } from './staticEffects-handlers/staticEffectsKnownCards.js';
export type { ContinuousEffectResult } from './staticEffects-handlers/staticEffectsScanHelpers.js';
import { applyMonumentLordAndSharedTypeEffects } from './staticEffects-handlers/staticEffectsMonumentLordAndSharedType.js';
import {
  COLOR_WORDS,
  GLOBAL_TYPE_ADDITIONS,
  creatureHasManaColor,
  hasCreatureType,
  isColor,
  isCreature,
  isLegendaryCreature,
  parseBuffSegment,
  parseCardCountWord,
  permanentCountsForControlTypeCondition,
  resolveGrantedAbilities,
} from './staticEffects-handlers/staticEffectsScanHelpers.js';
import type { ContinuousEffectResult, EffectAggregate } from './staticEffects-handlers/staticEffectsScanHelpers.js';

/**
 * Lightweight continuous effect scanner.
 * Supports additive constant buffs and keyword grants from simple oracle text templates:
 * Patterns (case-insensitive):
 *  - "creatures you control get +X/+Y"
 *  - "other creatures you control get +X/+Y"
 *  - "all creatures get +X/+Y"
 *  - "<color> creatures get +X/+Y" (color words: white, blue, black, red, green)
 *  - "creatures you control get +X/+Y and have <abilities...>"
 *  - "you have hexproof" / "you have shroud"
 *  - "creatures you control have <abilities...>"
 *  - "other creatures you control have <abilities...>"
 *  - "you and other creatures you control have <abilities...>" (Shalai, Voice of Plenty)
 *  - Combined examples: Eldrazi Monument, Crusade, Glorious Anthem, Leyline of Sanctity, Witchbane Orb.
 *
 * Abilities recognized: flying, indestructible, vigilance, trample, hexproof, shroud, deathtouch,
 *                       lifelink, haste, menace, reach, first strike, double strike, protection.
 *
 * Limitations:
 *  - Ignores layer ordering, timestamp precedence, dependency resolution.
 *  - Does not handle "+X/+0 until end of turn" (temporary effects).
 */


export interface ComputeContinuousEffectsOptions {
  /** Skip legacy anthem/lord/ability regex when declarative StaticEffectSpec owns the source. */
  skipDeclarativeStaticForSourceIds?: ReadonlySet<string>;
  /** @deprecated Use skipDeclarativeStaticForSourceIds */
  skipDeclarativePtForSourceIds?: ReadonlySet<string>;
}

export function computeContinuousEffects(
  state: GameState,
  options?: ComputeContinuousEffectsOptions,
): ContinuousEffectResult {
  const perPermanent = new Map<string, EffectAggregate>();
  const playerHexproof = new Set<PlayerID>();
  const playerShroud = new Set<PlayerID>();
  const permanentAbilities = new Map<string, Set<string>>();

  // Initialize aggregates for creatures and all permanents
  for (const perm of state.battlefield) {
    // Initialize ability tracking for ALL permanents (for Avacyn, etc.)
    permanentAbilities.set(perm.id, new Set());
    
    // Initialize creature-specific tracking
    if (isCreature(perm)) {
      perPermanent.set(perm.id, { pDelta: 0, tDelta: 0, abilities: new Set() });
    }
  }

  for (const source of state.battlefield) {
    const oracle = sanitizeOracleTextForStaticEffectScan((source.card as any)?.oracle_text || '').toLowerCase();
    if (!oracle) continue;
    const controller = source.controller;
    // CR 702.178 / 702.186: these are static abilities that conditionally
    // grant their following Oracle-text ability to this object.
    for (const granted of [
      maxSpeedGrantedAbility(source, state),
      infinityGrantedAbility(source),
    ]) {
      if (!granted) continue;
      const normalized = granted.toLowerCase();
      const ownAbilities = permanentAbilities.get(source.id);
      if (ownAbilities) ownAbilities.add(normalized);
      if (isCreature(source)) {
        const ownAggregate = perPermanent.get(source.id);
        if (ownAggregate) ownAggregate.abilities.add(normalized);
      }
    }
    const skipLegacyStatic = Boolean(
      options?.skipDeclarativeStaticForSourceIds?.has(String(source.id || ''))
      || options?.skipDeclarativePtForSourceIds?.has(String(source.id || '')),
    );

    // Player hexproof/shroud
    if (/\byou have hexproof\b/.test(oracle)) playerHexproof.add(controller);
    if (/\byou have shroud\b/.test(oracle)) playerShroud.add(controller);

    if (!skipLegacyStatic) {
    // Global patterns
    // All creatures get +X/+Y
    const allMatch = oracle.match(/all creatures get (\+\d+\s*\/\s*\+\d+)/);
    if (allMatch) {
      const buff = parseBuffSegment(allMatch[1]);
      if (buff) {
        for (const perm of state.battlefield) {
          if (isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
          }
        }
      }
    }

    // Color creatures get +X/+Y (global, e.g. Crusade)
    for (const colorWord of COLOR_WORDS) {
      const re = new RegExp(`${colorWord}\\s+creatures\\s+get\\s+(\\+\\d+\\s*/\\s*\\+\\d+)`, 'i');
      const m = oracle.match(re);
      if (m) {
        const buff = parseBuffSegment(m[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (isCreature(perm) && isColor(perm, colorWord)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
            }
          }
        }
      }
    }

    // ============================================
    // CONDITIONAL STATIC P/T (Phase 5.4)
    // ============================================
    const leylineLifeMatch = oracle.match(
      /if you have at least (\w+) life more than your starting life total, creatures you control get (\+\d+\s*\/\s*\+\d+)/i,
    );
    if (leylineLifeMatch) {
      const lifeOffset = parseCardCountWord(leylineLifeMatch[1]);
      const buff = parseBuffSegment(leylineLifeMatch[2]);
      if (lifeOffset !== undefined && buff) {
        const startingLife = Number((state as any).startingLife || 40);
        const currentLife = Number((state as any).life?.[controller] ?? startingLife);
        if (currentLife >= startingLife + lifeOffset) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && isCreature(perm)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
            }
          }
        }
      }
    }

    const tokenTurnBuffMatch = oracle.match(
      /during your turn,?\s*creature tokens you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i,
    );
    if (tokenTurnBuffMatch) {
      const isControllerTurn = String((state as any).turnPlayer || '') === String(controller);
      if (isControllerTurn) {
        const buff = parseBuffSegment(tokenTurnBuffMatch[1]);
        const tail = tokenTurnBuffMatch[2] || '';
        if (buff) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && isCreature(perm) && perm.isToken === true) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
              const abilities = resolveGrantedAbilities(source, tail);
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
      }
    }

    const tokenBuffMatch = !oracle.includes('during your turn')
      ? oracle.match(/creature tokens you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i)
      : null;
    if (tokenBuffMatch) {
      const buff = parseBuffSegment(tokenBuffMatch[1]);
      const tail = tokenBuffMatch[2] || '';
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm) && perm.isToken === true) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
            const abilities = resolveGrantedAbilities(source, tail);
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }

    const nontokenBuffMatch = oracle.match(/nontoken creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i);
    if (nontokenBuffMatch) {
      const buff = parseBuffSegment(nontokenBuffMatch[1]);
      const tail = nontokenBuffMatch[2] || '';
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm) && perm.isToken !== true) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
            const abilities = resolveGrantedAbilities(source, tail);
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }

    // Legendary creatures you control get +X/+Y (and maybe abilities)
    const legendaryCtrlBuffMatch = oracle.match(/legendary creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/);
    if (legendaryCtrlBuffMatch) {
      const buff = parseBuffSegment(legendaryCtrlBuffMatch[1]);
      const tail = legendaryCtrlBuffMatch[2] || '';
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isLegendaryCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
            const abilities = resolveGrantedAbilities(source, tail);
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }

    // Creatures you control get +X/+Y (and maybe abilities)
    const ctrlBuffMatches = !leylineLifeMatch && !tokenBuffMatch && !nontokenBuffMatch && !tokenTurnBuffMatch && !legendaryCtrlBuffMatch
      ? oracle.match(/(?<!nonblack )(?<!non[- ]?human )(?<!legendary )creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/)
      : null;
    if (ctrlBuffMatches) {
      const buffSeg = ctrlBuffMatches[1];
      const tail = ctrlBuffMatches[2];
      const buff = parseBuffSegment(buffSeg);
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
          }
        }
      }
      // Abilities in tail
      const abilities = resolveGrantedAbilities(source, tail);
      if (abilities.length) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }
    }

    if (!skipLegacyStatic) {
    // "Other creatures you control have <abilities>" (e.g., Shalai for OTHER creatures)
    // Must check before "creatures you control have" to handle "other" correctly
    const otherCtrlHaveMatch = oracle.match(/other creatures you control have ([^.]+)/);
    if (otherCtrlHaveMatch) {
      const abilities = resolveGrantedAbilities(source, otherCtrlHaveMatch[1]);
      if (abilities.length) {
        for (const perm of state.battlefield) {
          // "other" means exclude the source permanent itself
          if (perm.controller === controller && isCreature(perm) && perm.id !== source.id) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }
    
    // "You and other creatures you control have <abilities>" (Shalai, Voice of Plenty pattern)
    // This gives the player hexproof AND other creatures hexproof, but NOT the source creature
    const youAndOtherMatch = oracle.match(/you and other creatures you control have ([^.]+)/);
    if (youAndOtherMatch) {
      const abilities = resolveGrantedAbilities(source, youAndOtherMatch[1]);
      if (abilities.length) {
        // Grant abilities to OTHER creatures (not the source)
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm) && perm.id !== source.id) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
        // Grant player hexproof/shroud if those abilities are in the list
        if (abilities.includes('hexproof')) playerHexproof.add(controller);
        if (abilities.includes('shroud')) playerShroud.add(controller);
      }
    }
    
    // "You and permanents you control have <abilities>" (broader pattern)
    const youAndPermsMatch = oracle.match(/you and permanents you control have ([^.]+)/);
    if (youAndPermsMatch) {
      const abilities = resolveGrantedAbilities(source, youAndPermsMatch[1]);
      if (abilities.length) {
        // Grant abilities to ALL permanents (not just creatures), excluding self if "other" was in text
        const excludeSelf = oracle.includes('other permanents');
        for (const perm of state.battlefield) {
          if (perm.controller === controller && (!excludeSelf || perm.id !== source.id)) {
            // Only add to perPermanent if it's a creature (since perPermanent only tracks creatures)
            if (isCreature(perm)) {
              const agg = perPermanent.get(perm.id)!;
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
        // Grant player hexproof/shroud if those abilities are in the list
        if (abilities.includes('hexproof')) playerHexproof.add(controller);
        if (abilities.includes('shroud')) playerShroud.add(controller);
      }
    }

    // Creatures you control have <abilities> (but NOT if it matches "other creatures" already handled above)
    // Only match if the text doesn't say "other creatures" or "legendary creatures"
    // "As long as you have an enduring story, [scope] have [abilities]."
    // The designation is set by the Storied SBA, not by an individual card.
    const enduringStoryMatch = oracle.match(
      /as long as you have an enduring story,\s*((?:artifacts and )?creatures) you control have\s+([^.]+)/i,
    );
    if (enduringStoryMatch && (state as any).enduringStory?.[controller]) {
      const includesArtifacts = enduringStoryMatch[1].toLowerCase().includes('artifact');
      const abilities = resolveGrantedAbilities(source, enduringStoryMatch[2]);
      for (const perm of state.battlefield) {
        const typeLine = String((perm.card as any)?.type_line || '').toLowerCase();
        const applies = perm.controller === controller
          && (typeLine.includes('creature') || (includesArtifacts && typeLine.includes('artifact')));
        if (!applies) continue;
        const targetAbilities = isCreature(perm)
          ? perPermanent.get(perm.id)!.abilities
          : permanentAbilities.get(perm.id)!;
        for (const ability of abilities) targetAbilities.add(ability);
      }
    }

    if (!otherCtrlHaveMatch && !youAndOtherMatch && !enduringStoryMatch) {
      const ctrlHaveMatch = oracle.match(/(?<![a-z] )(?<!legendary )(?:all )?creatures you control have ([^.]+)/);
      if (ctrlHaveMatch) {
        const abilities = resolveGrantedAbilities(source, ctrlHaveMatch[1]);
        if (abilities.length) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && isCreature(perm)) {
              const agg = perPermanent.get(perm.id)!;
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
      }
    }

    // ============================================
    // ALL PERMANENTS ABILITY GRANTS (Avacyn, etc.)
    // ============================================
    // Pattern: "Other permanents you control have <abilities>" (Avacyn, Angel of Hope)
    // This grants abilities to ALL permanents (not just creatures), excluding the source
    const otherPermsHaveMatch = oracle.match(/other permanents you control have ([^.]+)/);
    if (otherPermsHaveMatch) {
      const abilities = resolveGrantedAbilities(source, otherPermsHaveMatch[1]);
      if (abilities.length) {
        for (const perm of state.battlefield) {
          // "other" means exclude the source permanent itself
          if (perm.controller === controller && perm.id !== source.id) {
            // Add to permanentAbilities map for ALL permanents
            const permAbilities = permanentAbilities.get(perm.id);
            if (permAbilities) {
              for (const a of abilities) permAbilities.add(a);
            }
            // Also add to creature-specific tracking if applicable
            if (isCreature(perm)) {
              const agg = perPermanent.get(perm.id);
              if (agg) {
                for (const a of abilities) agg.abilities.add(a);
              }
            }
          }
        }
      }
    }
    
    // Pattern: "Permanents you control have <abilities>" (without "other")
    // This grants abilities to ALL permanents including the source
    if (!otherPermsHaveMatch) {
      const permsHaveMatch = oracle.match(/permanents you control have ([^.]+)/);
      if (permsHaveMatch && !oracle.includes('other permanents')) {
        const abilities = resolveGrantedAbilities(source, permsHaveMatch[1]);
        if (abilities.length) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller) {
              // Add to permanentAbilities map for ALL permanents
              const permAbilities = permanentAbilities.get(perm.id);
              if (permAbilities) {
                for (const a of abilities) permAbilities.add(a);
              }
              // Also add to creature-specific tracking if applicable
              if (isCreature(perm)) {
                const agg = perPermanent.get(perm.id);
                if (agg) {
                  for (const a of abilities) agg.abilities.add(a);
                }
              }
            }
          }
        }
      }
    }
    
    // ============================================
    // CONDITIONAL INDESTRUCTIBLE (Svyelun, etc.)
    // ============================================
    // Pattern: "[Card] has indestructible as long as you control at least X other [TYPE]"
    // Examples: 
    // - Svyelun of Sea and Sky: "Svyelun has indestructible as long as you control at least two other Merfolk."
    const conditionalIndestructibleMatch = oracle.match(
      /has indestructible as long as you control at least (\w+) other (\w+)(?:\s+(creatures?))?/i,
    );
    if (conditionalIndestructibleMatch) {
      const countWord = conditionalIndestructibleMatch[1].toLowerCase();
      const requiredType = conditionalIndestructibleMatch[2].toLowerCase();
      const creaturesOnly = Boolean(conditionalIndestructibleMatch[3]);
      
      // Convert word to number (common number words for MTG card text)
      const requiredCount = parseCardCountWord(countWord);
      
      if (requiredCount === undefined) {
        // Skip this effect if we couldn't parse the count - better than silent wrong behavior
        continue;
      }
      
      // Count other permanents of the required type controlled by this player.
      // "Other Merfolk" includes kindred/tribal Merfolk; ETB chosen types on lands do not.
      // "... other Merfolk creatures" restricts to creature permanents only.
      let typeCount = 0;
      for (const perm of state.battlefield) {
        if (perm.controller === controller && perm.id !== source.id) {
          if (permanentCountsForControlTypeCondition(perm, requiredType, creaturesOnly)) {
            typeCount++;
          }
        }
      }
      
      // If condition is met, grant indestructible to the source
      if (typeCount >= requiredCount) {
        const permAbilities = permanentAbilities.get(source.id);
        if (permAbilities) {
          permAbilities.add('indestructible');
        }
        if (isCreature(source)) {
          const agg = perPermanent.get(source.id);
          if (agg) {
            agg.abilities.add('indestructible');
          }
        }
      }
    }

    // ============================================
    // CONDITIONAL SELF ABILITIES BASED ON UNSPENT MANA (Ozai)
    // ============================================
    // Pattern: "[Card] has flying and indestructible as long as you have six or more unspent mana."
    const manaThresholdAbilitiesMatch = oracle.match(/has ([^.]+?) as long as you have (\w+) or more unspent mana/i);
    if (manaThresholdAbilitiesMatch) {
      const requiredCount = parseCardCountWord(manaThresholdAbilitiesMatch[2]);
      if (requiredCount !== undefined) {
        const manaPool = ((state as any).manaPool || {})[String(controller)] || {};
        const totalUnspentMana = getTotalManaFromPool(manaPool);
        if (totalUnspentMana >= requiredCount) {
          const abilities = resolveGrantedAbilities(source, manaThresholdAbilitiesMatch[1]);
          if (abilities.length > 0) {
            const permAbilities = permanentAbilities.get(source.id);
            if (permAbilities) {
              for (const ability of abilities) permAbilities.add(ability);
            }
            if (isCreature(source)) {
              const agg = perPermanent.get(source.id);
              if (agg) {
                for (const ability of abilities) agg.abilities.add(ability);
              }
            }
          }
        }
      }
    }
    }

    applyMonumentLordAndSharedTypeEffects(
      state,
      source,
      oracle,
      controller,
      skipLegacyStatic,
      perPermanent,
    );

    
    // Handle "chosen type" effects (Morophon, Reflections of Littjara, etc.)
    // Pattern: "Other creatures you control of the chosen type get +X/+Y"
    // The chosen type is stored on the permanent as chosenCreatureType
    // Also read map / card field so Helm copies keep the lord after restart.
    const chosenType = String(
      (source as any).chosenCreatureType
      || (source as any).card?.chosenCreatureType
      || ((state as any).morophonChosenType || {})[String(source.id || '')]
      || '',
    ).trim();
    if (chosenType) {
      const oracle = ((source.card as any)?.oracle_text || '').toLowerCase();
      
      // Morophon pattern: "Other creatures you control of the chosen type get +1/+1"
      if (!skipLegacyStatic) {
      const chosenTypeBuffMatch = oracle.match(/other creatures you control of the chosen type get\s+(\+\d+\s*\/\s*\+\d+)/i);
      if (chosenTypeBuffMatch) {
        const buff = parseBuffSegment(chosenTypeBuffMatch[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && 
                isCreature(perm) && 
                perm.id !== source.id && 
                hasCreatureType(perm, chosenType)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
            }
          }
        }
      }
      }

      // Generic "chosen type" ability grants: "Creatures you control of the chosen type have [ABILITY]"
      if (!skipLegacyStatic) {
      const chosenTypeAbilitiesMatch = oracle.match(/creatures you control of the chosen type have\s+([^.]+)/i);
      if (chosenTypeAbilitiesMatch) {
        const abilities = resolveGrantedAbilities(source, chosenTypeAbilitiesMatch[1]);
        for (const perm of state.battlefield) {
          if (perm.controller === controller && 
              isCreature(perm) && 
              hasCreatureType(perm, chosenType)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }

      const globalChosenTypeAbilitiesMatch = oracle.match(/creatures of the chosen type have\s+([^.]+)/i);
      if (globalChosenTypeAbilitiesMatch) {
        const abilities = resolveGrantedAbilities(source, globalChosenTypeAbilitiesMatch[1]);
        for (const perm of state.battlefield) {
          if (isCreature(perm) && hasCreatureType(perm, chosenType)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
      }

      if (!skipLegacyStatic) {
      const globalChosenTypeBuffMatch = oracle.match(/creatures of the chosen type get\s+(\+\d+\s*\/\s*\+\d+)/i);
      if (globalChosenTypeBuffMatch) {
        const buff = parseBuffSegment(globalChosenTypeBuffMatch[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (isCreature(perm) && hasCreatureType(perm, chosenType)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
            }
          }
        }
      }
      }

      if (!skipLegacyStatic) {
      const controlledChosenTypeBuffMatch = oracle.match(/creatures you control of the chosen type get\s+(\+\d+\s*\/\s*\+\d+)/i);
      if (controlledChosenTypeBuffMatch) {
        const buff = parseBuffSegment(controlledChosenTypeBuffMatch[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller
              && isCreature(perm)
              && hasCreatureType(perm, chosenType)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
            }
          }
        }
      }
      }

      if (!skipLegacyStatic) {
      const opponentChosenTypeDebuffMatch = oracle.match(
        /creatures of the chosen type your opponents control get\s+([+-]?\d+)\s*\/\s*([+-]?\d+)/i,
      );
      if (opponentChosenTypeDebuffMatch) {
        const p = parseInt(opponentChosenTypeDebuffMatch[1], 10);
        const t = parseInt(opponentChosenTypeDebuffMatch[2], 10);
        if (!Number.isNaN(p) && !Number.isNaN(t)) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller || !isCreature(perm)) continue;
            if (!hasCreatureType(perm, chosenType)) continue;
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += p;
            agg.tDelta += t;
          }
        }
      }
      }

    }

    if (!skipLegacyStatic) {
    const chosenColor = String(
      (source as any).chosenColor || (source as any).card?.chosenColor || '',
    ).trim().toLowerCase();
    if (chosenColor) {
      const chosenColorBuffMatch = oracle.match(/creatures you control of the chosen color get\s+(\+\d+\s*\/\s*\+\d+)/i);
      if (chosenColorBuffMatch) {
        const buff = parseBuffSegment(chosenColorBuffMatch[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && isCreature(perm) && creatureHasManaColor(perm, chosenColor)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
            }
          }
        }
      }
    }
    }
  }

  // Detect global type-changing effects like Enchanted Evening and Mycosynth Lattice
  const typeAdditions = new Map<string, string[]>();
  
  for (const source of state.battlefield) {
    const cardName = ((source.card as any)?.name || '').toLowerCase();
    
    // Check known global type-addition cards
    for (const [knownName, effect] of Object.entries(GLOBAL_TYPE_ADDITIONS)) {
      if (cardName.includes(knownName) && effect.affectsAll) {
        // Add this type to ALL permanents
        for (const perm of state.battlefield) {
          const existingTypes = typeAdditions.get(perm.id) || [];
          if (!existingTypes.includes(effect.addsType)) {
            existingTypes.push(effect.addsType);
            typeAdditions.set(perm.id, existingTypes);
          }
        }
      }
    }
    
    // Dynamic detection: "All permanents are [type] in addition to their other types"
    const oracle = ((source.card as any)?.oracle_text || '').toLowerCase();
    const allPermsMatch = oracle.match(/all permanents are (\w+)s? in addition to their other types/i);
    if (allPermsMatch) {
      const addedType = allPermsMatch[1].charAt(0).toUpperCase() + allPermsMatch[1].slice(1);
      for (const perm of state.battlefield) {
        const existingTypes = typeAdditions.get(perm.id) || [];
        if (!existingTypes.includes(addedType)) {
          existingTypes.push(addedType);
          typeAdditions.set(perm.id, existingTypes);
        }
      }
    }
  }

  return {
    perPermanent,
    playerHexproof,
    playerShroud,
    typeAdditions,
    permanentAbilities,
    colorAdditions: new Map<string, string[]>(),
  };
}