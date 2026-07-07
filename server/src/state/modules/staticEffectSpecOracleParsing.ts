import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import type { StaticEffectCountBasis, StaticEffectGrant, StaticEffectSpec } from './staticEffectSpec.js';

const ABILITY_WORDS = [
  'flying', 'indestructible', 'vigilance', 'trample', 'hexproof', 'shroud',
  'deathtouch', 'lifelink', 'haste', 'menace', 'reach', 'first strike',
  'double strike', 'protection', 'ward',
];

const SMALL_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1,
};

function parseCardCountWord(raw: string): number | undefined {
  const lower = String(raw || '').toLowerCase();
  if (SMALL_NUMBER_WORDS[lower] !== undefined) return SMALL_NUMBER_WORDS[lower];
  const parsed = parseInt(lower, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBuffSegment(seg: string): { power: number; toughness: number } | null {
  const match = String(seg || '').match(/([+-]?\d+)\s*\/\s*([+-]?\d+)/);
  if (!match) return null;
  const power = parseInt(match[1], 10);
  const toughness = parseInt(match[2], 10);
  if (Number.isNaN(power) || Number.isNaN(toughness)) return null;
  return { power, toughness };
}

function parseAbilitiesFromTail(tail: string): string[] {
  const found: string[] = [];
  const lower = String(tail || '').toLowerCase();
  for (const ability of ABILITY_WORDS) {
    if (new RegExp(`\\b${ability}\\b`, 'i').test(lower)) {
      found.push(ability);
    }
  }
  return found;
}

function resolveChosenOptionsFromPermanent(perm: BattlefieldPermanent): string[] {
  const chosenValues = Array.isArray((perm as any)?.chosenOptions)
    ? (perm as any).chosenOptions
    : [((perm as any)?.chosenOption ?? '')];
  return chosenValues
    .map((value: unknown) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length > 0 && ABILITY_WORDS.includes(value));
}

function pushPlayerAbilityGrantsFromList(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  idSuffix: string,
  abilities: readonly string[],
): void {
  if (abilities.includes('hexproof')) {
    specs.push(buildSpec(
      source,
      `${idSuffix}-player-hexproof`,
      { kind: 'player_you' },
      { playerHexproof: true },
    ));
  }
  if (abilities.includes('shroud')) {
    specs.push(buildSpec(
      source,
      `${idSuffix}-player-shroud`,
      { kind: 'player_you' },
      { playerShroud: true },
    ));
  }
}

function parseLordAbilitiesFromTail(tail: string): string[] {
  if (/abilities of your choice among/i.test(tail)) {
    return [];
  }
  return parseAbilitiesFromTail(tail);
}

function parseLordCreatureType(raw: string): string {
  const lower = String(raw || '').trim().toLowerCase();
  if (lower.endsWith('s') && lower.length > 2) {
    return lower.slice(0, -1);
  }
  return lower;
}

function buildSpec(
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  idSuffix: string,
  scope: StaticEffectSpec['scope'],
  grant: StaticEffectGrant,
  condition?: StaticEffectSpec['condition'],
): StaticEffectSpec {
  return {
    id: `${source.sourcePermanentId}:${idSuffix}`,
    scope,
    grant,
    condition,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
}

function pushChosenTypeAbilityGrantSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const chosenMatch = oracle.match(
    /other\s+([a-z]+)s?\s+(?:creatures?\s+)?you\s+control\s+get\s+(\+\d+\s*\/\s*\+\d+)\s+and\s+have\s+all\s+abilities\s+of\s+your\s+choice\s+among/i,
  );
  if (!chosenMatch) return;

  const creatureType = parseLordCreatureType(String(chosenMatch[1] || ''));
  const abilities = resolveChosenOptionsFromPermanent(perm);
  if (!creatureType || abilities.length === 0) return;

  specs.push(buildSpec(
    source,
    `other-${creatureType}-chosen-abilities`,
    { kind: 'other_creatures_you_control', creatureType },
    { abilities },
  ));
}

function pushAbilityGrantSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushChosenTypeAbilityGrantSpecs(specs, source, perm, oracle);

  const shalaiStyleMatch = oracle.match(
    /you,?\s+planeswalkers you control,?\s+and\s+other\s+creatures you control have\s+([^.]+)/i,
  );
  if (shalaiStyleMatch) {
    const abilities = parseAbilitiesFromTail(shalaiStyleMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'other-creatures-ability-grant',
        { kind: 'other_creatures_you_control' },
        { abilities },
      ));
      specs.push(buildSpec(
        source,
        'planeswalker-ability-grant',
        { kind: 'planeswalkers_you_control' },
        { abilities },
      ));
      pushPlayerAbilityGrantsFromList(specs, source, 'shalai-style', abilities);
    }
    return;
  }

  const youAndOtherMatch = oracle.match(/you and other creatures you control have\s+([^.]+)/i);
  if (youAndOtherMatch) {
    const abilities = parseAbilitiesFromTail(youAndOtherMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'you-and-other-creatures-ability-grant',
        { kind: 'other_creatures_you_control' },
        { abilities },
      ));
      pushPlayerAbilityGrantsFromList(specs, source, 'you-and-other', abilities);
    }
    return;
  }

  if (/abilities of your choice among/i.test(oracle)) {
    return;
  }

  const otherTypedAbilityMatch = oracle.match(
    /other\s+([a-z]+)\s+creatures?\s+you\s+control\s+have\s+([^.]+)/i,
  );
  if (otherTypedAbilityMatch) {
    const creatureType = parseLordCreatureType(String(otherTypedAbilityMatch[1] || ''));
    const abilities = parseAbilitiesFromTail(otherTypedAbilityMatch[2] || '');
    if (creatureType && abilities.length > 0) {
      specs.push(buildSpec(
        source,
        `other-${creatureType}-ability-grant`,
        { kind: 'other_creatures_you_control', creatureType },
        { abilities },
      ));
    }
    return;
  }

  const otherCreaturesAbilityMatch = oracle.match(/other creatures you control have ([^.]+)/i);
  if (otherCreaturesAbilityMatch) {
    const abilities = parseAbilitiesFromTail(otherCreaturesAbilityMatch[1] || '');
    if (abilities.length > 0) {
      specs.push(buildSpec(
        source,
        'other-creatures-ability-grant',
        { kind: 'other_creatures_you_control' },
        { abilities },
      ));
    }
    return;
  }

  if (!/other creatures you control have/i.test(oracle)) {
    const creaturesAbilityMatch = oracle.match(/creatures you control have ([^.]+)/i);
    if (creaturesAbilityMatch) {
      const abilities = parseAbilitiesFromTail(creaturesAbilityMatch[1] || '');
      if (abilities.length > 0) {
        specs.push(buildSpec(
          source,
          'creatures-ability-grant',
          { kind: 'creatures_you_control' },
          { abilities },
        ));
      }
    }
  }
}

