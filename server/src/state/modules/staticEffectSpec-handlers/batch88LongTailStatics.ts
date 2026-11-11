// server/src/state/modules/staticEffectSpec-handlers/batch88LongTailStatics.ts
// B88 static long-tail:
//   Circle of the Moon Druid — during your turn, is a TYPE with base P/T
//   Departed Deckhand — can't be blocked except by TYPE
//   Bladeback Sliver — hellbent type-lord quoted ability
//   Mephidross Vampire — each creature is TYPE + quoted ability
//   Melira — you can't get poison counters
//   Gorm — must be blocked if able + by N or more if able
//   Marauding Maulhorn — attacks each combat if able unless named creature
//   Cid — artifact creatures and Heroes for each Artificer BF+GY
// Public: pushBatch88LongTailStaticSpecs.
// Sibling: Ixidor via subtypeListLords face-down; Steel via attachedExtras;
//   Razorkin via conditionalSelfGrants trailing during-turn; Hamsphere/Copperhoof/Strata via countedPT;
//   Cecily via handSize; Wild-Magic cascade classifier; Omnath color via batch77;
//   Archpriest party via variablePowerOnly; Zhao via landTypeSetting; Ashes via castRestriction.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  parseLordCreatureType,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function countWord(raw: string): number | undefined {
  const w = String(raw || '').toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return COUNT_WORDS[w];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function singularType(raw: string): string {
  let n = String(raw || '').toLowerCase().trim();
  if (n.endsWith('ies')) n = `${n.slice(0, -3)}y`;
  else if (n.endsWith('s') && !n.endsWith('ss')) n = n.slice(0, -1);
  return n;
}

function pushDuringTurnTypeBasePt(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /during your turn, (?:this creature|~|[a-z' ,.-]+?) is an? ([a-z]+) with base power and toughness (\d+)\s*\/\s*(\d+)/,
  );
  if (!m) return;
  const typeWord = cap(singularType(m[1] || ''));
  if (!typeWord || !isCreatureTypeWord(typeWord)) return;
  specs.push(buildSpec(
    source,
    `during-turn-type-base-pt:${typeWord.toLowerCase()}`,
    { kind: 'self' },
    {
      typeAdditions: [typeWord],
      loseOtherCreatureTypes: true,
      setPower: Number(m[2]),
      setToughness: Number(m[3]),
    },
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
  ));
}

function pushSelfExceptByType(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/(?:this creature|~) can(?:not|'t) be blocked except by ([a-z]+)s?/);
  if (!m) return;
  const typeWord = singularType(m[1] || '');
  if (!typeWord || ['creature', 'artifact'].includes(typeWord)) return;
  if (!isCreatureTypeWord(cap(typeWord))) return;
  const label = cap(typeWord) + 's';
  specs.push(buildSpec(
    source,
    `self-except-by-type:${typeWord}`,
    { kind: 'self' },
    { abilities: [`can't be blocked except by ${label}`] },
  ));
}

function pushHellbentTypeQuoted(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:hellbent\s*[—–-]\s*)?as long as you have no cards in hand, ([a-z]+) creatures? you control have "([^"]+)"/,
  );
  if (!m) return;
  const creatureType = parseLordCreatureType(m[1] || '');
  if (!creatureType || !isCreatureTypeWord(creatureType)) return;
  const quoted = String(m[2] || '').trim();
  if (!quoted) return;
  specs.push(buildSpec(
    source,
    `hellbent-type-quoted:${creatureType.toLowerCase()}`,
    { kind: 'creatures_you_control', creatureType },
    { abilities: [quoted] },
    { kind: 'zone_count', zone: 'hand', who: 'you', cmp: 'max', count: 0 } as StaticEffectCondition,
  ));
}

