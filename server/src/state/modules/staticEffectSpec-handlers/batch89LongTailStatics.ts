// server/src/state/modules/staticEffectSpec-handlers/batch89LongTailStatics.ts
// B89 static long-tail:
//   The Muckslinger Gang — other creatures +N/+N as long as not attacking or blocking
//   Halvar, God of Battle — enchanted or equipped creatures have double strike
//   Agent Frank Horrigan — indestructible as long as it attacked this turn
//   Toby, Beastie Befriender — creature tokens have flying if you control N+ creature tokens
//   Graaz, Unstoppable Juggernaut — Juggernauts attack if able / can't be blocked by Walls /
//     other creatures base P/T and are Juggernauts
// Public: pushBatch89LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
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

function pushOtherNotAttackingOrBlockingAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each other creatures? you control get[s]? ([+-]\d+\s*\/\s*[+-]\d+) as long as (?:it'?s|it is) not attacking or blocking/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const spec = buildSpec(
    source,
    'other-not-attacking-or-blocking-anthem',
    { kind: 'other_creatures_you_control' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_is_attacking_or_blocking' } as StaticEffectCondition,
  );
  spec.conditionNegated = true;
  specs.push(spec);
}

function pushEnchantedOrEquippedKeyword(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /creatures you control that are enchanted or equipped have ([a-z][a-z '-]+?)(?:\.|$)/,
  );
  if (!m) return;
  const ability = String(m[1] || '').trim().replace(/\.$/, '');
  if (!ability) return;
  specs.push(buildSpec(
    source,
    `enchanted-or-equipped-keyword:${ability}`,
    { kind: 'creatures_you_control' },
    { abilities: [ability] },
    { kind: 'target_is_enchanted_or_equipped' } as StaticEffectCondition,
  ));
}

function pushAttackedThisTurnKeyword(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z' ,.-]+?) has ([a-z][a-z '-]+?) as long as it attacked this turn/,
  );
  if (!m) return;
  const ability = String(m[1] || '').trim();
  if (!ability) return;
  specs.push(buildSpec(
    source,
    `attacked-this-turn-keyword:${ability}`,
    { kind: 'self' },
    { abilities: [ability] },
    { kind: 'target_attacked_this_turn' } as StaticEffectCondition,
  ));
}

function pushCreatureTokenThresholdKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as you control (\w+) or more creature tokens, creature tokens you control have ([a-z][a-z ,'-]+?)(?:\.|$)/,
  );
  if (!m) return;
  const n = countWord(m[1] || '');
  if (n === undefined) return;
  const ability = String(m[2] || '').trim().replace(/\.$/, '');
  if (!ability) return;
  specs.push(buildSpec(
    source,
    `creature-token-threshold-keywords:${n}`,
    { kind: 'creatures_you_control' },
    { abilities: [ability] },
    undefined,
  ));
  const spec = specs[specs.length - 1];
  spec.condition = { kind: 'target_is_token' } as StaticEffectCondition;
  spec.conditions = [
    { kind: 'target_is_token' } as StaticEffectCondition,
    { kind: 'controller_creature_token_count_at_least', amount: n } as StaticEffectCondition,
  ];
}

function pushTypedAttackAndWallEvasionAndBasePt(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const attack = text.match(/([a-z]+)s you control attack each combat if able/);
  if (attack) {
    const creatureType = cap(singularType(attack[1] || ''));
    if (creatureType && isCreatureTypeWord(creatureType)) {
      specs.push(buildSpec(
        source,
        `type-attack-if-able:${creatureType.toLowerCase()}`,
        { kind: 'creatures_you_control', creatureType },
        { abilities: ['attacks each combat if able'] },
      ));
    }
  }
  const walls = text.match(/([a-z]+)s you control can(?:not|'t) be blocked by walls/);
  if (walls) {
    const creatureType = cap(singularType(walls[1] || ''));
    if (creatureType && isCreatureTypeWord(creatureType)) {
      specs.push(buildSpec(
        source,
        `type-cant-be-blocked-by-walls:${creatureType.toLowerCase()}`,
        { kind: 'creatures_you_control', creatureType },
        { abilities: ["can't be blocked by Walls"] },
      ));
    }
  }
}

export function pushBatch89LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushOtherNotAttackingOrBlockingAnthem(specs, source, oracle);
  pushEnchantedOrEquippedKeyword(specs, source, oracle);
  pushAttackedThisTurnKeyword(specs, source, oracle);
  pushCreatureTokenThresholdKeywords(specs, source, oracle);
  pushTypedAttackAndWallEvasionAndBasePt(specs, source, oracle);
}
