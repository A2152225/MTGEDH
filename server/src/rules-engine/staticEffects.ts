import type { GameState, BattlefieldPermanent, PlayerID } from '../../../shared/src';

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
 * Abilities recognized: flying, indestructible, vigilance, trample, hexproof, shroud.
 *
 * Limitations:
 *  - Ignores layer ordering, timestamp precedence, dependency resolution.
 *  - Does not handle "+X/+0 until end of turn" (temporary effects).
 */

const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'];
const ABILITIES = ['flying', 'indestructible', 'vigilance', 'trample', 'hexproof', 'shroud'];

interface EffectAggregate {
  pDelta: number;
  tDelta: number;
  abilities: Set<string>;
}

export interface ContinuousEffectResult {
  perPermanent: Map<string, EffectAggregate>;
  playerHexproof: Set<PlayerID>;
  playerShroud: Set<PlayerID>;
}

function parseBuffSegment(seg: string): { p: number; t: number } | null {
  const m = seg.match(/\+(\d+)\s*\/\s*\+(\d+)/);
  if (m) return { p: parseInt(m[1], 10), t: parseInt(m[2], 10) };
  // Accept "+X/+Y" where Y may be same pattern
  return null;
}

function parseAbilities(text: string): string[] {
  const found: string[] = [];
  for (const a of ABILITIES) {
    const re = new RegExp(`\\b${a}\\b`, 'i');
    if (re.test(text)) found.push(a);
  }
  return found;
}

function isCreature(permanent: BattlefieldPermanent): boolean {
  const tl = ((permanent.card as any)?.type_line || '').toLowerCase();
  return /\bcreature\b/.test(tl);
}

function isColor(creature: BattlefieldPermanent, colorWord: string): boolean {
  // Very naive: checks oracle text or type line for color word; a robust system would parse card color identity.
  const tl = ((creature.card as any)?.type_line || '').toLowerCase();
  return tl.includes(colorWord.toLowerCase());
}

export function computeContinuousEffects(state: GameState): ContinuousEffectResult {
  const perPermanent = new Map<string, EffectAggregate>();
  const playerHexproof = new Set<PlayerID>();
  const playerShroud = new Set<PlayerID>();

  // Initialize aggregates
  for (const perm of state.battlefield) {
    if (isCreature(perm)) {
      perPermanent.set(perm.id, { pDelta: 0, tDelta: 0, abilities: new Set() });
    }
  }

  for (const source of state.battlefield) {
    const oracle = ((source.card as any)?.oracle_text || '').toLowerCase();
    if (!oracle) continue;
    const controller = source.controller;

    // Player hexproof/shroud
    if (/\byou have hexproof\b/.test(oracle)) playerHexproof.add(controller);
    if (/\byou have shroud\b/.test(oracle)) playerShroud.add(controller);

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

    // Creatures you control get +X/+Y (and maybe abilities)
    const ctrlBuffMatches = oracle.match(/creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/);
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
      const abilities = parseAbilities(tail);
      if (abilities.length) {
        for (const perm of state.battlefield) {
          if (perm.controller === controller && isCreature(perm)) {
            const agg = perPermanent.get(perm.id)!;
            for (const a of abilities) agg.abilities.add(a);
          }
        }
      }
    }

    // "Other creatures you control have <abilities>" (e.g., Shalai for OTHER creatures)
    // Must check before "creatures you control have" to handle "other" correctly
    const otherCtrlHaveMatch = oracle.match(/other creatures you control have ([^.]+)/);
    if (otherCtrlHaveMatch) {
      const abilities = parseAbilities(otherCtrlHaveMatch[1]);
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
      const abilities = parseAbilities(youAndOtherMatch[1]);
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
      const abilities = parseAbilities(youAndPermsMatch[1]);
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
    // Only match if the text doesn't say "other creatures"
    if (!otherCtrlHaveMatch && !youAndOtherMatch) {
      const ctrlHaveMatch = oracle.match(/creatures you control have ([^.]+)/);
      if (ctrlHaveMatch) {
        const abilities = parseAbilities(ctrlHaveMatch[1]);
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

    // Specific pattern: Eldrazi Monument style "creatures you control get +1/+1 and have flying and indestructible"
    const monumentMatch = oracle.match(/creatures you control get (\+\d+\s*\/\s*\+\d+)\s+and have\s+([^.]+)/);
    if (monumentMatch) {
      const buff = parseBuffSegment(monumentMatch[1]);
      const abilities = parseAbilities(monumentMatch[2]);
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
  }

  return { perPermanent, playerHexproof, playerShroud };
}