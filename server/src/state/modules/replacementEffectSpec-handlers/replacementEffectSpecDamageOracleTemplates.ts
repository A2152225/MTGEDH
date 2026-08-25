// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleDamageReplacementTemplate + ORACLE_DAMAGE_REPLACEMENT_TEMPLATES
//   + collectOraclePatternDamageReplacementSpecsFromState + prevent-all-but
//   parsers + emblem damage sources + overlaySpecsMatchDamage.
// Public entry symbols: collectOraclePatternDamageReplacementSpecsFromState,
//   overlaySpecsMatchDamage.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import { permanentHasCreatureTypeNow } from '../../creatureTypeNow.js';
import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleDamageReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern damage amount replacements (Furnace of Rath family; no card-name routing). */
const ORACLE_DAMAGE_REPLACEMENT_TEMPLATES: readonly OracleDamageReplacementTemplate[] = [
  {
    // Furnace of Rath / Dictate of the Twin Gods
    templateId: 'all-source-damage-double',
    oracleMustIncludeAll: [
      'if a source would deal damage to a permanent or player',
      'it deals double that damage',
    ],
    spec: {
      event: 'damage',
      instead: { modify: 'double' },
      effectId: 'all-source-damage-double',
      reason: 'all_source_damage_double',
    },
  },
  {
    // Angrath's Marauders family
    templateId: 'source-you-control-damage-double',
    oracleMustIncludeAll: [
      'if a source you control would deal damage',
      'deals double that damage',
    ],
    spec: {
      event: 'damage',
      match: { dealingPlayerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'source-you-control-damage-double',
      reason: 'source_you_control_damage_double',
    },
  },
  {
    // Gisela, Blade of Goldnight (double half)
    templateId: 'damage-to-opponent-double',
    oracleMustIncludeAll: [
      'deal damage to an opponent or a permanent an opponent controls',
      'deals double that damage',
    ],
    spec: {
      event: 'damage',
      match: { receivingPlayerIsOpponentOfSource: true },
      instead: { modify: 'double' },
      effectId: 'damage-to-opponent-double',
      reason: 'damage_to_opponent_double',
    },
  },
  {
    // Gisela, Blade of Goldnight (prevent half)
    templateId: 'damage-to-you-prevent-half',
    oracleMustIncludeAll: [
      'deal damage to you or a permanent you control',
      'prevent half that damage',
    ],
    spec: {
      event: 'damage',
      match: { receivingPlayerIsSourceController: true },
      instead: { modify: 'halve' },
      effectId: 'damage-to-you-prevent-half',
      reason: 'damage_to_you_prevent_half',
    },
  },
  {
    // Fiery Emancipation / City on Fire
    templateId: 'source-you-control-damage-triple',
    oracleMustIncludeAll: [
      'if a source you control would deal damage',
      'deals triple that damage',
    ],
    spec: {
      event: 'damage',
      match: { dealingPlayerIsSourceController: true },
      instead: { modify: 'triple' },
      effectId: 'source-you-control-damage-triple',
      reason: 'source_you_control_damage_triple',
    },
  },
  {
    // Torbran, Thane of Red Fell
    templateId: 'red-source-you-control-damage-plus-2',
    oracleMustIncludeAll: [
      'red source you control would deal damage to an opponent',
      'that much damage plus 2',
    ],
    spec: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        receivingPlayerIsOpponentOfSource: true,
      },
      instead: { modify: 'add_flat', value: 2 },
      effectId: 'red-source-you-control-damage-plus-2',
      reason: 'red_source_you_control_damage_plus_2',
    },
  },
  {
    // Embermaw Hellion
    templateId: 'another-red-source-you-control-damage-plus-1',
    oracleMustIncludeAll: [
      'another red source you control would deal damage',
      'that much damage plus 1',
    ],
    spec: {
      event: 'damage',
      match: { dealingPlayerIsSourceController: true },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'another-red-source-you-control-damage-plus-1',
      reason: 'another_red_source_you_control_damage_plus_1',
    },
  },
  {
    // The Sound of Drums / attachment-scoped combat double
    templateId: 'enchanted-creature-combat-damage-double',
    oracleMustIncludeAll: [
      'if enchanted creature would deal combat damage to a permanent or player',
      'deals double that damage',
    ],
    spec: {
      event: 'damage',
      match: {
        damageSourceIsEnchantedBySource: true,
        combatDamageOnly: true,
      },
      instead: { modify: 'double' },
      effectId: 'enchanted-creature-combat-damage-double',
      reason: 'enchanted_creature_combat_damage_double',
    },
  },
];