const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'];

function pushColorAnthemSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  oracle: string,
): void {
  for (const colorWord of COLOR_WORDS) {
    const match = oracle.match(new RegExp(`${colorWord}\\s+creatures\\s+get\\s+([+-]\\d+\\s*/\\s*[+-]\\d+)`, 'i'));
    if (!match) continue;
    const buff = parseBuffSegment(match[1]);
    if (!buff) continue;
    specs.push(buildSpec(
      source,
      `${colorWord}-creatures-anthem`,
      { kind: 'all_creatures' },
      { power: buff.power, toughness: buff.toughness },
      { kind: 'target_has_mana_color', color: colorWord },
    ));
  }
}

function pushDynamicLordSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  oracle: string,
): void {
  const coatMatch = oracle.match(
    /each creature gets \+(\d+)\/\+(\d+) for each other creature on the battlefield that shares at least one creature type with it/i,
  );
  if (coatMatch) {
    const power = parseInt(coatMatch[1], 10);
    const toughness = parseInt(coatMatch[2], 10);
    if (!Number.isNaN(power) && !Number.isNaN(toughness)) {
      specs.push(buildSpec(
        source,
        'shared-type-dynamic-lord',
        { kind: 'all_creatures' },
        {
          power,
          toughness,
          countBasis: 'other_creatures_sharing_creature_type' satisfies StaticEffectCountBasis,
        },
      ));
    }
    return;
  }

  const sliverLegionMatch = oracle.match(
    /(?:all )?sliver creatures get \+(\d+)\/\+(\d+) for each other sliver on the battlefield/i,
  );
  if (sliverLegionMatch) {
    const power = parseInt(sliverLegionMatch[1], 10);
    const toughness = parseInt(sliverLegionMatch[2], 10);
    if (!Number.isNaN(power) && !Number.isNaN(toughness)) {
      specs.push(buildSpec(
        source,
        'sliver-dynamic-lord',
        { kind: 'all_creatures_of_type', creatureType: 'sliver' },
        {
          power,
          toughness,
          countBasis: 'other_creatures_matching_scope' satisfies StaticEffectCountBasis,
        },
      ));
    }
  }
}