function pushEachCreatureTypeQuoted(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each creatures? you control is an? ([a-z]+) in addition to its other creature types and has "([^"]+)"/,
  );
  if (!m) return;
  const creatureType = parseLordCreatureType(m[1] || '');
  if (!creatureType || !isCreatureTypeWord(creatureType)) return;
  const quoted = String(m[2] || '').trim();
  if (!quoted) return;
  specs.push({
    ...buildSpec(
      source,
      `each-creature-type-quoted:${creatureType.toLowerCase()}`,
      { kind: 'creatures_you_control' },
      { typeAdditions: [cap(creatureType)], abilities: [quoted] },
    ),
    layer: 4,
  });
}

function pushCantGetPoison(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/you can(?:not|'t) get poison counters/.test(text)) return;
  specs.push(buildSpec(
    source,
    'cant-get-poison',
    { kind: 'player_you' },
    { abilities: ["can't get poison counters"] },
  ));
}

function pushMustBeBlockedByAtLeast(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  // Gorm compound: also grant plain must-be-blocked-if-able when present.
  if (/(?:this creature|~|[a-z' ,.-]+?) must be blocked if able/.test(text)) {
    specs.push(buildSpec(
      source,
      'must-be-blocked-if-able',
      { kind: 'self' },
      { abilities: ['must_be_blocked_if_able'] },
    ));
  }
  const m = text.match(
    /(?:this creature|~|[a-z' ,.-]+?) must be blocked by (\w+) or more creatures? if able/,
  );
  if (!m) return;
  const n = countWord(m[1] || '');
  if (n === undefined) return;
  specs.push(buildSpec(
    source,
    `must-be-blocked-by-at-least:${n}`,
    { kind: 'self' },
    { abilities: [`must_be_blocked_by_at_least_${n}`] },
  ));
}

function pushAttacksUnlessNamed(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z' ,.-]+?) attacks each combat if able unless you control an? creatures? named ([a-z0-9' ,.-]+)/,
  );
  if (!m) return;
  const named = String(m[1] || '').trim().replace(/\.$/, '');
  if (!named) return;
  const spec = buildSpec(
    source,
    `attacks-unless-named:${named}`,
    { kind: 'self' },
    { abilities: ['attacks each combat if able'] },
    {
      kind: 'controller_controls_named_at_least',
      count: 1,
      option: named,
    } as StaticEffectCondition,
  );
  spec.conditionNegated = true;
  specs.push(spec);
}

function pushArtifactCreaturesAndSubtypeArtificerCount(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /artifact creatures? and ([a-z]+)s? you control get ([+-]\d+\s*\/\s*[+-]\d+) for each ([a-z]+) you control and each \3 cards? in your graveyard/,
  );
  if (!m) return;
  const heroType = parseLordCreatureType(m[1] || '');
  const countType = parseLordCreatureType(m[3] || '');
  const buff = parseBuffSegment(m[2] || '');
  if (!heroType || !countType || !buff) return;
  if (!isCreatureTypeWord(heroType) || !isCreatureTypeWord(countType)) return;
  const grant = {
    power: buff.power,
    toughness: buff.toughness,
    countBasis: 'controller_subtype_battlefield_and_graveyard',
    countCardType: countType.toLowerCase(),
  } as any;
  specs.push(buildSpec(
    source,
    `artifact-creatures-artificer-count`,
    { kind: 'creatures_you_control' },
    grant,
    { kind: 'target_has_type', cardType: 'artifact' } as StaticEffectCondition,
  ));
  specs.push(buildSpec(
    source,
    `subtype-artificer-count:${heroType.toLowerCase()}`,
    { kind: 'creatures_you_control', creatureType: heroType },
    grant,
  ));
}

export function pushBatch88LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushDuringTurnTypeBasePt(specs, source, oracle);
  pushSelfExceptByType(specs, source, oracle);
  pushHellbentTypeQuoted(specs, source, oracle);
  pushEachCreatureTypeQuoted(specs, source, oracle);
  pushCantGetPoison(specs, source, oracle);
  pushMustBeBlockedByAtLeast(specs, source, oracle);
  pushAttacksUnlessNamed(specs, source, oracle);
  pushArtifactCreaturesAndSubtypeArtificerCount(specs, source, oracle);
}