export function collectOraclePatternDamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || !(perm as { card?: unknown }).card) continue;
    const permRecord = perm as {
      id?: string;
      controller?: string;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    const oracle = normalizeOraclePatternText(readCardOracleText(permRecord.card)).toLowerCase();
    if (!oracle) continue;

    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    for (const template of ORACLE_DAMAGE_REPLACEMENT_TEMPLATES) {
      if (!template.oracleMustIncludeAll.every((phrase) => oracle.includes(phrase))) continue;
      specs.push({
        ...template.spec,
        id: `${sourcePermanentId}:${template.templateId}`,
        sourcePermanentId,
        sourceController,
        sourceName,
      });
    }

    const preventAllBut = parsePreventAllButAnotherTypeDamageSpec(oracle);
    if (preventAllBut) {
      specs.push({
        ...preventAllBut,
        id: `${sourcePermanentId}:${preventAllBut.effectId}`,
        sourcePermanentId,
        sourceController,
        sourceName,
      });
    }

    const preventYouOrType = parsePreventAllButYouOrTypeDamageSpec(oracle);
    if (preventYouOrType) {
      specs.push({
        ...preventYouOrType,
        id: `${sourcePermanentId}:${preventYouOrType.effectId}`,
        sourcePermanentId,
        sourceController,
        sourceName,
      });
    }
  }

  for (const emblem of collectEmblemDamageReplacementSources(state)) {
    const preventYouOrType = parsePreventAllButYouOrTypeDamageSpec(emblem.oracle, { allowEmbeddedEmblem: true });
    if (preventYouOrType) {
      specs.push({
        ...preventYouOrType,
        id: `${emblem.id}:${preventYouOrType.effectId}`,
        sourcePermanentId: emblem.id,
        sourceController: emblem.controller,
        sourceName: emblem.name,
      });
    }
    const preventAllBut = parsePreventAllButAnotherTypeDamageSpec(emblem.oracle);
    if (preventAllBut) {
      specs.push({
        ...preventAllBut,
        id: `${emblem.id}:${preventAllBut.effectId}`,
        sourcePermanentId: emblem.id,
        sourceController: emblem.controller,
        sourceName: emblem.name,
      });
    }
  }

  return specs;
}

const PREVENT_ALL_BUT_ANOTHER_TYPE_RE =
  /if a source would deal damage to another ([a-z][a-z0-9\s/-]*?) you control,?\s*prevent all but (\d+) of that damage/;

const PREVENT_ALL_BUT_YOU_OR_TYPE_RE =
  /if a source would deal damage to you or an? ([a-z][a-z0-9\s/-]*?) you control,?\s*prevent all but (\d+) of that damage/;

const DAMAGE_RECIPIENT_CARD_TYPE_TOKENS = new Set([
  'creature',
  'artifact',
  'enchantment',
  'planeswalker',
  'land',
  'battle',
  'kindred',
  'legendary',
  'snow',
  'token',
]);

function parsePreventAllButAnotherTypeDamageSpec(
  oracle: string,
): Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'> | null {
  const match = oracle.match(PREVENT_ALL_BUT_ANOTHER_TYPE_RE);
  if (!match) return null;
  const typeTokens = parseTypeTokensFromPreventAllBut(match[1]);
  const capValue = Math.max(0, Math.floor(Number(match[2]) || 0));
  if (typeTokens.length === 0) return null;
  return {
    event: 'damage',
    match: {
      receivingPermanentControllerIsSourceController: true,
      receivingPermanentIsNotSource: true,
      receivingPermanentTypeIncludesAll: typeTokens,
    },
    instead: { modify: 'cap', value: capValue },
    effectId: 'prevent-all-but-damage-to-another-type-you-control',
    reason: 'prevent_all_but_damage_to_another_type_you_control',
  };
}

function parseTypeTokensFromPreventAllBut(raw: string): string[] {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token !== 'a' && token !== 'an' && token !== 'the');
}

