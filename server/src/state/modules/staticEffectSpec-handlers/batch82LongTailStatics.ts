// server/src/state/modules/staticEffectSpec-handlers/batch82LongTailStatics.ts
// B82 static long-tail:
//   Cloud — during your turn, while equipped, self keywords
//   Arcades Sabboth — untapped creatures you control get ±N/±N while not attacking
//   Alpha Status / Stoneforge — ±N/±N for each other creature sharing a type
//   Thrun — can't be targeted by nongreen opponent spells/abilities
//   Faithbound Judge — N+ counters → ignore defender
//   Pestilent Spirit — instant and sorcery spells you control have keywords
//   Nacatl War-Pride — must be blocked by exactly N if able
//   Cavalry Master — other creatures you control with flanking have flanking
//   Tribal Golem — multiple "has KW as long as you control a TYPE" clauses
//   Dune Chanter — lands you control are Deserts in addition
//   Phoenix Fleet — N+ named permanents → becomes artifact creature
// Public: pushBatch82LongTailStaticSpecs.
// Sibling: Squawkroaster / Coiling / An-Havva / Dragonfly via variablePowerOnlyCalculator;
//   Skycat / Winter / Death's Approach / Bonehoard / Sword of the Squeak via countedPT.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function countWord(raw: string): number | undefined {
  const w = String(raw || '').toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return COUNT_WORDS[w];
}

function pushYourTurnEquippedSelfKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /during your turn, as long as (?:this creature|~|[a-z][a-z' ,.-]{0,40}?) is equipped, (?:it|this creature|~) has ([^.]+)/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  const spec = buildSpec(
    source,
    'your-turn-equipped-self-keywords',
    { kind: 'self' },
    { abilities },
  );
  spec.conditions = [
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
    { kind: 'target_is_equipped' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushUntappedNotAttackingAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each untapped creatures? you control get[s]? ([+-]\d+\s*\/\s*[+-]\d+) as long as (?:it'?s|it is|they(?:'re| are)) not attacking/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const spec = buildSpec(
    source,
    'untapped-not-attacking-anthem',
    { kind: 'creatures_you_control' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_is_attacking' } as StaticEffectCondition,
  );
  // Primary condition is negated ("not attacking"); untapped stays in conditions[].
  spec.conditionNegated = true;
  spec.conditions = [{ kind: 'target_is_untapped' } as StaticEffectCondition];
  specs.push(spec);
}

function pushShareTypeAttachedPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  let m = text.match(
    /enchanted creature gets ([+-]\d+\s*\/\s*[+-]\d+) for each other creature on the battlefield that shares a creature type with it/,
  );
  let who: 'all' | 'you' = 'all';
  if (!m) {
    m = text.match(
      /equipped creature gets ([+-]\d+\s*\/\s*[+-]\d+) for each other creature you control that shares a creature type with it/,
    );
    who = 'you';
  }
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push({
    ...buildSpec(
      source,
      `share-type-attached-pump:${who}`,
      { kind: 'self' },
      {
        power: buff.power,
        toughness: buff.toughness,
        countBasis: 'other_creatures_sharing_creature_type',
        countWho: who,
        countExcludeSource: true,
      },
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushNongreenTargetLock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z][a-z' ,.-]{0,40}?) can(?:not|'t) be the target of nongreen spells your opponents control or abilities from nongreen sources your opponents control/,
  );
  if (!m) return;
  specs.push(buildSpec(
    source,
    'self-nongreen-opponent-target-lock',
    { kind: 'self' },
    {
      abilities: [
        "can't be the target of nongreen spells your opponents control",
        "can't be the target of abilities from nongreen sources your opponents control",
      ],
    },
  ));
}

function pushCounterIgnoreDefender(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as (?:this creature|~|it) has (\w+) or more ([a-z0-9+/ -]+?) counters? on it, (?:it|this creature|~) can attack as though it didn'?t have defender/,
  );
  if (!m) return;
  const amount = countWord(m[1] || '');
  if (amount === undefined) return;
  specs.push(buildSpec(
    source,
    'counter-ignore-defender',
    { kind: 'self' },
    { asThoughNoAbilities: ['defender'] },
    {
      kind: 'source_counter_at_least',
      amount,
      counterType: String(m[2] || '').trim(),
    } as StaticEffectCondition,
  ));
}

function pushInstantSorcerySpellKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/instant and sorcery spells you control have ([^.]+)/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  // Represent as a player-scoped grant ability marker for census / downstream spell keyword collectors.
  specs.push(buildSpec(
    source,
    'instant-sorcery-spell-keywords',
    { kind: 'player_you' },
    { abilities: abilities.map((a) => `instant_sorcery_spells_have:${a}`) },
  ));
}

