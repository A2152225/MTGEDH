// server/src/rules-engine/targeting-handlers/targetingCategorizeTapBounceGenericTargets.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: categorizeSpellWithoutPrimaryRetirement TAP/UNTAP, BOUNCE,
//   scoped destroy/exile, and remaining generic target-permanent/damage
//   patterns.
// Public entry symbols: tryCategorizeTapBounceGenericTargets.

import type { PermanentFilter, SpellSpec } from './targetingSpellSpecTypes.js';
import { parseCountWord } from './targetingCategorizeCountUtils.js';
import { detectCategorizePermanentFilter } from './targetingCategorizePermanentFilter.js';

export function tryCategorizeTapBounceGenericTargets(t: string): SpellSpec | null {
  const { filter, multiFilter, creatureRestriction } = detectCategorizePermanentFilter(t);
  // ========================================================================
  // TAP / UNTAP (conservative templates)
  // Match only single-sentence forms to avoid partially applying multi-sentence
  // effects like "Tap target creature. It doesn't untap...".
  // ========================================================================
  {
    const m = t.trim().match(/^tap\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)(?:\s+(you\s+control|an\s+opponent\s+controls))?\.?$/i);
    if (m) {
      const targetType = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'TAP_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope ? `target ${targetType} ${scope}` : `target ${targetType}`,
      };
    }
  }
  {
    const m = t.trim().match(/^tap\s+up\s+to\s+(one|two|three|four|five|\d+)\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)s?(?:\s+(you\s+control|an\s+opponent\s+controls))?\.?$/i);
    if (m) {
      const max = parseCountWord(m[1]) ?? 1;
      const targetType = m[2].toLowerCase();
      const scope = (m[3] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'TAP_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 0,
        maxTargets: max,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope
          ? `up to ${m[1]} target ${targetType}${max === 1 ? '' : 's'} ${scope}`
          : `up to ${m[1]} target ${targetType}${max === 1 ? '' : 's'}`,
      };
    }
  }
  {
    const m = t.trim().match(/^untap\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)(?:\s+(you\s+control|an\s+opponent\s+controls))?\.?(?:\s+after\s+this\s+(?:main\s+)?phase,\s+there\s+is\s+an\s+additional\s+combat\s+phase\s+followed\s+by\s+an\s+additional\s+main\s+phase\.?)$/i);
    if (m) {
      const targetType = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'UNTAP_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        addExtraCombat: true,
        targetDescription: scope ? `target ${targetType} ${scope}` : `target ${targetType}`,
      };
    }
  }
  {
    const m = t.trim().match(/^untap\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)(?:\s+(you\s+control|an\s+opponent\s+controls))?\.?$/i);
    if (m) {
      const targetType = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'UNTAP_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope ? `target ${targetType} ${scope}` : `target ${targetType}`,
      };
    }
  }
  {
    const m = t.trim().match(/^untap\s+up\s+to\s+(one|two|three|four|five|\d+)\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)s?(?:\s+(you\s+control|an\s+opponent\s+controls))?\.?$/i);
    if (m) {
      const max = parseCountWord(m[1]) ?? 1;
      const targetType = m[2].toLowerCase();
      const scope = (m[3] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'UNTAP_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 0,
        maxTargets: max,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope
          ? `up to ${m[1]} target ${targetType}${max === 1 ? '' : 's'} ${scope}`
          : `up to ${m[1]} target ${targetType}${max === 1 ? '' : 's'}`,
      };
    }
  }

  // Mass tap/untap (no targets): "tap all creatures", "untap all lands you control", etc.
  {
    const m = t.trim().match(/^tap\s+all\s+(creatures|lands|artifacts|enchantments|permanents|nonland\s+permanents)(?:\s+(you\s+control|your\s+opponents\s+control))?\.?$/i);
    if (m) {
      const typePhrase = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'your opponents control';

      const nonlandOnly = typePhrase === 'nonland permanents';
      const filter: PermanentFilter =
        typePhrase === 'creatures' ? 'CREATURE' :
        typePhrase === 'lands' ? 'LAND' :
        typePhrase === 'artifacts' ? 'ARTIFACT' :
        typePhrase === 'enchantments' ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'TAP_ALL',
        filter,
        minTargets: 0,
        maxTargets: 0,
        nonlandOnly,
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
      };
    }
  }
  {
    const m = t.trim().match(/^untap\s+all\s+(creatures|lands|artifacts|enchantments|permanents|nonland\s+permanents)(?:\s+(you\s+control|your\s+opponents\s+control))?\.?$/i);
    if (m) {
      const typePhrase = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'your opponents control';

      const nonlandOnly = typePhrase === 'nonland permanents';
      const filter: PermanentFilter =
        typePhrase === 'creatures' ? 'CREATURE' :
        typePhrase === 'lands' ? 'LAND' :
        typePhrase === 'artifacts' ? 'ARTIFACT' :
        typePhrase === 'enchantments' ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'UNTAP_ALL',
        filter,
        minTargets: 0,
        maxTargets: 0,
        nonlandOnly,
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
      };
    }
  }

  // Mass tap/untap controlled by a targeted player: "tap all creatures target player controls."
  {
    const m = t.trim().match(/^tap\s+all\s+(creatures|lands|artifacts|enchantments|permanents|nonland\s+permanents)\s+target\s+player\s+controls\.?$/i);
    if (m) {
      const typePhrase = m[1].toLowerCase();
      const nonlandOnly = typePhrase === 'nonland permanents';
      const filter: PermanentFilter =
        typePhrase === 'creatures' ? 'CREATURE' :
        typePhrase === 'lands' ? 'LAND' :
        typePhrase === 'artifacts' ? 'ARTIFACT' :
        typePhrase === 'enchantments' ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'TAP_ALL_TARGET_PLAYER',
        filter,
        minTargets: 1,
        maxTargets: 1,
        nonlandOnly,
        targetDescription: 'target player',
      };
    }
  }
  {
    const m = t.trim().match(/^untap\s+all\s+(creatures|lands|artifacts|enchantments|permanents|nonland\s+permanents)\s+target\s+player\s+controls\.?$/i);
    if (m) {
      const typePhrase = m[1].toLowerCase();
      const nonlandOnly = typePhrase === 'nonland permanents';
      const filter: PermanentFilter =
        typePhrase === 'creatures' ? 'CREATURE' :
        typePhrase === 'lands' ? 'LAND' :
        typePhrase === 'artifacts' ? 'ARTIFACT' :
        typePhrase === 'enchantments' ? 'ENCHANTMENT' :
        'PERMANENT';

      return {
        op: 'UNTAP_ALL_TARGET_PLAYER',
        filter,
        minTargets: 1,
        maxTargets: 1,
        nonlandOnly,
        targetDescription: 'target player',
      };
    }
  }

  // ========================================================================
  // BOUNCE (return to hand) (conservative templates)
  // ========================================================================
  {
    // Unsummon-style: "Return target creature to its owner's hand."
    const m = t.trim().match(/^return\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)(?:\s+(you\s+control|an\s+opponent\s+controls))?\s+to\s+its\s+owner['’]s\s+hand\.?$/i);
    if (m) {
      const targetType = m[1].toLowerCase();
      const scope = (m[2] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'BOUNCE_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope ? `target ${targetType} ${scope}` : `target ${targetType}`,
      };
    }
  }
  {
    // "Return up to one target creature to its owner's hand."
    const m = t.trim().match(/^return\s+up\s+to\s+(a|an|one|1)\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)(?:\s+(you\s+control|an\s+opponent\s+controls))?\s+to\s+its\s+owner['’]s\s+hand\.?$/i);
    if (m) {
      const targetType = m[2].toLowerCase();
      const scope = (m[3] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'BOUNCE_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 0,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope ? `up to one target ${targetType} ${scope}` : `up to one target ${targetType}`,
      };
    }
  }

  {
    // "Return up to two target creatures to their owners' hands." (and similar)
    const m = t.trim().match(/^return\s+up\s+to\s+(one|two|three|four|five|\d+)\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)s?(?:\s+(you\s+control|an\s+opponent\s+controls))?\s+to\s+their\s+owners['’]?\s+hands?\.?$/i);
    if (m) {
      const max = parseCountWord(m[1]) ?? 1;
      const targetType = m[2].toLowerCase();
      const scope = (m[3] || '').toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      return {
        op: 'BOUNCE_TARGET',
        filter:
          targetType === 'creature' ? 'CREATURE' :
          targetType === 'artifact' ? 'ARTIFACT' :
          targetType === 'enchantment' ? 'ENCHANTMENT' :
          targetType === 'land' ? 'LAND' :
          targetType === 'planeswalker' ? 'PLANESWALKER' :
          'PERMANENT',
        minTargets: 0,
        maxTargets: max,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: scope
          ? `up to ${m[1]} target ${targetType}${max === 1 ? '' : 's'} ${scope}`
          : `up to ${m[1]} target ${targetType}${max === 1 ? '' : 's'}`,
      };
    }
  }

  // Scoped single-target removal: "Destroy/Exile target X you control" / "...an opponent controls".
  {
    const m = t.trim().match(/^(destroy|exile)\s+target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent)\s+(you\s+control|an\s+opponent\s+controls)\.?$/i);
    if (m) {
      const verb = m[1].toLowerCase();
      const targetType = m[2].toLowerCase();
      const scope = m[3].toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';
      const nonlandOnly = targetType === 'nonland permanent';
      const filter: PermanentFilter =
        targetType === 'creature' ? 'CREATURE' :
        targetType === 'artifact' ? 'ARTIFACT' :
        targetType === 'enchantment' ? 'ENCHANTMENT' :
        targetType === 'land' ? 'LAND' :
        targetType === 'planeswalker' ? 'PLANESWALKER' :
        'PERMANENT';
      return {
        op: verb === 'destroy' ? 'DESTROY_TARGET' : 'EXILE_TARGET',
        filter,
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: `target ${targetType} ${scope}`,
      };
    }
  }

  {
    const m = t.trim().match(/^(destroy|exile)\s+up\s+to\s+(x|one|two|three|four|five|\d+)\s+target\s+artifacts?\s+and\/or\s+enchantments?\./i);
    if (m) {
      const rawCount = String(m[2] || '').toLowerCase();
      const countIsX = rawCount === 'x';
      const max = countIsX ? 0 : (parseCountWord(rawCount) ?? 1);
      return {
        op: String(m[1]).toLowerCase() === 'destroy' ? 'DESTROY_TARGET' : 'EXILE_TARGET',
        filter: 'ARTIFACT',
        minTargets: 0,
        maxTargets: max,
        ...(countIsX ? { maxTargetsIsX: true } : {}),
        multiFilter: ['ARTIFACT', 'ENCHANTMENT'],
        targetDescription: `up to ${rawCount} target artifacts and/or enchantments`,
      };
    }
  }

  // Damage to a scoped battlefield target: "...to target creature/planeswalker you control / an opponent controls".
  {
    const m = t.match(/\bdeals?\s+(\d+|x)\s+damage\s+to\s+target\s+(creature|planeswalker|creature\s+or\s+planeswalker)\s+(you\s+control|an\s+opponent\s+controls)\b/i);
    if (m) {
      const raw = String(m[1]).toLowerCase();
      const kind = String(m[2]).toLowerCase();
      const scope = String(m[3]).toLowerCase();
      const controllerOnly = scope === 'you control';
      const opponentOnly = scope === 'an opponent controls';

      const isCreatureOrPw = kind.includes('or');
      const isPlaneswalkerOnly = kind === 'planeswalker' && !isCreatureOrPw;

      return {
        op: 'DAMAGE_TARGET',
        filter: isPlaneswalkerOnly ? 'PLANESWALKER' : 'CREATURE',
        minTargets: 1,
        maxTargets: 1,
        ...(raw === 'x' ? { amountIsX: true } : { amount: parseInt(raw, 10) }),
        ...(isCreatureOrPw ? { multiFilter: ['CREATURE', 'PLANESWALKER'] } : {}),
        ...(controllerOnly ? { controllerOnly: true } : {}),
        ...(opponentOnly ? { opponentOnly: true } : {}),
        targetDescription: `target ${kind} ${scope}`,
      };
    }
  }

  // Nonland permanent targeting for destroy/exile (single target)
  {
    const m = t.trim().match(/^destroy\s+target\s+nonland\s+permanent\.?$/i);
    if (m) return { op: 'DESTROY_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1, nonlandOnly: true, targetDescription: 'target nonland permanent' };
  }
  {
    const m = t.trim().match(/^exile\s+target\s+nonland\s+permanent\.?$/i);
    if (m) return { op: 'EXILE_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1, nonlandOnly: true, targetDescription: 'target nonland permanent' };
  }
  {
    const m = t.trim().match(/^destroy\s+target\s+permanent\b/i);
    if (m) return { op: 'DESTROY_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1, targetDescription: 'target permanent' };
  }
  {
    const m = t.trim().match(/^exile\s+target\s+permanent\b/i);
    if (m) return { op: 'EXILE_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1, targetDescription: 'target permanent' };
  }

  if (/exile target/.test(t)) return { op: 'EXILE_TARGET', filter, minTargets: 1, maxTargets: 1, ...(multiFilter && { multiFilter }), ...(creatureRestriction && { creatureRestriction }) };
  if (/destroy target/.test(t)) return { op: 'DESTROY_TARGET', filter, minTargets: 1, maxTargets: 1, ...(multiFilter && { multiFilter }), ...(creatureRestriction && { creatureRestriction }) };
  
  // Chaos Warp and similar shuffle effects: "target permanent" or "of target permanent"
  if (/(?:of )?target permanent/.test(t) && /shuffles? it into/.test(t)) {
    return { op: 'DESTROY_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1 };
  }
  
  // Generic scoped permanent target patterns for spells that only need targeting metadata.
  {
    const m = t.match(/^target\s+(creature|permanent|artifact|enchantment|land|planeswalker|nonland\s+permanent|noncreature\s+permanent)\s+(you\s+control|an\s+opponent\s+controls)\b/i);
    if (m && !(/enchant/.test(t)) && !(/\bdamage\b/.test(t))) {
      const targetType = String(m[1] || '').toLowerCase();
      const scope = String(m[2] || '').toLowerCase();
      const nonlandOnly = targetType === 'nonland permanent';
      const filter: PermanentFilter =
        targetType === 'creature' ? 'CREATURE' :
        targetType === 'artifact' ? 'ARTIFACT' :
        targetType === 'enchantment' ? 'ENCHANTMENT' :
        targetType === 'land' ? 'LAND' :
        targetType === 'planeswalker' ? 'PLANESWALKER' :
        'PERMANENT';
      const targetDescription = `target ${targetType} ${scope}`;
      if (targetType === 'creature') {
        return {
          op: 'TARGET_CREATURE',
          filter,
          minTargets: 1,
          maxTargets: 1,
          ...(scope === 'you control' ? { controllerOnly: true } : {}),
          ...(scope === 'an opponent controls' ? { opponentOnly: true } : {}),
          targetDescription,
        };
      }

      return {
        op: 'TARGET_PERMANENT',
        filter,
        minTargets: 1,
        maxTargets: 1,
        ...(nonlandOnly ? { nonlandOnly: true } : {}),
        ...(scope === 'you control' ? { controllerOnly: true } : {}),
        ...(scope === 'an opponent controls' ? { opponentOnly: true } : {}),
        targetDescription,
      };
    }
  }

  // Generic "target permanent" patterns for spells that affect permanents
  // These should only provide targeting metadata. The actual spell text still needs
  // a concrete resolution path elsewhere in the engine.
  if (/target permanent\b/.test(t) && !(/enchant/.test(t)) && !(/\bdamage\b/.test(t))) {
    return { op: 'TARGET_PERMANENT', filter: 'PERMANENT', minTargets: 1, maxTargets: 1, targetDescription: 'target permanent' };
  }
  
  // Target creature/artifact/enchantment patterns without destroy/exile
  if (/target creature\b/.test(t) && !(/enchant/.test(t)) && !(/\bdamage\b/.test(t))) {
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetDescription: 'target creature' };
  }

  if (/any target/.test(t) && /\bdamage\b/.test(t)) {
    const m = t.match(/(\d+)\s+damage/);
    return { op: 'ANY_TARGET_DAMAGE', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: m ? parseInt(m[1], 10) : undefined };
  }

  // Damage to a specific target type.
  // Examples: "Shock deals 2 damage to any target" (handled above),
  //           "Flame Slash deals 4 damage to target creature.",
  //           "Strangle deals 3 damage to target creature or planeswalker."
  if (/\bdeals?\s+(\d+|x)\s+damage\s+to\s+target\s+creature\b/.test(t) || /\bdeals?\s+(\d+|x)\s+damage\s+to\s+target\s+planeswalker\b/.test(t) || /\bdeals?\s+(\d+|x)\s+damage\s+to\s+target\s+creature\s+or\s+planeswalker\b/.test(t)) {
    const amountMatch = t.match(/deals?\s+(\d+|x)\s+damage\s+to\s+target/i);
    const raw = amountMatch?.[1];
    const isX = raw?.toLowerCase() === 'x';
    const amount = !isX && raw ? parseInt(raw, 10) : undefined;
    const isCreatureOrPw = /target\s+creature\s+or\s+planeswalker/.test(t);
    const isPlaneswalkerOnly = /target\s+planeswalker\b/.test(t) && !isCreatureOrPw;
    return {
      op: 'DAMAGE_TARGET',
      filter: isPlaneswalkerOnly ? 'PLANESWALKER' : 'CREATURE',
      minTargets: 1,
      maxTargets: 1,
      ...(isX ? { amountIsX: true } : { amount: Number.isFinite(amount) ? amount : undefined }),
      ...(isCreatureOrPw ? { multiFilter: ['CREATURE', 'PLANESWALKER'] } : {}),
      targetDescription: isCreatureOrPw ? 'target creature or planeswalker' : isPlaneswalkerOnly ? 'target planeswalker' : 'target creature',
    };
  }
  return null;
}