function parsePreventAllButYouOrTypeDamageSpec(
  oracle: string,
  options?: { allowEmbeddedEmblem?: boolean },
): Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'> | null {
  if (!options?.allowEmbeddedEmblem && /you get an emblem with/.test(oracle)) return null;
  const match = oracle.match(PREVENT_ALL_BUT_YOU_OR_TYPE_RE);
  if (!match) return null;
  const typeTokens = parseTypeTokensFromPreventAllBut(match[1]);
  const capValue = Math.max(0, Math.floor(Number(match[2]) || 0));
  if (typeTokens.length === 0) return null;
  return {
    event: 'damage',
    match: {
      receivingIsYouOrMatchingPermanentYouControl: true,
      receivingPermanentTypeIncludesAll: typeTokens,
    },
    instead: { modify: 'cap', value: capValue },
    effectId: 'prevent-all-but-damage-to-you-or-type-you-control',
    reason: 'prevent_all_but_damage_to_you_or_type_you_control',
  };
}

function collectEmblemDamageReplacementSources(state: unknown): Array<{
  id: string;
  controller: string;
  name: string;
  oracle: string;
}> {
  const seen = new Set<string>();
  const sources: Array<{ id: string; controller: string; name: string; oracle: string }> = [];
  const push = (emblem: unknown) => {
    if (!emblem || typeof emblem !== 'object') return;
    const record = emblem as {
      id?: string;
      controller?: string;
      owner?: string;
      sourceName?: string;
      name?: string;
      effect?: string;
      oracle_text?: string;
      oracleText?: string;
      abilities?: unknown;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    const id = String(record.id || '').trim();
    if (!id || seen.has(id)) return;
    const abilityText = Array.isArray(record.abilities)
      ? record.abilities.map((entry) => String(entry || '').trim()).filter(Boolean).join(' ')
      : '';
    const oracle = normalizeOraclePatternText(
      record.effect || record.oracle_text || record.oracleText || abilityText || readCardOracleText(record.card),
    ).toLowerCase();
    if (!oracle) return;
    seen.add(id);
    sources.push({
      id,
      controller: String(record.controller || record.owner || '').trim(),
      name: String(record.sourceName || record.name || record.card?.name || 'Emblem').trim() || 'Emblem',
      oracle,
    });
  };

  const rootEmblems = Array.isArray((state as { emblems?: unknown })?.emblems)
    ? (state as { emblems: unknown[] }).emblems
    : [];
  for (const emblem of rootEmblems) push(emblem);

  const players = Array.isArray((state as { players?: unknown })?.players)
    ? (state as { players: unknown[] }).players
    : [];
  for (const player of players) {
    if (!player || typeof player !== 'object') continue;
    const playerEmblems = Array.isArray((player as { emblems?: unknown }).emblems)
      ? (player as { emblems: unknown[] }).emblems
      : [];
    for (const emblem of playerEmblems) push(emblem);
  }

  return sources;
}

function findBattlefieldPermanent(state: unknown, permanentId: string): {
  id?: string;
  controller?: string;
  type_line?: string;
  card?: { type_line?: string };
} | undefined {
  const id = String(permanentId || '').trim();
  if (!id) return undefined;
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  return battlefield.find((perm) => {
    if (!perm || typeof perm !== 'object') return false;
    return String((perm as { id?: string }).id || '').trim() === id;
  }) as { id?: string; controller?: string; type_line?: string; card?: { type_line?: string } } | undefined;
}

function permanentMatchesDamageTypeTokens(
  permanent: unknown,
  tokens: readonly string[],
): boolean {
  if (!permanent || tokens.length === 0) return false;
  const typeLine = String(
    (permanent as { card?: { type_line?: string }; type_line?: string }).card?.type_line
    || (permanent as { type_line?: string }).type_line
    || '',
  ).toLowerCase();
  for (const token of tokens) {
    const wanted = String(token || '').trim().toLowerCase();
    if (!wanted) continue;
    if (DAMAGE_RECIPIENT_CARD_TYPE_TOKENS.has(wanted)) {
      if (!typeLine.includes(wanted)) return false;
      continue;
    }
    if (permanentHasCreatureTypeNow(permanent, wanted)) continue;
    const typeTokens = typeLine.split(/[^a-z0-9/-]+/).filter(Boolean);
    if (!typeTokens.includes(wanted)) return false;
  }
  return true;
}

export function overlaySpecsMatchDamage(
  spec: ReplacementEffectSpec,
  input: {
    damageDealer: string;
    damageReceiver: string;
    damageSourcePermanentId?: string;
    isCombatDamage?: boolean;
    targetPermanentId?: string;
  },
  state?: unknown,
): boolean {
  if (spec.event !== 'damage') return false;
  const match = spec.match || {};
  const sourceController = String(spec.sourceController || '');
  const dealer = String(input.damageDealer || '');
  const receiver = String(input.damageReceiver || '');

  if (typeof match.dealingPlayerIsSourceController === 'boolean') {
    if ((dealer === sourceController) !== match.dealingPlayerIsSourceController) return false;
  }
  if (typeof match.receivingPlayerIsOpponentOfSource === 'boolean') {
    const isOpponent = Boolean(sourceController) && Boolean(receiver) && receiver !== sourceController;
    if (isOpponent !== match.receivingPlayerIsOpponentOfSource) return false;
  }
  if (typeof match.receivingPlayerIsSourceController === 'boolean') {
    if ((receiver === sourceController) !== match.receivingPlayerIsSourceController) return false;
  }
  if (match.combatDamageOnly === true && !input.isCombatDamage) {
    return false;
  }
  if (match.damageSourceIsEnchantedBySource === true) {
    const damageSourceId = String(input.damageSourcePermanentId || '').trim();
    const auraId = String(spec.sourcePermanentId || '').trim();
    if (!damageSourceId || !auraId || !state) return false;
    const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
      ? (state as { battlefield: unknown[] }).battlefield
      : [];
    const aura = battlefield.find((perm) => {
      if (!perm || typeof perm !== 'object') return false;
      return String((perm as { id?: string }).id || '').trim() === auraId;
    }) as { attachedTo?: string } | undefined;
    if (!aura) return false;
    if (String(aura.attachedTo || '').trim() !== damageSourceId) return false;
  }

  if (match.receivingIsYouOrMatchingPermanentYouControl === true) {
    const targetPermanentId = String(input.targetPermanentId || '').trim();
    const typeTokens = Array.isArray(match.receivingPermanentTypeIncludesAll)
      ? match.receivingPermanentTypeIncludesAll
      : [];
    if (!targetPermanentId) {
      if (receiver !== sourceController) return false;
    } else {
      if (!state) return false;
      const targetPermanent = findBattlefieldPermanent(state, targetPermanentId);
      if (!targetPermanent) return false;
      if (String(targetPermanent.controller || '') !== sourceController) return false;
      if (typeTokens.length > 0 && !permanentMatchesDamageTypeTokens(targetPermanent, typeTokens)) {
        return false;
      }
    }
  }

  const needsReceivingPermanent =
    match.receivingIsYouOrMatchingPermanentYouControl !== true
    && (
      typeof match.receivingPermanentControllerIsSourceController === 'boolean'
      || match.receivingPermanentIsNotSource === true
      || (Array.isArray(match.receivingPermanentTypeIncludesAll)
        && match.receivingPermanentTypeIncludesAll.length > 0)
    );
  if (needsReceivingPermanent) {
    const targetPermanentId = String(input.targetPermanentId || '').trim();
    if (!targetPermanentId || !state) return false;
    const targetPermanent = findBattlefieldPermanent(state, targetPermanentId);
    if (!targetPermanent) return false;
    if (typeof match.receivingPermanentControllerIsSourceController === 'boolean') {
      const sameController = String(targetPermanent.controller || '') === sourceController;
      if (sameController !== match.receivingPermanentControllerIsSourceController) return false;
    }
    if (match.receivingPermanentIsNotSource === true) {
      const sourceId = String(spec.sourcePermanentId || '').trim();
      if (!sourceId || targetPermanentId === sourceId) return false;
    }
    if (Array.isArray(match.receivingPermanentTypeIncludesAll)
      && match.receivingPermanentTypeIncludesAll.length > 0
      && !permanentMatchesDamageTypeTokens(targetPermanent, match.receivingPermanentTypeIncludesAll)) {
      return false;
    }
  }
  return true;
}
