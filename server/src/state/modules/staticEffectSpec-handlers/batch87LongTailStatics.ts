// server/src/state/modules/staticEffectSpec-handlers/batch87LongTailStatics.ts
// B87 static long-tail:
//   Gruul Spellbreaker — during your turn, you and ~ have keywords
//   Inspiring Paladin — during your turn, creatures you control with counters have keywords
//   Coppercoat Vanguard — each other TYPE you control get ±N/±N and have ward/{kw}
//   Blacksmith's Talent — during your turn, equipped creatures you control have keywords
//   Divine Sacrament threshold — COLOR creatures get an additional ±N/±N at threshold
//   Artifact Ward — enchanted can't be target of abilities from artifact sources
//   Doctor Doom — keywords while you control an artifact creature or a Plan
//   Hundred-Battle Veteran — pump while N+ distinct counter kinds among your creatures
//   Gimli — indestructible while N+ creatures died under your control this turn
//   Haktos — protection from each mana value other than the chosen number
//   Marble Priest — all Walls able to block ~ do so
//   Futurist Operative — while tapped: set types/P/T + unblockable
// Public: pushBatch87LongTailStaticSpecs.
// Sibling: Bloodcrazed/Lumberknot via selfCombatConditions; Ratonh via selfStateGrants;
//   Wildsear cascade; Absorbing Man via replacementBatch65; Upriser/Frogantua/Opaline/Bearded via countedPT.

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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function singularType(raw: string): string {
  let n = String(raw || '').toLowerCase().trim();
  if (n.endsWith('ies')) n = `${n.slice(0, -3)}y`;
  else if (n.endsWith('s') && !n.endsWith('ss')) n = n.slice(0, -1);
  return n;
}

function pushYouAndSelfDuringTurnKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/during your turn, you and (?:this creature|~|[a-z' ,.-]+?) have ([^.]+)/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  const cond = { kind: 'during_source_controller_turn' } as StaticEffectCondition;
  specs.push(buildSpec(source, 'you-during-turn-keywords', { kind: 'player_you' }, { abilities }, cond));
  specs.push(buildSpec(source, 'self-during-turn-keywords', { kind: 'self' }, { abilities }, cond));
}

function pushCounterCreaturesDuringTurnKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /during your turn, creatures you control with ([+\-\d/a-z]+) counters? on them have ([^.]+)/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[2] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'counter-creatures-during-turn-keywords',
    { kind: 'creatures_you_control' },
    { abilities },
  ));
  const last = specs[specs.length - 1];
  last.conditions = [
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
    { kind: 'target_has_counter', counterType: String(m[1] || '').trim() } as StaticEffectCondition,
  ];
}

function pushOtherTypeAnthemWard(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each other ([a-z]+) you control gets ([+-]\d+\s*\/\s*[+-]\d+) and has ([^.]+)/,
  );
  if (!m) return;
  const creatureType = cap(singularType(m[1] || ''));
  const buff = parseBuffSegment(m[2] || '');
  let abilities = parseLordAbilitiesFromTail(m[3] || '');
  const ward = /\bward\s*((?:\{[^}]+\})+)/i.exec(m[3] || '');
  if (ward) abilities = abilities.map((a) => (a === 'ward' ? `ward ${ward[1].toLowerCase()}` : a));
  if (!creatureType || !buff) return;
  specs.push(buildSpec(
    source,
    `other-type-anthem-ward:${creatureType.toLowerCase()}`,
    { kind: 'other_creatures_you_control', creatureType },
    { power: buff.power, toughness: buff.toughness, ...(abilities.length ? { abilities } : {}) },
  ));
}

function pushEquippedDuringTurnKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/during your turn, equipped creatures you control have ([^.]+)/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'equipped-during-turn-keywords',
    { kind: 'creatures_you_control' },
    { abilities },
  ));
  const last = specs[specs.length - 1];
  last.conditions = [
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
    { kind: 'target_is_equipped' } as StaticEffectCondition,
  ];
}

function pushColorAdditionalThresholdAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(white|blue|black|red|green) creatures get an additional ([+-]\d+\s*\/\s*[+-]\d+) as long as there are (\w+) or more cards in your graveyard/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[2] || '');
  const amount = countWord(m[3] || '');
  if (!buff || amount === undefined) return;
  specs.push(buildSpec(
    source,
    `color-additional-threshold-anthem:${m[1]}`,
    { kind: 'all_creatures' },
    { power: buff.power, toughness: buff.toughness },
  ));
  const last = specs[specs.length - 1];
  last.conditions = [
    { kind: 'target_has_mana_color', color: m[1] } as StaticEffectCondition,
    amount === 7
      ? { kind: 'source_controller_has_threshold' } as StaticEffectCondition
      : { kind: 'source_controller_graveyard_at_least', amount } as StaticEffectCondition,
  ];
}

