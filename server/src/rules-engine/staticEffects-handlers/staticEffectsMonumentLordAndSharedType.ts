// server/src/rules-engine/staticEffects-handlers/staticEffectsMonumentLordAndSharedType.ts
// Origin parent: server/src/rules-engine/staticEffects.ts
// Cluster moved: the monument / creature-type-lord / nonblack-nonhuman /
//   Coat of Arms / Sliver Legion phase of computeContinuousEffects.
// Public entry symbols: applyMonumentLordAndSharedTypeEffects.

import type { BattlefieldPermanent, GameState, PlayerID } from '../../../../shared/src';
import type { EffectAggregate } from './staticEffectsScanHelpers.js';
import {
  CREATURE_TYPES,
  countOtherCreaturesSharingType,
  hasCreatureType,
  isCreature,
  parseBuffSegment,
  resolveGrantedAbilities,
} from './staticEffectsScanHelpers.js';

export function applyMonumentLordAndSharedTypeEffects(
  state: GameState,
  source: BattlefieldPermanent,
  oracle: string,
  controller: PlayerID,
  skipLegacyStatic: boolean,
  perPermanent: Map<string, EffectAggregate>,
): void {
    if (!skipLegacyStatic) {
    // Specific pattern: Eldrazi Monument style "creatures you control get +1/+1 and have flying and indestructible"
    const monumentMatch = oracle.match(/(?<!nonblack )(?<!non[- ]?human )(?<!legendary )creatures you control get (\+\d+\s*\/\s*\+\d+)\s+and have\s+([^.]+)/);
    if (monumentMatch) {
      const buff = parseBuffSegment(monumentMatch[1]);
      const abilities = resolveGrantedAbilities(source, monumentMatch[2]);
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += buff.p;
            agg.tDelta += buff.t;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }
    
    // ============================================
    // CREATURE TYPE LORD EFFECTS
    // ============================================
    const hasDeathBaronCompound = /skeletons you control and other zombies you control get/i.test(oracle);

    // Pattern: "Other [TYPE]s (you control) get +X/+Y"
    // Examples: Valiant Veteran ("Other Soldiers you control get +1/+1")
    //           Lord of Atlantis ("Other Merfolk get +1/+1 and have islandwalk") - GLOBAL effect
    //           Goblin King ("Other Goblins get +1/+1 and have mountainwalk") - GLOBAL effect
    //           Field Marshal ("Other Soldier creatures get +1/+1 and have first strike.") - GLOBAL effect
    //           Death Baron ("Skeletons you control and other Zombies you control get +1/+1 and have deathtouch")
    //           Elvish Archdruid ("Other Elf creatures you control get +1/+1")
    
    // First, check for "Other [TYPE]s you control get +X/+Y" pattern
    for (const creatureType of CREATURE_TYPES) {
      if (creatureType === 'zombie' && hasDeathBaronCompound) continue;
      // Pattern 1a: "Other [TYPE](s) (creatures) you control get +X/+Y" (controller-only lord)
      // Pattern 1b: "Other [TYPE](s) (creatures) get +X/+Y" (GLOBAL lord - no "you control")
      // 
      // The key difference is:
      // - If "you control" is present: only affects controller's creatures
      // - If "you control" is absent: affects ALL creatures of that type (global effect)
      //
      // Examples:
      //   - Field Marshal: "Other Soldier creatures get +1/+1 and have first strike" (GLOBAL)
      //   - Lord of Atlantis: "Other Merfolk get +1/+1 and have islandwalk" (GLOBAL)
      //   - Valiant Veteran: "Other Soldiers you control get +1/+1" (controller only)
      
      const otherTypeBuffPattern = new RegExp(
        `other\\s+${creatureType}s?\\s+(?:creatures?\\s+)?(?:(you\\s+control)\\s+)?get\\s+(\\+\\d+\\s*/\\s*\\+\\d+)([^.]*)`,
        'i'
      );
      const otherTypeMatch = oracle.match(otherTypeBuffPattern);
      if (otherTypeMatch) {
        const hasYouControl = !!otherTypeMatch[1]; // Check if "you control" was captured
        const buff = parseBuffSegment(otherTypeMatch[2]);
        if (buff) {
          for (const perm of state.battlefield) {
            // "Other" means exclude source, must be the creature type
            // If "you control" is present, restrict to controller's creatures
            // If "you control" is absent, this is a GLOBAL effect affecting ALL creatures of that type
            const matchesController = hasYouControl ? (perm.controller === controller) : true;
            
            if (matchesController && 
                isCreature(perm) && 
                perm.id !== source.id && 
                hasCreatureType(perm, creatureType)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
              // Check for abilities in the tail text (e.g., "and have first strike")
              const tail = otherTypeMatch[3] || '';
              const abilities = resolveGrantedAbilities(source, tail);
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
      }
      
      // Pattern 2: "[TYPE](s) (creatures) you control get +X/+Y" (affects all including self)
      const typeBuffPattern = new RegExp(
        `(?<!other\\s+)(?<!non[- ]?)${creatureType}s?\\s+(?:creatures?\\s+)?you\\s+control\\s+get\\s+(\\+\\d+\\s*/\\s*\\+\\d+)([^.]*)`,
        'i'
      );
      const typeMatch = oracle.match(typeBuffPattern);
      if (typeMatch && !otherTypeMatch) { // Don't double-apply if already matched "other"
        const buff = parseBuffSegment(typeMatch[1]);
        if (buff) {
          for (const perm of state.battlefield) {
            if (perm.controller === controller && 
                isCreature(perm) && 
                hasCreatureType(perm, creatureType)) {
              const agg = perPermanent.get(perm.id)!;
              agg.pDelta += buff.p;
              agg.tDelta += buff.t;
              // Check for abilities in the tail text
              const tail = typeMatch[2] || '';
              const abilities = resolveGrantedAbilities(source, tail);
              for (const a of abilities) agg.abilities.add(a);
            }
          }
        }
      }
      
      // Pattern 3: "Other [TYPE] creatures you control have [ABILITIES]"
      const otherTypeAbilitiesPattern = new RegExp(
        `other\\s+${creatureType}\\s+creatures?\\s+you\\s+control\\s+have\\s+([^.]+)`,
        'i'
      );
      const otherTypeAbilitiesMatch = oracle.match(otherTypeAbilitiesPattern);
      if (otherTypeAbilitiesMatch) {
        const abilities = resolveGrantedAbilities(source, otherTypeAbilitiesMatch[1]);
        for (const perm of state.battlefield) {
          if (perm.controller === controller && 
              isCreature(perm) && 
              perm.id !== source.id && 
              hasCreatureType(perm, creatureType)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }

      // Pattern 3b: "[TYPE] creatures you control have [ABILITIES]" (includes self)
      // Example: Archon of Sun's Grace — "Pegasus creatures you control have lifelink."
      const typeAbilitiesPattern = new RegExp(
        `(?<!other\\s+)${creatureType}\\s+creatures?\\s+you\\s+control\\s+have\\s+([^.]+)`,
        'i'
      );
      const typeAbilitiesMatch = oracle.match(typeAbilitiesPattern);
      if (typeAbilitiesMatch && !otherTypeAbilitiesMatch) {
        const abilities = resolveGrantedAbilities(source, typeAbilitiesMatch[1]);
        for (const perm of state.battlefield) {
          if (perm.controller === controller &&
              isCreature(perm) &&
              hasCreatureType(perm, creatureType)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
      
      // Pattern 4: "Other [TYPE] creatures have [ABILITIES]" (GLOBAL ability grant - no "you control")
      // Example: If a card said "Other Soldier creatures have first strike" (affects all players)
      // This pattern should NOT match if "you control" is present
      const otherTypeGlobalAbilitiesPattern = new RegExp(
        `other\\s+${creatureType}\\s+creatures?\\s+have\\s+([^.]+)`,
        'i'
      );
      const otherTypeGlobalAbilitiesMatch = oracle.match(otherTypeGlobalAbilitiesPattern);
      // Only process if:
      // 1. We matched the pattern
      // 2. The "you control" pattern did NOT match (already handled above)
      // 3. The oracle text doesn't contain "you control" for this type (double-check)
      const hasYouControlAbilities = oracle.match(new RegExp(`other\\s+${creatureType}\\s+creatures?\\s+you\\s+control\\s+have`, 'i'));
      if (otherTypeGlobalAbilitiesMatch && !otherTypeAbilitiesMatch && !hasYouControlAbilities) {
        const abilities = resolveGrantedAbilities(source, otherTypeGlobalAbilitiesMatch[1]);
        for (const perm of state.battlefield) {
          // Global effect - affects ALL creatures of the type, not just controller's
          if (isCreature(perm) && 
              perm.id !== source.id && 
              hasCreatureType(perm, creatureType)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }

    const deathBaronMatch = oracle.match(/skeletons you control and other zombies you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
    if (deathBaronMatch) {
      const buff = parseBuffSegment(deathBaronMatch[1]);
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller !== controller || !isCreature(perm)) continue;
          const qualifies =
            hasCreatureType(perm, 'skeleton')
            || (perm.id !== source.id && hasCreatureType(perm, 'zombie'));
          if (!qualifies) continue;
          const agg = perPermanent.get(perm.id)!;
          agg.pDelta += buff.p;
          agg.tDelta += buff.t;
          const abilities = resolveGrantedAbilities(source, deathBaronMatch[2] || '');
          for (const ability of abilities) agg.abilities.add(ability);
        }
      }
    }

    const nonblackMatch = oracle.match(/nonblack creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
    if (nonblackMatch) {
      const buff = parseBuffSegment(nonblackMatch[1]);
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller !== controller || !isCreature(perm)) continue;
          const colors = ((perm.card as any)?.colors || []).map((entry: string) => String(entry).toUpperCase());
          if (colors.includes('B')) continue;
          const agg = perPermanent.get(perm.id)!;
          agg.pDelta += buff.p;
          agg.tDelta += buff.t;
          const abilities = resolveGrantedAbilities(source, nonblackMatch[2] || '');
          for (const ability of abilities) agg.abilities.add(ability);
        }
      }
    }

    const nonHumanMatch = oracle.match(/non[- ]?human creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
    if (nonHumanMatch) {
      const buff = parseBuffSegment(nonHumanMatch[1]);
      if (buff) {
        for (const perm of state.battlefield) {
          if (perm.controller !== controller || !isCreature(perm)) continue;
          const typeLine = String((perm.card as any)?.type_line || '').toLowerCase();
          if (typeLine.includes('human')) continue;
          const agg = perPermanent.get(perm.id)!;
          agg.pDelta += buff.p;
          agg.tDelta += buff.t;
          const abilities = resolveGrantedAbilities(source, nonHumanMatch[2] || '');
          for (const ability of abilities) agg.abilities.add(ability);
        }
      }
    }
    }

    if (!skipLegacyStatic) {
    const coatOfArmsMatch = oracle.match(
      /each creature gets \+(\d+)\/\+(\d+) for each other creature on the battlefield that shares at least one creature type with it/i,
    );
    if (coatOfArmsMatch) {
      const pPer = parseInt(coatOfArmsMatch[1], 10);
      const tPer = parseInt(coatOfArmsMatch[2], 10);
      if (!Number.isNaN(pPer) && !Number.isNaN(tPer)) {
        for (const perm of state.battlefield) {
          if (!isCreature(perm)) continue;
          const sharedCount = countOtherCreaturesSharingType(perm, state.battlefield);
          if (sharedCount <= 0) continue;
          const agg = perPermanent.get(perm.id)!;
          agg.pDelta += pPer * sharedCount;
          agg.tDelta += tPer * sharedCount;
        }
      }
    }

    const sliverLegionMatch = oracle.match(
      /(?:all )?sliver creatures get \+(\d+)\/\+(\d+) for each other sliver on the battlefield/i,
    );
    if (sliverLegionMatch) {
      const pPer = parseInt(sliverLegionMatch[1], 10);
      const tPer = parseInt(sliverLegionMatch[2], 10);
      if (!Number.isNaN(pPer) && !Number.isNaN(tPer)) {
        const sliverCreatures = state.battlefield.filter(
          (perm) => isCreature(perm) && hasCreatureType(perm, 'sliver'),
        );
        const otherSliverCount = Math.max(0, sliverCreatures.length - 1);
        if (otherSliverCount > 0) {
          for (const perm of sliverCreatures) {
            const agg = perPermanent.get(perm.id)!;
            agg.pDelta += pPer * otherSliverCount;
            agg.tDelta += tPer * otherSliverCount;
          }
        }
      }
    }
    }
}