function pushMustBeBlockedByExactly(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) must be blocked by exactly (\w+) creatures? if able/,
  );
  if (!m) return;
  const n = countWord(m[1] || '');
  if (n === undefined) return;
  specs.push(buildSpec(
    source,
    `must-be-blocked-by-exactly:${n}`,
    { kind: 'self' },
    { abilities: [`must_be_blocked_by_exactly_${n}`] },
  ));
}

function pushEvenManaBlockLock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/your opponents can(?:not|'t) block with creatures with even mana values/.test(text)) return;
  specs.push(buildSpec(
    source,
    'even-mana-value-block-lock',
    { kind: 'opponent_creatures' },
    { abilities: ["can't block if even mana value"] },
  ));
}

function pushFlankingHaveFlanking(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/other creatures you control with flanking have flanking/.test(text)) return;
  specs.push(buildSpec(
    source,
    'other-flanking-have-flanking',
    { kind: 'other_creatures_you_control', qualifier: { keyword: 'flanking' } },
    { abilities: ['flanking'] },
  ));
}

function pushMultiControlTypeKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  // Tribal Golem: "has trample as long as you control a Beast, haste as long as ..."
  const clauseRe = /(?:^|[.,;]\s*|(?:this creature|~) has\s+|and\s+)([a-z][a-z -]*?) as long as you control an? ([a-z]+)/g;
  let match: RegExpExecArray | null;
  let index = 0;
  const seen = new Set<string>();
  while ((match = clauseRe.exec(text)) !== null) {
    const abilityTail = String(match[1] || '').trim().replace(/^has\s+/, '').replace(/^and\s+/, '');
    const creatureType = String(match[2] || '').trim();
    if (!abilityTail || !creatureType) continue;
    const abilities = parseLordAbilitiesFromTail(abilityTail);
    if (!abilities.length) {
      // "protection from black" is not a single ABILITY_WORDS entry.
      if (/^protection from (white|blue|black|red|green)$/.test(abilityTail)) {
        abilities.push(abilityTail);
      } else {
        continue;
      }
    }
    const key = `${creatureType}:${abilities.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push(buildSpec(
      source,
      `control-type-self-keyword:${creatureType}:${index++}`,
      { kind: 'self' },
      { abilities },
      {
        kind: 'source_controller_controls_matching',
        creatureType,
        creaturesOnly: true,
        count: 1,
      } as StaticEffectCondition,
    ));
  }
}

function pushLandsAreDeserts(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/lands you control(?: and land cards you own that aren'?t on the battlefield)? are deserts in addition to their other types/.test(text)) {
    return;
  }
  specs.push(buildSpec(
    source,
    'lands-you-control-are-deserts',
    { kind: 'lands_you_control' },
    { typeAdditions: ['Desert'] },
  ));
}

function pushNamedCountAnimate(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const name = String(source.sourceName || '').toLowerCase();
  const short = name.split(',')[0].trim();
  const m = text.match(
    /as long as you control (\w+) or more permanents named ([a-z0-9' ,.-]+?), (?:this (?:vehicle|artifact|permanent|creature)|~) is an? artifact creature/,
  );
  if (!m) return;
  const amount = countWord(m[1] || '');
  const named = String(m[2] || '').trim();
  if (amount === undefined || !named) return;
  if (name && named !== name && named !== short) return;
  specs.push(buildSpec(
    source,
    'named-count-animate-artifact-creature',
    { kind: 'self' },
    { typeAdditions: ['Artifact', 'Creature'] },
    {
      kind: 'controller_controls_named_at_least',
      count: amount,
      option: named,
    } as StaticEffectCondition,
  ));
}

export function pushBatch82LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushYourTurnEquippedSelfKeywords(specs, source, oracle);
  pushUntappedNotAttackingAnthem(specs, source, oracle);
  pushShareTypeAttachedPump(specs, source, perm, oracle);
  pushNongreenTargetLock(specs, source, oracle);
  pushCounterIgnoreDefender(specs, source, oracle);
  pushInstantSorcerySpellKeywords(specs, source, oracle);
  pushMustBeBlockedByExactly(specs, source, oracle);
  pushEvenManaBlockLock(specs, source, oracle);
  pushFlankingHaveFlanking(specs, source, oracle);
  pushMultiControlTypeKeywords(specs, source, oracle);
  pushLandsAreDeserts(specs, source, oracle);
  pushNamedCountAnimate(specs, source, oracle);
}
