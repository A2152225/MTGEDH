// server/src/state/modules/replacementBatch65DamageReplacements.ts
// B65/B86 damage replacements:
//   Akki Lavarunner // Tok-Tok — red source damage to a player +1
//   Raphael, the Muscle — double damage from creatures you control with counters
//   B86 Wolverine — double all damage ~ would deal
//   B86 Collective Inferno — double damage from sources you control of the chosen type
// Public: collectBatch65DamageReplacementSpecs, parseBatch65DamageSentence.
// Leaf: must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

type SpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

const TEMPLATES: Array<{ re: RegExp; body: SpecBody }> = [
  {
    re: /^if a red source would deal damage to a player, it deals that much damage plus (\d+) to that player instead$/,
    body: {
      event: 'damage',
      match: {
        receivingIsPlayerOnly: true,
        damageSourceColorIncludes: 'R',
      },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'red-source-damage-to-player-plus-n',
      reason: 'red_source_damage_to_player_plus_n',
    },
  },
  {
    re: /^double all damage that creatures you control with counters on them would deal$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceIsCreature: true,
        damageSourceHasAnyCounter: true,
      },
      instead: { modify: 'double' },
      effectId: 'creatures-you-control-with-counters-damage-double',
      reason: 'creatures_you_control_with_counters_damage_double',
    },
  },
  {
    // B86: Wolverine — after name→~ normalize: "double all damage ~ would deal".
    re: /^double all damage (?:~|this creature) would deal$/,
    body: {
      event: 'damage',
      match: { damageSourceIsSource: true },
      instead: { modify: 'double' },
      effectId: 'source-damage-double',
      reason: 'source_damage_double',
    },
  },
  {
    // B87: Absorbing Man and Titania.
    re: /^double all damage that creature sources you control would deal$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceIsCreature: true,
      },
      instead: { modify: 'double' },
      effectId: 'creature-sources-you-control-damage-double',
      reason: 'creature_sources_you_control_damage_double',
    },
  },
];

export function parseBatch65DamageSentence(sentence: string): SpecBody[] {
  const s = String(sentence || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/\.$/, '');
  const out: SpecBody[] = [];
  for (const t of TEMPLATES) {
    const m = s.match(t.re);
    if (!m) continue;
    const body: SpecBody = {
      ...t.body,
      match: { ...(t.body.match || {}) },
      instead: { ...(t.body.instead || {}) },
    };
    if (body.instead?.modify === 'add_flat' && m[1] && /^\d+$/.test(m[1])) {
      body.instead = { modify: 'add_flat', value: Number(m[1]) };
      if (body.effectId?.endsWith('-plus-n')) {
        body.effectId = body.effectId.replace(/-plus-n$/, `-plus-${m[1]}`);
      }
    }
    out.push(body);
  }
  return out;
}

export function collectBatch65DamageReplacementSpecs(
  oracle: string,
  source: {
    sourcePermanentId: string;
    sourceController: string;
    sourceName: string;
    chosenCreatureType?: string;
  },
): ReplacementEffectSpec[] {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!text) return [];
  if (!/red source would deal damage|double all damage/i.test(text)) {
    return [];
  }
  const name = String(source.sourceName || '').toLowerCase();
  let normalized = text;
  if (name) {
    normalized = normalized.split(name).join('~');
    // B86: Wolverine oracle uses the short name while sourceName is the full legendary name.
    const short = name.split(',')[0].trim();
    if (short && short !== name) normalized = normalized.split(short).join('~');
  }
  const sentences = normalized
    .split(/(?<=\.)\s+/)
    .map((s) => s.replace(/^[a-z][a-z0-9' !?.+-]*[\u2014\u2013-]\s*/i, '').replace(/\.$/, '').trim())
    .filter(Boolean);
  const specs: ReplacementEffectSpec[] = [];
  for (const sentence of sentences) {
    for (const body of parseBatch65DamageSentence(sentence)) {
      specs.push({
        ...body,
        id: `${source.sourcePermanentId}:${body.effectId}`,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
      });
    }
    // B86: Collective Inferno — chosen type baked from permanent at collect time.
    const chosen = sentence.match(
      /^double all damage that sources you control of the chosen type would deal$/,
    );
    if (chosen) {
      const type = String(source.chosenCreatureType || '').trim();
      if (type) {
        specs.push({
          event: 'damage',
          match: {
            dealingPlayerIsSourceController: true,
            damageSourceHasCreatureType: type.toLowerCase(),
          },
          instead: { modify: 'double' },
          effectId: `chosen-type-sources-damage-double:${type.toLowerCase()}`,
          reason: 'chosen_type_sources_damage_double',
          id: `${source.sourcePermanentId}:chosen-type-sources-damage-double`,
          sourcePermanentId: source.sourcePermanentId,
          sourceController: source.sourceController,
          sourceName: source.sourceName,
        });
      }
    }
  }
  return specs;
}
