// server/src/state/modules/staticEffectSpec-handlers/batch86LongTailStatics.ts
// B86 static long-tail:
//   Breath of Dreams — COLOR creatures have quoted ability
//   Titan of Eternal Fire — each TYPE creature you control has quoted ability
//   Timber Protector — other TYPE and Forests you control have keywords
//   Maskwood Nexus — creatures you control are every creature type
//   Elven Riders — can't be blocked except by Walls and/or flying
//   Tromokratis — hexproof unless attacking/blocking; all-must-block
//   Greymond — subtype you control have each of the chosen abilities
//   Nature's Embrace — enchanted permanent (while a land) has quoted mana ability
//   Swift Reconfiguration — enchanted permanent crew ability (type-set via attachedTypeSettingStamp)
//   Spellbane Centaur — creatures you control have protection from COLOR
//   Hooded Horror — can't be blocked while defending player has most creatures
// Public: pushBatch86LongTailStaticSpecs.
// Sibling: Gaddock Teeg via castRestrictionTail; Exdeath/Chameleon via variablePT;
//   Wolverine/Collective Inferno via replacementBatch65; Rite via attackYouTax.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function pushColorCreaturesQuoted(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/^(white|blue|black|red|green) creatures have "([^"]+)"\.?$/m);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(`"${m[2]}"`);
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    `color-creatures-quoted:${m[1]}`,
    { kind: 'all_creatures' },
    { abilities },
    { kind: 'target_has_mana_color', color: m[1] } as StaticEffectCondition,
  ));
}

function pushEachTypeYouControlQuoted(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/each ([a-z]+) creature you control has "([^"]+)"/);
  if (!m) return;
  const creatureType = cap(String(m[1] || '').trim());
  const abilities = parseLordAbilitiesFromTail(`"${m[2]}"`);
  if (!creatureType || !abilities.length) return;
  specs.push(buildSpec(
    source,
    `each-type-you-control-quoted:${creatureType.toLowerCase()}`,
    { kind: 'creatures_you_control', creatureType },
    { abilities },
  ));
}

function pushOtherTypeAndForestsKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/other ([a-z]+) and forests you control have ([^.]+)/);
  if (!m) return;
  const creatureType = cap(String(m[1] || '').trim());
  const abilities = parseLordAbilitiesFromTail(m[2] || '');
  if (!creatureType || !abilities.length) return;
  specs.push(buildSpec(
    source,
    `other-${creatureType.toLowerCase()}-you-control-keywords`,
    { kind: 'other_creatures_you_control', creatureType },
    { abilities },
  ));
  specs.push(buildSpec(
    source,
    'other-forests-you-control-keywords',
    { kind: 'lands_you_control' },
    { abilities },
    { kind: 'target_has_any_subtype', subtypes: ['forest'] } as StaticEffectCondition,
  ));
}

function pushEveryCreatureTypeYouControl(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/creatures you control are every creature type/.test(text)) return;
  specs.push(buildSpec(
    source,
    'creatures-you-control-every-type',
    { kind: 'creatures_you_control' },
    { typeAdditions: ['*'] },
  ));
}

function pushWallsOrFlyingBlockRestriction(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:this creature|~) can(?:'t|not) be blocked except by walls and\/or creatures with flying/.test(text)) {
    return;
  }
  specs.push(buildSpec(
    source,
    'walls-or-flying-block-restriction',
    { kind: 'self' },
    { abilities: ["can't be blocked except by Walls and/or creatures with flying"] },
  ));
}

function pushHexproofUnlessAttackingOrBlocking(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:this creature|~|[a-z' ,.-]+?) has hexproof unless (?:it'?s|it is) attacking or blocking/.test(text)) {
    return;
  }
  specs.push({
    ...buildSpec(
      source,
      'hexproof-unless-attacking-or-blocking',
      { kind: 'self' },
      { abilities: ['hexproof'] },
      { kind: 'target_is_attacking_or_blocking' } as StaticEffectCondition,
    ),
    conditionNegated: true,
  });
}