function pushLordSpecs(
  specs: StaticEffectSpec[],
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  oracle: string,
): void {
  const deathBaronMatch = oracle.match(
    /skeletons you control and other zombies you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
  );
  if (deathBaronMatch) {
    const buff = parseBuffSegment(deathBaronMatch[1]);
    if (!buff) return;
    const abilities = parseLordAbilitiesFromTail(deathBaronMatch[2] || '');
    specs.push(buildSpec(
      source,
      'skeleton-lord',
      { kind: 'creatures_you_control', creatureType: 'skeleton' },
      { power: buff.power, toughness: buff.toughness, abilities },
    ));
    specs.push(buildSpec(
      source,
      'other-zombie-lord',
      { kind: 'other_creatures_you_control', creatureType: 'zombie' },
      { power: buff.power, toughness: buff.toughness, abilities },
    ));
    return;
  }

  const otherTypeMatch = oracle.match(
    /other\s+([a-z]+)s?\s+(?:creatures?\s+)?(?:you\s+control\s+)?get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
  );
  if (otherTypeMatch) {
    const creatureType = parseLordCreatureType(String(otherTypeMatch[1] || ''));
    const buff = parseBuffSegment(otherTypeMatch[2]);
    if (creatureType && buff) {
      const hasYouControl = /you\s+control/i.test(otherTypeMatch[0]);
      specs.push(buildSpec(
        source,
        `other-${creatureType}-lord`,
        hasYouControl
          ? { kind: 'other_creatures_you_control', creatureType }
          : { kind: 'other_all_creatures_of_type', creatureType },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseLordAbilitiesFromTail(otherTypeMatch[3] || ''),
        },
      ));
    }
  }
}

