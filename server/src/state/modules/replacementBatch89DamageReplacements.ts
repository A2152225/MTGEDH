// server/src/state/modules/replacementBatch89DamageReplacements.ts
// B89 damage replacements (Commander-relevant long tail):
//   Fiendish Duo — double damage to an opponent
//   Calamity Bearer — Giant source you control doubles
//   Pyromancer's Swath — instant or sorcery source +2
//   Tor Wauki the Younger — another source you control noncombat +1
//   Ghosts of the Innocent — half damage, rounded down
//   Benevolent Unicorn — spell damage minus 1
//   Djeru, With Eyes Open — prevent 1 to a planeswalker you control
//   Disciples of the Inferno — noncreature source to creature, battle, or opponent +2
//   Obosh, the Preypiercer — odd mana-value source you control doubles
//   Inquisitor's Flail — equipped creature combat damage doubles both ways
// Public: collectBatch89DamageReplacementSpecs, parseBatch89DamageSentence.
// Leaf: must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

type SpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

const TEMPLATES: Array<{ re: RegExp; body: SpecBody }> = [
  {
    re: /^if a source would deal damage to an opponent, it deals double that damage to that player instead$/,
    body: {
      event: 'damage',
      match: {
        receivingPlayerIsOpponentOfSource: true,
        receivingIsPlayerOnly: true,
      },
      instead: { modify: 'double' },
      effectId: 'damage-to-opponent-double',
      reason: 'damage_to_opponent_double',
    },
  },
  {
    re: /^if an? ([a-z]+) source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceHasCreatureType: 'giant',
      },
      instead: { modify: 'double' },
      effectId: 'type-source-you-control-damage-double',
      reason: 'type_source_you_control_damage_double',
    },
  },
  {
    re: /^if an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus (\d+) to that permanent or player instead$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceIsInstantOrSorcerySpell: true,
      },
      instead: { modify: 'add_flat', value: 2 },
      effectId: 'instant-sorcery-source-damage-plus-n',
      reason: 'instant_sorcery_source_damage_plus_n',
    },
  },
  {
    re: /^if another source you control would deal noncombat damage to a permanent or player, it deals that much damage plus (\d+) to that permanent or player instead$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceIsNotSource: true,
        noncombatDamageOnly: true,
      },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'another-source-you-control-noncombat-plus-n',
      reason: 'another_source_you_control_noncombat_plus_n',
    },
  },
  {
    re: /^if a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead$/,
    body: {
      event: 'damage',
      match: {},
      instead: { modify: 'halve' },
      effectId: 'all-damage-halve',
      reason: 'all_damage_halve',
    },
  },
  {
    re: /^if a spell would deal damage to a permanent or player, it deals that much damage minus (\d+) to that permanent or player instead$/,
    body: {
      event: 'damage',
      match: { damageSourceIsSpell: true },
      instead: { modify: 'add_flat', value: -1 },
      effectId: 'spell-damage-minus-n',
      reason: 'spell_damage_minus_n',
    },
  },
  {
    re: /^if a source would deal damage to a planeswalker you control, prevent (\d+|one|two|three) of that damage$/,
    body: {
      event: 'damage',
      match: {
        receivingPermanentControllerIsSourceController: true,
        receivingPermanentTypeIncludesAll: ['planeswalker'],
      },
      instead: { modify: 'add_flat', value: -1 },
      effectId: 'damage-to-planeswalker-you-control-prevent-n',
      reason: 'damage_to_planeswalker_you_control_prevent_n',
    },
  },
  {
    re: /^if a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus (\d+) instead$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceIsNoncreature: true,
        receivingIsCreatureBattleOrOpponent: true,
      },
      instead: { modify: 'add_flat', value: 2 },
      effectId: 'noncreature-source-to-creature-battle-or-opponent-plus-n',
      reason: 'noncreature_source_to_creature_battle_or_opponent_plus_n',
    },
  },
  {
    re: /^if a source you control with an odd mana value would deal damage to a permanent or player, it deals double that damage to that permanent or player instead$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceHasOddManaValue: true,
      },
      instead: { modify: 'double' },
      effectId: 'odd-mana-value-source-you-control-damage-double',
      reason: 'odd_mana_value_source_you_control_damage_double',
    },
  },
  {
    re: /^if equipped creature would deal combat damage, it deals double that damage instead$/,
    body: {
      event: 'damage',
      match: {
        combatDamageOnly: true,
        damageSourceIsEquippedBySource: true,
      },
      instead: { modify: 'double' },
      effectId: 'equipped-creature-combat-damage-double',
      reason: 'equipped_creature_combat_damage_double',
    },
  },
  {
    re: /^if another creature would deal combat damage to equipped creature, it deals double that damage to equipped creature instead$/,
    body: {
      event: 'damage',
      match: {
        combatDamageOnly: true,
        damageSourceIsCreature: true,
        damageSourceIsNotSource: true,
        receivingPermanentIsEquippedBySource: true,
      },
      instead: { modify: 'double' },
      effectId: 'combat-damage-to-equipped-creature-double',
      reason: 'combat_damage_to_equipped_creature_double',
    },
  },
];

function parseWordOrNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const w = String(raw).toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  return words[w] ?? fallback;
}

export function parseBatch89DamageSentence(sentence: string): SpecBody[] {
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
    const typeWord = t.re.source.includes('([a-z]+) source you control') ? m[1] : undefined;
    if (typeWord && body.match) {
      body.match = { ...body.match, damageSourceHasCreatureType: typeWord.toLowerCase() };
      body.effectId = `type-source-you-control-damage-double:${typeWord.toLowerCase()}`;
    }
    if (body.instead?.modify === 'add_flat') {
      const captured = m[m.length - 1];
      if (captured && captured !== typeWord) {
        const sign = Number(body.instead.value || 0) < 0 ? -1 : 1;
        const n = parseWordOrNumber(captured, Math.abs(Number(body.instead.value || 0)));
        body.instead = { modify: 'add_flat', value: sign * n };
        if (body.effectId?.endsWith('-plus-n')) {
          body.effectId = body.effectId.replace(/-plus-n$/, `-plus-${n}`);
        }
        if (body.effectId?.endsWith('-minus-n')) {
          body.effectId = body.effectId.replace(/-minus-n$/, `-minus-${n}`);
        }
        if (body.effectId?.endsWith('-prevent-n')) {
          body.effectId = body.effectId.replace(/-prevent-n$/, `-prevent-${n}`);
        }
      }
    }
    out.push(body);
  }
  return out;
}

export function collectBatch89DamageReplacementSpecs(
  oracle: string,
  source: {
    sourcePermanentId: string;
    sourceController: string;
    sourceName: string;
  },
): ReplacementEffectSpec[] {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!text) return [];
  if (!/would deal damage|deals double that damage|deals half that damage|deals that much damage/i.test(text)) {
    return [];
  }
  const name = String(source.sourceName || '').toLowerCase();
  let normalized = text;
  if (name) {
    normalized = normalized.split(name).join('~');
    const short = name.split(',')[0].trim();
    if (short && short !== name) normalized = normalized.split(short).join('~');
  }
  const sentences = normalized
    .split(/(?<=\.)\s+/)
    .map((s) => s.replace(/^[a-z][a-z0-9' !?.+-]*[\u2014\u2013-]\s*/i, '').replace(/\.$/, '').trim())
    .filter(Boolean);
  const specs: ReplacementEffectSpec[] = [];
  for (const sentence of sentences) {
    for (const body of parseBatch89DamageSentence(sentence)) {
      specs.push({
        ...body,
        id: `${source.sourcePermanentId}:${body.effectId}`,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
      });
    }
  }
  return specs;
}
