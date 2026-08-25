// server/src/rules-engine/targeting-handlers/targetingCategorizeScryMillMassRemoval.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: categorizeSpellWithoutPrimaryRetirement SCRY/SURVEIL/MILL/GOAD
//   templates plus filter detection and DESTROY_ALL/EXILE_ALL/DESTROY_EACH.
// Public entry symbols: tryCategorizeScryMillMassRemoval.

import type { PermanentFilter, SpellSpec } from './targetingSpellSpecTypes.js';
import { parseCountWord } from './targetingCategorizeCountUtils.js';
import { detectCategorizePermanentFilter } from './targetingCategorizePermanentFilter.js';

export function tryCategorizeScryMillMassRemoval(t: string): SpellSpec | null {
  // SCRY
  {
    // Each opponent scries N.
    const m = t.trim().match(/^each\s+opponent\s+scries\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'SCRY_EACH_OPPONENT',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          scryCountIsX: true,
        };
      }
      const n = parseCountWord(raw) ?? 1;
      return {
        op: 'SCRY_EACH_OPPONENT',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        scryCount: n,
      };
    }
  }
  {
    // Each player scries N.
    const m = t.trim().match(/^each\s+player\s+scries\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'SCRY_EACH_PLAYER',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          scryCountIsX: true,
        };
      }
      const n = parseCountWord(raw) ?? 1;
      return {
        op: 'SCRY_EACH_PLAYER',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        scryCount: n,
      };
    }
  }
  {
    // Scry N.
    const m = t.trim().match(/^scry\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'SCRY',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          scryCountIsX: true,
        };
      }
      const n = parseCountWord(raw) ?? 1;
      return {
        op: 'SCRY',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        scryCount: n,
      };
    }
  }

  // SURVEIL
  {
    // Each opponent surveils N.
    const m = t.trim().match(/^each\s+opponent\s+surveils\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'SURVEIL_EACH_OPPONENT',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          surveilCountIsX: true,
        };
      }
      const n = parseCountWord(m[1]) ?? 1;
      return {
        op: 'SURVEIL_EACH_OPPONENT',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        surveilCount: n,
      };
    }
  }
  {
    // Each player surveils N.
    const m = t.trim().match(/^each\s+player\s+surveils\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'SURVEIL_EACH_PLAYER',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          surveilCountIsX: true,
        };
      }
      const n = parseCountWord(m[1]) ?? 1;
      return {
        op: 'SURVEIL_EACH_PLAYER',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        surveilCount: n,
      };
    }
  }
  {
    // Surveil N.
    const m = t.trim().match(/^surveil\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'SURVEIL',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          surveilCountIsX: true,
        };
      }
      const n = parseCountWord(m[1]) ?? 1;
      return {
        op: 'SURVEIL',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        surveilCount: n,
      };
    }
  }
  {
    // Target player surveils N.
    const m = t.trim().match(/^target\s+player\s+surveils\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'SURVEIL_TARGET_PLAYER',
          filter: 'ANY',
          minTargets: 1,
          maxTargets: 1,
          surveilCountIsX: true,
          targetDescription: 'target player',
        };
      }
      const n = parseCountWord(m[1]) ?? 1;
      return {
        op: 'SURVEIL_TARGET_PLAYER',
        filter: 'ANY',
        minTargets: 1,
        maxTargets: 1,
        surveilCount: n,
        targetDescription: 'target player',
      };
    }
  }

  // MILL
  {
    // Mill N cards.
    const m = t.trim().match(/^mill\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\.?$/i);
    if (m) {
      const n = parseCountWord(m[1]) ?? 1;
      return {
        op: 'MILL_SELF',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        millCount: n,
      };
    }
  }
  {
    // Target player mills N cards.
    const m = t.trim().match(/^target\s+player\s+mills\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i);
    if (m) {
      const n = parseCountWord(m[1]) ?? 1;
      return {
        op: 'MILL_TARGET_PLAYER',
        filter: 'ANY',
        minTargets: 1,
        maxTargets: 1,
        millCount: n,
        targetDescription: 'target player',
      };
    }
  }
  {
    // Increasing Confusion (post-Bloomburrow templating): mills X; flashback mills twice X.
    const m = t.match(/^target\s+player\s+mills\s+x\s+cards?\b/i);
    if (m) {
      const doubleFromGraveyard = /if this spell was cast from a graveyard,\s*that player mills twice that many cards instead/i.test(t);
      return {
        op: 'MILL_TARGET_PLAYER',
        filter: 'ANY',
        minTargets: 1,
        maxTargets: 1,
        millCountIsX: true,
        ...(doubleFromGraveyard ? { millCountDoubleIfCastFromGraveyard: true } : {}),
        targetDescription: 'target player',
      };
    }
  }
  {
    // Legacy wording: "Target player puts the top X cards of their library into their graveyard."
    const m = t.match(/^target\s+player\s+puts\s+the\s+top\s+x\s+cards?\s+of\s+their\s+library\s+into\s+their\s+graveyard\b/i);
    if (m) {
      const doubleFromGraveyard = /if this spell was cast from a graveyard,\s*that player mills twice that many cards instead/i.test(t);
      return {
        op: 'MILL_TARGET_PLAYER',
        filter: 'ANY',
        minTargets: 1,
        maxTargets: 1,
        millCountIsX: true,
        ...(doubleFromGraveyard ? { millCountDoubleIfCastFromGraveyard: true } : {}),
        targetDescription: 'target player',
      };
    }
  }
  {
    // Each opponent mills N cards.
    const m = t.trim().match(/^each\s+opponent\s+mills\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'MILL_EACH_OPPONENT',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          millCountIsX: true,
        };
      }
      const n = parseCountWord(raw) ?? 1;
      return {
        op: 'MILL_EACH_OPPONENT',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        millCount: n,
      };
    }
  }
  {
    // Each player mills N cards.
    const m = t.trim().match(/^each\s+player\s+mills\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?\.?$/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      if (raw === 'x') {
        return {
          op: 'MILL_EACH_PLAYER',
          filter: 'ANY',
          minTargets: 0,
          maxTargets: 0,
          millCountIsX: true,
        };
      }
      const n = parseCountWord(raw) ?? 1;
      return {
        op: 'MILL_EACH_PLAYER',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        millCount: n,
      };
    }
  }
  {
    const m = t.trim().match(/^you\s+mills?\s+x\s+cards?\b/i);
    if (m) {
      return {
        op: 'MILL_SELF',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        millCountIsX: true,
      };
    }
  }
  {
    const m = t.trim().match(/^mill\s+x\s+cards?\.?$/i);
    if (m) {
      return {
        op: 'MILL_SELF',
        filter: 'ANY',
        minTargets: 0,
        maxTargets: 0,
        millCountIsX: true,
      };
    }
  }
  {
    const m = t.match(/^target\s+opponent\s+mills\s+x\s+cards?\b/i);
    if (m) {
      return {
        op: 'MILL_TARGET_PLAYER',
        filter: 'ANY',
        minTargets: 1,
        maxTargets: 1,
        millCountIsX: true,
        targetDescription: 'target opponent',
        opponentOnly: true,
      };
    }
  }

  // GOAD
  {
    // Goad target creature.
    const m = t.trim().match(/^goad\s+target\s+creature\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      return {
        op: 'GOAD_TARGET',
        filter: 'CREATURE',
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
      };
    }
  }
  {
    // Goad target creature an opponent controls.
    const m = t.trim().match(/^goad\s+target\s+creature\s+an\s+opponent\s+controls\.(?:\s*\([^)]*\))?$/i);
    if (m) {
      return {
        op: 'GOAD_TARGET',
        filter: 'CREATURE',
        minTargets: 1,
        maxTargets: 1,
        opponentOnly: true,
        targetDescription: 'target creature an opponent controls',
      };
    }
  }

  const { filter, multiFilter, creatureRestriction } = detectCategorizePermanentFilter(t);


  // IMPORTANT: Skip "destroy all" patterns that have conditional "if X is N or more" clauses
  // Cards like Martial Coup: "Create X tokens. If X is 5 or more, destroy all other creatures."
  // These conditional effects must be handled separately by the X-value-aware code in stack.ts
  const hasConditionalXWipe = /if x is \d+ or more[,.]?\s*destroy all/i.test(t);

  // Scoped wipes (single sentence): "destroy/exile all {type} you control / your opponents control"
  // and "destroy/exile all {type} target player controls".
  {
    const m = t
      .trim()
      .match(
        /^destroy\s+all\s+(creatures|lands|artifacts|enchantments|planeswalkers|battles|permanents|nonland\s+permanents)(?:\s+(you\s+control|your\s+opponents\s+control|opponents\s+control|you\s+(?:don't|do\s+not)\s+control))?\.?$/i
      );
    if (m && !hasConditionalXWipe) {
      const typePhrase = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly =
        scope === 'your opponents control' ||
        scope === 'opponents control' ||
        scope.startsWith("you don't control") ||
        scope.startsWith('you do not control');

      const nonlandOnly = typePhrase === 'nonland permanents';
      const wipeFilter: PermanentFilter =
        nonlandOnly ? 'PERMANENT' :
        typePhrase.includes('creature') ? 'CREATURE' :
        typePhrase.includes('planeswalker') ? 'PLANESWALKER' :
        typePhrase.includes('battle') ? 'BATTLE' :
        typePhrase.includes('land') ? 'LAND' :
        typePhrase.includes('artifact') ? 'ARTIFACT' :
        typePhrase.includes('enchantment') ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'DESTROY_ALL',
        filter: wipeFilter,
        minTargets: 0,
        maxTargets: 0,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
      };
    }
  }
  {
    const m = t
      .trim()
      .match(
        /^exile\s+all\s+(creatures|lands|artifacts|enchantments|planeswalkers|battles|permanents|nonland\s+permanents)(?:\s+(you\s+control|your\s+opponents\s+control|opponents\s+control|you\s+(?:don't|do\s+not)\s+control))?\.?$/i
      );
    if (m && !/exile all\s+(?:other\s+)?spells\b/i.test(t)) {
      const typePhrase = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly =
        scope === 'your opponents control' ||
        scope === 'opponents control' ||
        scope.startsWith("you don't control") ||
        scope.startsWith('you do not control');

      const nonlandOnly = typePhrase === 'nonland permanents';
      const wipeFilter: PermanentFilter =
        nonlandOnly ? 'PERMANENT' :
        typePhrase.includes('creature') ? 'CREATURE' :
        typePhrase.includes('planeswalker') ? 'PLANESWALKER' :
        typePhrase.includes('battle') ? 'BATTLE' :
        typePhrase.includes('land') ? 'LAND' :
        typePhrase.includes('artifact') ? 'ARTIFACT' :
        typePhrase.includes('enchantment') ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'EXILE_ALL',
        filter: wipeFilter,
        minTargets: 0,
        maxTargets: 0,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
      };
    }
  }
  {
    const m = t.trim().match(/^destroy\s+all\s+(creatures|lands|artifacts|enchantments|permanents|nonland\s+permanents)\s+target\s+player\s+controls\.?$/i);
    if (m && !hasConditionalXWipe) {
      const typePhrase = m[1].toLowerCase();
      const nonlandOnly = typePhrase === 'nonland permanents';
      const wipeFilter: PermanentFilter =
        nonlandOnly ? 'PERMANENT' :
        typePhrase.includes('creature') ? 'CREATURE' :
        typePhrase.includes('land') ? 'LAND' :
        typePhrase.includes('artifact') ? 'ARTIFACT' :
        typePhrase.includes('enchantment') ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'DESTROY_ALL_TARGET_PLAYER',
        filter: wipeFilter,
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        targetDescription: 'target player',
      };
    }
  }
  {
    const m = t.trim().match(/^exile\s+all\s+(creatures|lands|artifacts|enchantments|permanents|nonland\s+permanents)\s+target\s+player\s+controls\.?$/i);
    if (m && !/exile all\s+(?:other\s+)?spells\b/i.test(t)) {
      const typePhrase = m[1].toLowerCase();
      const nonlandOnly = typePhrase === 'nonland permanents';
      const wipeFilter: PermanentFilter =
        nonlandOnly ? 'PERMANENT' :
        typePhrase.includes('creature') ? 'CREATURE' :
        typePhrase.includes('land') ? 'LAND' :
        typePhrase.includes('artifact') ? 'ARTIFACT' :
        typePhrase.includes('enchantment') ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'EXILE_ALL_TARGET_PLAYER',
        filter: wipeFilter,
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        targetDescription: 'target player',
      };
    }
  }
  
  // Multi-type destroy-all lists (single sentence), e.g. "Destroy all artifacts and enchantments." / "Destroy all artifacts, creatures, and lands."
  {
    const m = t.trim().match(/^destroy\s+all\s+(.+?)\.?$/i);
    if (m && !hasConditionalXWipe) {
      const typePhrase = m[1].toLowerCase();
      const nonlandOnly = typePhrase.trim() === 'nonland permanents';
      if (!nonlandOnly && !/\bpermanents?\b/i.test(typePhrase)) {
        const types: PermanentFilter[] = [];
        if (/\bartifacts?\b/i.test(typePhrase)) types.push('ARTIFACT');
        if (/\benchantments?\b/i.test(typePhrase)) types.push('ENCHANTMENT');
        if (/\bcreatures?\b/i.test(typePhrase)) types.push('CREATURE');
        if (/\bplaneswalkers?\b/i.test(typePhrase)) types.push('PLANESWALKER');
        if (/\bbattles?\b/i.test(typePhrase)) types.push('BATTLE');
        if (/\blands?\b/i.test(typePhrase)) types.push('LAND');
        if (types.length >= 2) {
          return { op: 'DESTROY_ALL', filter: types[0], multiFilter: types, minTargets: 0, maxTargets: 0 };
        }
      }
    }
  }

  if (/destroy all\b/.test(t) && !hasConditionalXWipe) return { op: 'DESTROY_ALL', filter, minTargets: 0, maxTargets: 0, ...(multiFilter && { multiFilter }) };
  // Only match "exile all" if it's targeting permanents (creatures, planeswalkers, etc.), not spells
  // Multi-type exile-all lists (single sentence)
  {
    const m = t.trim().match(/^exile\s+all\s+(.+?)\.?$/i);
    if (m && !/exile all\s+(?:other\s+)?spells\b/i.test(t)) {
      const typePhrase = m[1].toLowerCase();
      const nonlandOnly = typePhrase.trim() === 'nonland permanents';
      if (!nonlandOnly && !/\bpermanents?\b/i.test(typePhrase)) {
        const types: PermanentFilter[] = [];
        if (/\bartifacts?\b/i.test(typePhrase)) types.push('ARTIFACT');
        if (/\benchantments?\b/i.test(typePhrase)) types.push('ENCHANTMENT');
        if (/\bcreatures?\b/i.test(typePhrase)) types.push('CREATURE');
        if (/\bplaneswalkers?\b/i.test(typePhrase)) types.push('PLANESWALKER');
        if (/\bbattles?\b/i.test(typePhrase)) types.push('BATTLE');
        if (/\blands?\b/i.test(typePhrase)) types.push('LAND');
        if (types.length >= 2) {
          return { op: 'EXILE_ALL', filter: types[0], multiFilter: types, minTargets: 0, maxTargets: 0 };
        }
      }
    }
  }

  if (/exile all\b/.test(t) && !/exile all\s+(?:other\s+)?spells\b/.test(t)) return { op: 'EXILE_ALL', filter, minTargets: 0, maxTargets: 0, ...(multiFilter && { multiFilter }) };
  if (/destroy each\b/.test(t)) return { op: 'DESTROY_EACH', filter, minTargets: 0, maxTargets: 0, ...(multiFilter && { multiFilter }) };
  return null;
}