function pushEnchantedArtifactAbilityHexproof(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/enchanted creature can(?:'t|not) be the target of abilities from artifact sources/.test(text)) return;
  specs.push({
    ...buildSpec(
      source,
      'enchanted-artifact-ability-hexproof',
      { kind: 'self' },
      { abilities: ["can't be the target of abilities from artifact sources"] },
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushControlArtifactCreatureOrPlanKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as you control an? artifact creature or an? ([a-z]+), (?:this creature|~|[a-z' ,.-]+?) has ([^.]+)/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[2] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'control-artifact-creature-or-subtype-keywords',
    { kind: 'self' },
    { abilities },
    {
      kind: 'source_controller_controls_artifact_creature_or_subtype',
      creatureType: singularType(m[1] || ''),
    } as StaticEffectCondition,
  ));
}

function pushDistinctCounterKindsPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as there are (\w+) or more different kinds of counters among creatures you control, (?:this creature|~) gets ([+-]\d+\s*\/\s*[+-]\d+)/,
  );
  if (!m) return;
  const amount = countWord(m[1] || '');
  const buff = parseBuffSegment(m[2] || '');
  if (amount === undefined || !buff) return;
  specs.push(buildSpec(
    source,
    'distinct-counter-kinds-pump',
    { kind: 'self' },
    { power: buff.power, toughness: buff.toughness },
    {
      kind: 'controller_creatures_distinct_counter_kinds_at_least',
      amount,
    } as StaticEffectCondition,
  ));
}

function pushCreaturesDiedIndestructible(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z' ,.-]+?) has indestructible as long as (\w+) or more creatures died under your control this turn/,
  );
  if (!m) return;
  const amount = countWord(m[1] || '');
  if (amount === undefined) return;
  specs.push(buildSpec(
    source,
    'creatures-died-indestructible',
    { kind: 'self' },
    { abilities: ['indestructible'] },
    {
      kind: 'source_controller_creatures_died_this_turn_at_least',
      amount,
    } as StaticEffectCondition,
  ));
}

function pushProtectionFromOtherManaValues(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:this creature|~|[a-z' ,.-]+?) has protection from each mana value other than the chosen number/.test(text)) {
    return;
  }
  const chosen = Number((perm as any)?.chosenNumber ?? (perm as any)?.card?.chosenNumber);
  if (!Number.isFinite(chosen)) return;
  const abilities: string[] = [];
  for (let mv = 0; mv <= 16; mv += 1) {
    if (mv === chosen) continue;
    abilities.push(`protection from mana value ${mv}`);
  }
  specs.push(buildSpec(
    source,
    'protection-from-other-mana-values',
    { kind: 'self' },
    { abilities },
  ));
}

function pushWallsMustBlock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/all walls able to block (?:this creature|~) do so/.test(text)) return;
  specs.push(buildSpec(
    source,
    'walls-must-block',
    { kind: 'self' },
    { abilities: ['all Walls able to block this creature do so'] },
  ));
}

function pushTappedAnimateUnblockable(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as (?:this creature|~|it) is tapped, it'?s an? ([a-z ]+?) with base power and toughness (\d+)\s*\/\s*(\d+) and can(?:'t|not) be blocked/,
  );
  if (!m) return;
  const subtypes = String(m[1] || '').trim().split(/\s+/).filter(Boolean).map(cap);
  specs.push(buildSpec(
    source,
    'tapped-animate-unblockable',
    { kind: 'self' },
    {
      typeAdditions: subtypes,
      loseOtherCreatureTypes: true,
      setPower: Number(m[2]),
      setToughness: Number(m[3]),
      abilities: ["can't be blocked"],
    },
    { kind: 'target_is_tapped' } as StaticEffectCondition,
  ));
}

export function pushBatch87LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushYouAndSelfDuringTurnKeywords(specs, source, oracle);
  pushCounterCreaturesDuringTurnKeywords(specs, source, oracle);
  pushOtherTypeAnthemWard(specs, source, oracle);
  pushEquippedDuringTurnKeywords(specs, source, oracle);
  pushColorAdditionalThresholdAnthem(specs, source, oracle);
  pushEnchantedArtifactAbilityHexproof(specs, source, perm, oracle);
  pushControlArtifactCreatureOrPlanKeywords(specs, source, oracle);
  pushDistinctCounterKindsPump(specs, source, oracle);
  pushCreaturesDiedIndestructible(specs, source, oracle);
  pushProtectionFromOtherManaValues(specs, source, perm, oracle);
  pushWallsMustBlock(specs, source, oracle);
  pushTappedAnimateUnblockable(specs, source, oracle);
}