function pushAllMustBlock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:this creature|~|[a-z' ,.-]+?) can(?:'t|not) be blocked unless all creatures defending player controls block it/.test(text)) {
    return;
  }
  specs.push(buildSpec(
    source,
    'all-must-block',
    { kind: 'self' },
    { abilities: ["can't be blocked unless all creatures defending player controls block it"] },
  ));
}

function pushChosenAbilitiesYouControl(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/([a-z]+) you control have each of the chosen abilities/);
  if (!m) return;
  let noun = String(m[1] || '').trim().toLowerCase();
  if (noun.endsWith('ies')) noun = `${noun.slice(0, -3)}y`;
  else if (noun.endsWith('s') && !noun.endsWith('ss')) noun = noun.slice(0, -1);
  const creatureType = cap(noun);
  const raw = Array.isArray((perm as any)?.chosenOptions)
    ? (perm as any).chosenOptions
    : [(perm as any)?.chosenOption, (perm as any)?.chosenMode];
  const abilities = raw
    .map((v: unknown) => String(v || '').trim().toLowerCase().replace(/^\u2022\s*/, '').replace(/[.\s]+$/, ''))
    .filter(Boolean);
  if (!creatureType || !abilities.length) return;
  specs.push(buildSpec(
    source,
    `chosen-abilities-you-control:${creatureType.toLowerCase()}`,
    { kind: 'creatures_you_control', creatureType },
    { abilities },
  ));
}

function pushEnchantedLandQuotedAbility(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/as long as enchanted permanent is an? land, it has "([^"]+)"/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(`"${m[1]}"`);
  if (!abilities.length) return;
  specs.push({
    ...buildSpec(
      source,
      'enchanted-land-quoted-ability',
      { kind: 'self' },
      { abilities },
      { kind: 'target_has_type', cardType: 'land' } as StaticEffectCondition,
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushEnchantedVehicleCrew(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /enchanted permanent is an? vehicle artifact with crew (\d+) and (?:it )?loses all other card types/,
  );
  if (!m) return;
  specs.push({
    ...buildSpec(
      source,
      'enchanted-vehicle-crew',
      { kind: 'self' },
      { abilities: [`crew ${m[1]}`] },
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushCreaturesYouControlProtectionFromColor(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /creatures you control can(?:'t|not) be the targets? of (white|blue|black|red|green) spells or abilities from \1 sources/,
  );
  if (!m) return;
  specs.push(buildSpec(
    source,
    `creatures-you-control-protection-from-${m[1]}`,
    { kind: 'creatures_you_control' },
    { abilities: [`protection from ${m[1]}`] },
  ));
}

function pushDefendingMostCreaturesUnblockable(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:this creature|~) can(?:'t|not) be blocked as long as defending player controls the most creatures or is tied for the most/.test(text)) {
    return;
  }
  specs.push(buildSpec(
    source,
    'defending-most-creatures-unblockable',
    { kind: 'self' },
    { abilities: ["can't be blocked"] },
    { kind: 'defending_player_controls_most_creatures' } as StaticEffectCondition,
  ));
}

export function pushBatch86LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushColorCreaturesQuoted(specs, source, oracle);
  pushEachTypeYouControlQuoted(specs, source, oracle);
  pushOtherTypeAndForestsKeywords(specs, source, oracle);
  pushEveryCreatureTypeYouControl(specs, source, oracle);
  pushWallsOrFlyingBlockRestriction(specs, source, oracle);
  pushHexproofUnlessAttackingOrBlocking(specs, source, oracle);
  pushAllMustBlock(specs, source, oracle);
  pushChosenAbilitiesYouControl(specs, source, perm, oracle);
  pushEnchantedLandQuotedAbility(specs, source, perm, oracle);
  pushEnchantedVehicleCrew(specs, source, perm, oracle);
  pushCreaturesYouControlProtectionFromColor(specs, source, oracle);
  pushDefendingMostCreaturesUnblockable(specs, source, oracle);
}