/** Parse anthem/lord/conditional static P/T from battlefield oracle text (Phase 5.4). */
export function parseStaticEffectSpecsFromOraclePermanent(
  perm: BattlefieldPermanent,
): StaticEffectSpec[] {
  const oracleText = String((perm as any)?.card?.oracle_text || (perm as any)?.oracle_text || '').trim();
  if (!oracleText) return [];

  const oracle = oracleText.toLowerCase();
  const sourcePermanentId = String(perm.id || '').trim();
  const sourceController = String(perm.controller || '').trim();
  const sourceName = String((perm as any)?.card?.name || (perm as any)?.name || 'Unknown').trim();
  if (!sourcePermanentId || !sourceController) return [];

  const source = { sourcePermanentId, sourceController, sourceName };
  const specs: StaticEffectSpec[] = [];
  const chosenCreatureType = String((perm as any)?.chosenCreatureType || '').trim().toLowerCase();
  const chosenColor = String(
    (perm as any)?.chosenColor || (perm as any)?.card?.chosenColor || '',
  ).trim().toLowerCase();

  pushDynamicLordSpecs(specs, source, oracle);
  if (specs.length > 0) return specs;

  const leylineLifeMatch = oracle.match(
    /if you have at least (\w+) life more than your starting life total, creatures you control get (\+\d+\s*\/\s*\+\d+)/i,
  );
  if (leylineLifeMatch) {
    const offset = parseCardCountWord(leylineLifeMatch[1]);
    const buff = parseBuffSegment(leylineLifeMatch[2]);
    if (offset !== undefined && buff) {
      specs.push(buildSpec(
        source,
        'life-threshold-anthem',
        { kind: 'creatures_you_control' },
        { power: buff.power, toughness: buff.toughness },
        { kind: 'controller_life_at_least_starting_plus', offset },
      ));
    }
  }

  const tokenTurnBuffMatch = oracle.match(
    /during your turn,?\s*creature tokens you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i,
  );
  if (tokenTurnBuffMatch) {
    const buff = parseBuffSegment(tokenTurnBuffMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'turn-token-buff',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(tokenTurnBuffMatch[2] || ''),
        },
        { kind: 'target_is_token_during_source_controller_turn' },
      ));
    }
  } else {
    const tokenBuffMatch = oracle.match(/creature tokens you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i);
    if (tokenBuffMatch) {
      const buff = parseBuffSegment(tokenBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'token-anthem',
          { kind: 'creatures_you_control' },
          {
            power: buff.power,
            toughness: buff.toughness,
            abilities: parseAbilitiesFromTail(tokenBuffMatch[2] || ''),
          },
          { kind: 'target_is_token' },
        ));
      }
    }
  }

  const nontokenBuffMatch = oracle.match(/nontoken creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (nontokenBuffMatch) {
    const buff = parseBuffSegment(nontokenBuffMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'nontoken-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(nontokenBuffMatch[2] || ''),
        },
        { kind: 'target_is_not_token' },
      ));
    }
  }

  const nonblackMatch = oracle.match(/nonblack creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (nonblackMatch) {
    const buff = parseBuffSegment(nonblackMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'nonblack-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(nonblackMatch[2] || ''),
        },
        { kind: 'target_is_not_black_creature' },
      ));
    }
  }

  const nonHumanMatch = oracle.match(/non[- ]?human creatures you control get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i);
  if (nonHumanMatch) {
    const buff = parseBuffSegment(nonHumanMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'nonhuman-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(nonHumanMatch[2] || ''),
        },
        { kind: 'target_is_not_human_creature' },
      ));
    }
  }

  const allCreaturesMatch = oracle.match(/all creatures get (\+\d+\s*\/\s*\+\d+)/i);
  if (allCreaturesMatch) {
    const buff = parseBuffSegment(allCreaturesMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'all-creatures-anthem',
        { kind: 'all_creatures' },
        { power: buff.power, toughness: buff.toughness },
      ));
    }
  }

  const hasOtherTypeLordPattern = /other\s+[a-z]+\s+creatures?\s+you\s+control\s+get/i.test(oracle);

  const monumentMatch = oracle.match(
    /(?<!nonblack )(?<!non[- ]?human )creatures you control get (\+\d+\s*\/\s*\+\d+)\s+and have\s+([^.]+)/i,
  );
  if (monumentMatch) {
    const buff = parseBuffSegment(monumentMatch[1]);
    if (buff) {
      specs.push(buildSpec(
        source,
        'monument-anthem',
        { kind: 'creatures_you_control' },
        {
          power: buff.power,
          toughness: buff.toughness,
          abilities: parseAbilitiesFromTail(monumentMatch[2] || ''),
        },
      ));
    }
  } else {
    const anthemMatch = !leylineLifeMatch
      && !tokenTurnBuffMatch
      && !oracle.includes('creature tokens you control get')
      && !nontokenBuffMatch
      && !hasOtherTypeLordPattern
      ? oracle.match(/(?<!nonblack )(?<!non[- ]?human )creatures you control get (\+\d+\s*\/\s*\+\d+)([^.]*)/i)
      : null;
    if (anthemMatch) {
      const buff = parseBuffSegment(anthemMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'creatures-anthem',
          { kind: 'creatures_you_control' },
          {
            power: buff.power,
            toughness: buff.toughness,
            abilities: parseAbilitiesFromTail(anthemMatch[2] || ''),
          },
        ));
      }
    }
  }

  pushLordSpecs(specs, source, oracle);
  pushAbilityGrantSpecs(specs, source, perm, oracle);
  pushColorAnthemSpecs(specs, source, oracle);

  if (chosenColor) {
    const chosenColorBuffMatch = oracle.match(/creatures you control of the chosen color get\s+(\+\d+\s*\/\s*\+\d+)/i);
    if (chosenColorBuffMatch) {
      const buff = parseBuffSegment(chosenColorBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'chosen-color-anthem',
          { kind: 'creatures_you_control' },
          { power: buff.power, toughness: buff.toughness },
          { kind: 'target_has_mana_color', color: chosenColor },
        ));
      }
    }
  }

  if (chosenCreatureType) {
    const chosenTypeOtherBuffMatch = oracle.match(
      /other creatures you control of the chosen type get\s+(\+\d+\s*\/\s*\+\d+)/i,
    );
    if (chosenTypeOtherBuffMatch) {
      const buff = parseBuffSegment(chosenTypeOtherBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'chosen-type-other-lord',
          { kind: 'other_creatures_you_control', creatureType: chosenCreatureType },
          { power: buff.power, toughness: buff.toughness },
        ));
      }
    }

    const hasOtherChosenTypeLord = /other creatures you control of the chosen type get/i.test(oracle);

    if (!hasOtherChosenTypeLord) {
      const controlledChosenTypeBuffMatch = oracle.match(
        /creatures you control of the chosen type get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
      );
      if (controlledChosenTypeBuffMatch) {
        const buff = parseBuffSegment(controlledChosenTypeBuffMatch[1]);
        if (buff) {
          specs.push(buildSpec(
            source,
            'chosen-type-controlled-anthem',
            { kind: 'creatures_you_control', creatureType: chosenCreatureType },
            {
              power: buff.power,
              toughness: buff.toughness,
              abilities: parseLordAbilitiesFromTail(controlledChosenTypeBuffMatch[2] || ''),
            },
          ));
        }
      }
    }

    const opponentDebuffMatch = oracle.match(
      /creatures of the chosen type your opponents control get\s+([+-]?\d+)\s*\/\s*([+-]?\d+)/i,
    );
    if (opponentDebuffMatch) {
      const power = parseInt(opponentDebuffMatch[1], 10);
      const toughness = parseInt(opponentDebuffMatch[2], 10);
      if (!Number.isNaN(power) && !Number.isNaN(toughness)) {
        specs.push(buildSpec(
          source,
          'opponent-chosen-type-debuff',
          { kind: 'opponent_creatures_of_type', creatureType: chosenCreatureType },
          { power, toughness },
        ));
      }
    }

    const globalChosenTypeBuffMatch = oracle.match(
      /creatures of the chosen type(?! your opponents) get\s+(\+\d+\s*\/\s*\+\d+)([^.]*)/i,
    );
    if (globalChosenTypeBuffMatch) {
      const buff = parseBuffSegment(globalChosenTypeBuffMatch[1]);
      if (buff) {
        specs.push(buildSpec(
          source,
          'chosen-type-global-anthem',
          { kind: 'all_creatures_of_type', creatureType: chosenCreatureType },
          {
            power: buff.power,
            toughness: buff.toughness,
            abilities: parseLordAbilitiesFromTail(globalChosenTypeBuffMatch[2] || ''),
          },
        ));
      }
    }

    const controlledChosenTypeAbilitiesMatch = oracle.match(
      /creatures you control of the chosen type have\s+([^.]+)/i,
    );
    if (controlledChosenTypeAbilitiesMatch) {
      const abilities = parseAbilitiesFromTail(controlledChosenTypeAbilitiesMatch[1] || '');
      if (abilities.length > 0) {
        specs.push(buildSpec(
          source,
          'chosen-type-controlled-abilities',
          { kind: 'creatures_you_control', creatureType: chosenCreatureType },
          { abilities },
        ));
      }
    }

    const globalChosenTypeAbilitiesMatch = oracle.match(
      /creatures of the chosen type have\s+([^.]+)/i,
    );
    if (globalChosenTypeAbilitiesMatch) {
      const abilities = parseAbilitiesFromTail(globalChosenTypeAbilitiesMatch[1] || '');
      if (abilities.length > 0) {
        specs.push(buildSpec(
          source,
          'chosen-type-global-abilities',
          { kind: 'all_creatures_of_type', creatureType: chosenCreatureType },
          { abilities },
        ));
      }
    }
  }

  return specs;
}

export function staticEffectSpecHasPowerToughnessGrant(spec: StaticEffectSpec): boolean {
  const perCount = Number(spec.grant.power || 0) !== 0 || Number(spec.grant.toughness || 0) !== 0;
  return perCount;
}

export function collectDeclarativeStaticSourcePermanentIds(specs: readonly StaticEffectSpec[]): Set<string> {
  const sourceIds = new Set<string>();
  for (const spec of specs) {
    const sourceId = String(spec.sourcePermanentId || '').trim();
    if (sourceId) sourceIds.add(sourceId);
  }
  return sourceIds;
}

export function collectDeclarativePtSourcePermanentIds(specs: readonly StaticEffectSpec[]): Set<string> {
  const sourceIds = new Set<string>();
  for (const spec of specs) {
    if (!staticEffectSpecHasPowerToughnessGrant(spec)) continue;
    const sourceId = String(spec.sourcePermanentId || '').trim();
    if (sourceId) sourceIds.add(sourceId);
  }
  return sourceIds;
}
