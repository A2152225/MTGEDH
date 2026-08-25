// server/src/rules-engine/targeting-handlers/targetingCategorizeStackCounterSimpleTemplates.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: categorizeSpellWithoutPrimaryRetirement stack/counter-target
//   patterns plus DRAW/DISCARD, Blight, LIFE, COUNTERS, and TOKENS templates.
// Public entry symbols: tryCategorizeStackCounterSimpleTemplates.

import type { SpellSpec, SpellTypeFilter } from './targetingSpellSpecTypes.js';
import { parseCountWord, titleCaseWords } from './targetingCategorizeCountUtils.js';

export function tryCategorizeStackCounterSimpleTemplates(t: string): SpellSpec | null {
  // Check for counterspells - these target spells on the stack
  // Pattern: "counter target spell" or "counter target instant or sorcery" etc.
  if (/counter target\s+(?:\w+\s+)?spell\b/.test(t) || /counter target\s+(?:instant|sorcery)/.test(t)) {
    // Determine spell type filter
    let spellTypeFilter: SpellTypeFilter = 'ANY_SPELL';
    
    if (/counter target noncreature spell/.test(t)) {
      spellTypeFilter = 'NONCREATURE';
    } else if (/counter target creature spell/.test(t)) {
      spellTypeFilter = 'CREATURE_SPELL';
    } else if (/counter target instant or sorcery/.test(t) || /counter target instant or sorcery spell/.test(t)) {
      spellTypeFilter = 'INSTANT_SORCERY';
    }
    
    return { 
      op: 'COUNTER_TARGET_SPELL', 
      filter: 'ANY', 
      minTargets: 1, 
      maxTargets: 1,
      spellTypeFilter,
    };
  }

  // Check for ability counters (Stifle, Tale's End, etc.)
  if (/counter target (?:activated|triggered) ability/.test(t)) {
    return { 
      op: 'COUNTER_TARGET_ABILITY', 
      filter: 'ANY', 
      minTargets: 1, 
      maxTargets: 1,
    };
  }

  // ========================================================================
  // DRAW / DISCARD (simple single-sentence templates)
  // Keep these conservative; avoid matching multi-sentence loot/wheel effects.
  // ========================================================================
  {
    const m = t.trim().match(/^draw\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\.?$/i);
    if (m) {
      const n = parseCountWord(m[1]);
      if (n !== null) return { op: 'DRAW_CARDS', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    const m = t.trim().match(/^each\s+opponent\s+draws?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DRAW_CARDS_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'DRAW_CARDS_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    const m = t.trim().match(/^each\s+player\s+draws?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DRAW_CARDS_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'DRAW_CARDS_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    const m = t.trim().match(/^target\s+player\s+draws?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?\.?$/i);
    if (m) {
      const raw = m[1];
      if (String(raw).toLowerCase() === 'x') {
        return { op: 'DRAW_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amountIsX: true, targetDescription: 'target player' };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'DRAW_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: n, targetDescription: 'target player' };
    }
  }
  {
    const m = t.trim().match(/^target\s+player\s+discards?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\.?$/i);
    if (m) {
      const n = parseCountWord(m[1]);
      if (n !== null) return { op: 'DISCARD_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: n, targetDescription: 'target player' };
    }
  }
  {
    const m = t.trim().match(/^each\s+opponent\s+discards?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DISCARD_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'DISCARD_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    const m = t.trim().match(/^each\s+player\s+discards?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'DISCARD_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'DISCARD_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }

  // ========================================================================
  // LORWYN ECLIPSED: Blight (keyword action)
  // Reminder text (Scryfall): "To blight N, a player puts N -1/-1 counters on a creature they control."
  // ========================================================================
  {
    // "Each opponent blights 1." (often with reminder text in parentheses)
    const m = t.trim().match(/^each\s+opponent\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s*\.(?:\s*\(.*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'BLIGHT_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'BLIGHT_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    // "Target opponent blights 2." (often with reminder text in parentheses)
    const m = t.trim().match(/^target\s+opponent\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s*\.(?:\s*\(.*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'BLIGHT_TARGET_OPPONENT',
          filter: 'ANY',
          minTargets: 1,
          maxTargets: 1,
          amountIsX: true,
          opponentOnly: true,
          targetDescription: 'target opponent',
        };
      }

      const n = parseCountWord(raw);
      if (n !== null) {
        return {
          op: 'BLIGHT_TARGET_OPPONENT',
          filter: 'ANY',
          minTargets: 1,
          maxTargets: 1,
          amount: n,
          opponentOnly: true,
          targetDescription: 'target opponent',
        };
      }
    }
  }
  {
    // "Each player blights N."
    const m = t.trim().match(/^each\s+player\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s*\.(?:\s*\(.*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'BLIGHT_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'BLIGHT_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    // "Target player blights N."
    const m = t.trim().match(/^target\s+player\s+blights?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s*\.(?:\s*\(.*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'BLIGHT_TARGET_PLAYER',
          filter: 'ANY',
          minTargets: 1,
          maxTargets: 1,
          amountIsX: true,
          targetDescription: 'target player',
        };
      }

      const n = parseCountWord(raw);
      if (n !== null) {
        return {
          op: 'BLIGHT_TARGET_PLAYER',
          filter: 'ANY',
          minTargets: 1,
          maxTargets: 1,
          amount: n,
          targetDescription: 'target player',
        };
      }
    }
  }
  {
    // "Blight N." (implicit: you blight N)
    const m = t.trim().match(/^blight\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s*\.(?:\s*\(.*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') return { op: 'BLIGHT_SELF', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'BLIGHT_SELF', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }

  // ========================================================================
  // LIFE GAIN / LOSS (conservative single-sentence templates)
  // ========================================================================
  {
    // "You gain N life." / "Gain N life."
    const m = t.trim().match(/^(?:you\s+)?gain\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'GAIN_LIFE', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'GAIN_LIFE', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    // "Target player gains N life."
    const m = t.trim().match(/^target\s+player\s+gains?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'GAIN_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amountIsX: true, targetDescription: 'target player' };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'GAIN_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: n, targetDescription: 'target player' };
    }
  }
  {
    // "Each opponent gains N life."
    const m = t.trim().match(/^each\s+opponent\s+gains?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'GAIN_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'GAIN_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    // "Each player gains N life."
    const m = t.trim().match(/^each\s+player\s+gains?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'GAIN_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'GAIN_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    // "You lose N life." / "Lose N life."
    const m = t.trim().match(/^(?:you\s+)?lose\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'LOSE_LIFE', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'LOSE_LIFE', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    // "Target player loses N life."
    const m = t.trim().match(/^target\s+player\s+loses?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'LOSE_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amountIsX: true, targetDescription: 'target player' };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'LOSE_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: n, targetDescription: 'target player' };
    }
  }
  {
    // "Each opponent loses N life."
    const m = t.trim().match(/^each\s+opponent\s+loses?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'LOSE_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'LOSE_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }
  {
    // "Each player loses N life."
    const m = t.trim().match(/^each\s+player\s+loses?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+life\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return { op: 'LOSE_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amountIsX: true };
      }
      const n = parseCountWord(raw);
      if (n !== null) return { op: 'LOSE_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: n };
    }
  }

  // ========================================================================
  // COUNTERS
  // ========================================================================
  {
    const m = t.trim().match(/^put\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+\+1\/\+1\s+counters?\s+on\s+target\s+creature(?:\s+that\s+entered(?:\s+(?:the\s+)?battlefield)?\s+this\s+turn)?\.?$/i);
    if (m) {
      const raw = m[1];
      const amountIsX = String(raw).toLowerCase() === 'x';
      const n = amountIsX ? undefined : parseCountWord(raw) ?? undefined;
      const hasEnteredThisTurnRestriction = /target\s+creature\s+that\s+entered(?:\s+(?:the\s+)?battlefield)?\s+this\s+turn/i.test(t);
      return {
        op: 'ADD_COUNTERS_TARGET',
        filter: 'CREATURE',
        minTargets: 1,
        maxTargets: 1,
        counterType: '+1/+1',
        ...(hasEnteredThisTurnRestriction
          ? {
              targetRestriction: {
                type: 'entered_this_turn',
                description: 'that entered this turn',
              },
              targetDescription: 'creature that entered this turn',
            }
          : { targetDescription: 'target creature' }),
        ...(amountIsX ? { amountIsX: true } : { amount: n ?? 1 }),
      };
    }
  }
  {
    const m = t.trim().match(/^put\s+a\s+\+1\/\+1\s+counter\s+on\s+up\s+to\s+(one|two|three|four|five|\d+)\s+target\s+creatures?\.?$/i);
    if (m) {
      const max = parseCountWord(m[1]) ?? 1;
      return {
        op: 'ADD_COUNTERS_TARGET',
        filter: 'CREATURE',
        minTargets: 0,
        maxTargets: max,
        amount: 1,
        counterType: '+1/+1',
        targetDescription: `up to ${m[1]} target creature${max === 1 ? '' : 's'}`,
      };
    }
  }
  {
    const m = t.trim().match(/^put\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+-1\/-1\s+counters?\s+on\s+target\s+creature(?:\s+that\s+entered(?:\s+(?:the\s+)?battlefield)?\s+this\s+turn)?\.?$/i);
    if (m) {
      const raw = m[1];
      const amountIsX = String(raw).toLowerCase() === 'x';
      const n = amountIsX ? undefined : parseCountWord(raw) ?? undefined;
      const hasEnteredThisTurnRestriction = /target\s+creature\s+that\s+entered(?:\s+(?:the\s+)?battlefield)?\s+this\s+turn/i.test(t);
      return {
        op: 'ADD_COUNTERS_TARGET',
        filter: 'CREATURE',
        minTargets: 1,
        maxTargets: 1,
        counterType: '-1/-1',
        ...(hasEnteredThisTurnRestriction
          ? {
              targetRestriction: {
                type: 'entered_this_turn',
                description: 'that entered this turn',
              },
              targetDescription: 'creature that entered this turn',
            }
          : { targetDescription: 'target creature' }),
        ...(amountIsX ? { amountIsX: true } : { amount: n ?? 1 }),
      };
    }
  }
  {
    const m = t.trim().match(/^put\s+a\s+-1\/-1\s+counter\s+on\s+up\s+to\s+(one|two|three|four|five|\d+)\s+target\s+creatures?\.?$/i);
    if (m) {
      const max = parseCountWord(m[1]) ?? 1;
      return {
        op: 'ADD_COUNTERS_TARGET',
        filter: 'CREATURE',
        minTargets: 0,
        maxTargets: max,
        amount: 1,
        counterType: '-1/-1',
        targetDescription: `up to ${m[1]} target creature${max === 1 ? '' : 's'}`,
      };
    }
  }
  {
    const m = t.trim().match(/^put\s+a\s+\+1\/\+1\s+counter\s+on\s+each\s+of\s+up\s+to\s+(one|two|three|four|five|\d+)\s+target\s+creatures\.?$/i);
    if (m) {
      const max = parseCountWord(m[1]) ?? 1;
      return {
        op: 'ADD_COUNTERS_TARGET',
        filter: 'CREATURE',
        minTargets: 0,
        maxTargets: max,
        amount: 1,
        counterType: '+1/+1',
        targetDescription: `up to ${m[1]} target creature${max === 1 ? '' : 's'}`,
      };
    }
  }
  {
    const m = t.trim().match(/^put\s+a\s+-1\/-1\s+counter\s+on\s+each\s+of\s+up\s+to\s+(one|two|three|four|five|\d+)\s+target\s+creatures\.?$/i);
    if (m) {
      const max = parseCountWord(m[1]) ?? 1;
      return {
        op: 'ADD_COUNTERS_TARGET',
        filter: 'CREATURE',
        minTargets: 0,
        maxTargets: max,
        amount: 1,
        counterType: '-1/-1',
        targetDescription: `up to ${m[1]} target creature${max === 1 ? '' : 's'}`,
      };
    }
  }
  {
    if (/^put\s+a\s+\+1\/\+1\s+counter\s+on\s+each\s+creature\s+you\s+control\.?$/i.test(t.trim())) {
      return {
        op: 'ADD_COUNTERS_EACH',
        filter: 'CREATURE',
        minTargets: 0,
        maxTargets: 0,
        amount: 1,
        counterType: '+1/+1',
        controllerOnly: true,
      };
    }
  }
  {
    if (/^put\s+a\s+-1\/-1\s+counter\s+on\s+each\s+creature\s+you\s+control\.?$/i.test(t.trim())) {
      return {
        op: 'ADD_COUNTERS_EACH',
        filter: 'CREATURE',
        minTargets: 0,
        maxTargets: 0,
        amount: 1,
        counterType: '-1/-1',
        controllerOnly: true,
      };
    }
  }

  // TOKENS
  {
    // Investigate.
    // e.g. "Investigate." / "Investigate. (Create a Clue token...)"
    const m = t.trim().match(/^investigate\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      return {
        op: 'INVESTIGATE',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        tokenKind: 'CLUE',
        tokenCount: 1,
      };
    }
  }
  {
    // Investigate twice.
    const m = t.trim().match(/^investigate\s+twice\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      return {
        op: 'INVESTIGATE',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        tokenKind: 'CLUE',
        tokenCount: 2,
      };
    }
  }
  {
    // Create a Treasure/Clue/Food token.
    // e.g. "Create a Treasure token." (+ reminder text)
    const m = t.trim().match(/^create\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(treasure|clue|food)\s+tokens?\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = m[1];
      const kindRaw = m[2].toLowerCase();
      const tokenKind = (kindRaw === 'treasure' ? 'TREASURE' : kindRaw === 'food' ? 'FOOD' : 'CLUE') as SpellSpec['tokenKind'];
      const countIsX = String(raw).toLowerCase() === 'x';
      const n = countIsX ? undefined : parseCountWord(raw) ?? undefined;
      return {
        op: 'CREATE_TOKEN',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        tokenKind,
        ...(countIsX ? { tokenCountIsX: true } : { tokenCount: n ?? 1 }),
      };
    }
  }
  {
    // Create a {P}/{T} {color} {Subtype} creature token.
    // e.g. "Create a 1/1 green Saproling creature token."
    // Only supports single-color, single-subtype, and explicit P/T.
    const m = t.trim().match(/^create\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(\d+)\/(\d+)\s+(white|blue|black|red|green|colorless)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+creature\s+tokens?\.?$/i);
    if (m) {
      const count = parseCountWord(m[1]) ?? 1;
      const power = parseInt(m[2], 10);
      const toughness = parseInt(m[3], 10);
      const color = m[4].toLowerCase() as NonNullable<SpellSpec['tokenColor']>;
      const subtype = titleCaseWords(m[5]);
      return {
        op: 'CREATE_TOKEN',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        tokenKind: 'CREATURE',
        tokenCount: count,
        tokenPower: power,
        tokenToughness: toughness,
        tokenColor: color,
        tokenSubtype: subtype,
        tokenName: `${subtype} Token`,
      };
    }
  }
  return null;
}
