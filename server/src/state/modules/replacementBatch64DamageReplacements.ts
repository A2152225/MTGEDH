// server/src/state/modules/replacementBatch64DamageReplacements.ts
// B64 damage replacements (Phase 5 depth):
//   Rem Karolus — spell damage prevent to you/another permanent; +1 to opponents
//   Plated Pegasus — spell damage prevent 1 globally
//   Sulfuric Vapors — red spell damage +1
//   Reidane/Valkmira — opponent-source prevent 1 to you or permanent you control
//   Curse of Bloodletting — double damage to enchanted player
//   Sawhorn Nemesis — double damage to chosen player / their permanents
//   Kuja — Wizard you control damage double
//   Thor — another source you control damage +1 to opponents
// Public: collectBatch64DamageReplacementSpecs, damageSourceIsAnySpell.
// Leaf: must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { getRecordedSpellSource, getResolvingSpellSource } from './replacementResolvingSpellSource.js';

type SpecBody = Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;

function typeLineOf(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  const tl: unknown = Reflect.get(card, 'type_line');
  return typeof tl === 'string' ? tl.toLowerCase() : '';
}

/** True when the damage source id is a resolving/stacked/recorded spell (any card type on the stack). */
export function damageSourceIsAnySpell(state: unknown, damageSourceId: string): boolean {
  const id = String(damageSourceId || '').trim();
  if (!id || !state || typeof state !== 'object') return false;
  if (getResolvingSpellSource(state, id) || getRecordedSpellSource(state, id)) return true;
  const stack: unknown = Reflect.get(state, 'stack');
  if (!Array.isArray(stack)) return false;
  for (const item of stack as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const card: unknown = Reflect.get(item, 'card');
    const cardId: unknown = card && typeof card === 'object' ? Reflect.get(card, 'id') : undefined;
    if (String(Reflect.get(item, 'id') || '') === id || String(cardId || '') === id) {
      // Stack items that are spells (not abilities) have a card with a type line.
      return typeLineOf(card).length > 0 && !/\bability\b/i.test(String(Reflect.get(item, 'type') || ''));
    }
  }
  return false;
}

function spellColors(state: unknown, damageSourceId: string): string[] {
  const id = String(damageSourceId || '').trim();
  if (!id || !state || typeof state !== 'object') return [];
  const resolving = getResolvingSpellSource(state, id) || getRecordedSpellSource(state, id);
  if (resolving?.card?.colors && Array.isArray(resolving.card.colors)) {
    return resolving.card.colors.map((c) => String(c).toUpperCase());
  }
  const stack: unknown = Reflect.get(state, 'stack');
  if (!Array.isArray(stack)) return [];
  for (const item of stack as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const card: unknown = Reflect.get(item, 'card');
    const cardId: unknown = card && typeof card === 'object' ? Reflect.get(card, 'id') : undefined;
    if (String(Reflect.get(item, 'id') || '') === id || String(cardId || '') === id) {
      if (card && typeof card === 'object') {
        const colors: unknown = Reflect.get(card, 'colors');
        if (Array.isArray(colors)) return colors.map((c) => String(c).toUpperCase());
      }
    }
  }
  return [];
}

export function readSpellColorsForDamageSource(state: unknown, damageSourceId: string): string[] {
  return spellColors(state, damageSourceId);
}

const TEMPLATES: Array<{ re: RegExp; body: SpecBody }> = [
  {
    // Rem Karolus prevent half
    re: /^if a spell would deal damage to you or another permanent you control, prevent that damage$/,
    body: {
      event: 'damage',
      match: {
        damageSourceIsSpell: true,
        receivingIsYouOrMatchingPermanentYouControl: true,
        receivingPermanentIsNotSource: true,
      },
      instead: { modify: 'cap', value: 0 },
      effectId: 'spell-damage-to-you-or-another-prevent',
      reason: 'spell_damage_to_you_or_another_prevent',
    },
  },
  {
    // Rem Karolus plus-1 half
    re: /^if a spell would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus (\d+) instead$/,
    body: {
      event: 'damage',
      match: {
        damageSourceIsSpell: true,
        receivingPlayerIsOpponentOfSource: true,
      },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'spell-damage-to-opponent-plus-n',
      reason: 'spell_damage_to_opponent_plus_n',
    },
  },
  {
    // Plated Pegasus
    re: /^if a spell would deal damage to a permanent or player, prevent (\d+|one|two|three) damage that spell would deal to that permanent or player$/,
    body: {
      event: 'damage',
      match: { damageSourceIsSpell: true },
      instead: { modify: 'add_flat', value: -1 },
      effectId: 'spell-damage-prevent-n',
      reason: 'spell_damage_prevent_n',
    },
  },
  {
    // Sulfuric Vapors
    re: /^if a red spell would deal damage to a permanent or player, it deals that much damage plus (\d+) to that permanent or player instead$/,
    body: {
      event: 'damage',
      match: {
        damageSourceIsSpell: true,
        damageSourceColorIncludes: 'R',
      },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'red-spell-damage-plus-n',
      reason: 'red_spell_damage_plus_n',
    },
  },
  {
    // Reidane / Valkmira
    re: /^if a source an opponent controls would deal damage to you or a permanent you control, prevent (\d+|one|two|three) of that damage$/,
    body: {
      event: 'damage',
      match: {
        damageSourceControllerIsOpponentOfSource: true,
        receivingIsYouOrMatchingPermanentYouControl: true,
      },
      instead: { modify: 'add_flat', value: -1 },
      effectId: 'opponent-source-damage-to-you-prevent-n',
      reason: 'opponent_source_damage_to_you_prevent_n',
    },
  },
  {
    // Curse of Bloodletting
    re: /^if a source would deal damage to enchanted player, it deals double that damage to that player instead$/,
    body: {
      event: 'damage',
      match: {
        receivingIsPlayerOnly: true,
        receivingPlayerIsEnchantedBySource: true,
      },
      instead: { modify: 'double' },
      effectId: 'enchanted-player-damage-double',
      reason: 'enchanted_player_damage_double',
    },
  },
  {
    // Sawhorn Nemesis
    re: /^if a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead$/,
    body: {
      event: 'damage',
      match: {
        receivingIsChosenPlayerOrTheirPermanent: true,
      },
      instead: { modify: 'double' },
      effectId: 'chosen-player-damage-double',
      reason: 'chosen_player_damage_double',
    },
  },
  {
    // Kuja
    re: /^if a wizard you control would deal damage to a permanent or player, it deals double that damage instead$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        damageSourceHasCreatureType: 'wizard',
      },
      instead: { modify: 'double' },
      effectId: 'wizard-you-control-damage-double',
      reason: 'wizard_you_control_damage_double',
    },
  },
  {
    // Thor
    re: /^if another source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus (\d+) instead$/,
    body: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        receivingPlayerIsOpponentOfSource: true,
        damageSourceIsNotSource: true,
      },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'another-source-you-control-damage-to-opponent-plus-n',
      reason: 'another_source_you_control_damage_to_opponent_plus_n',
    },
  },
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function readAmount(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return Number(raw);
  return NUMBER_WORDS[raw] ?? fallback;
}

/** Parse B64 sentence templates from a self-referenced lowercased sentence (no trailing period). */
export function parseBatch64DamageSentence(sentence: string): SpecBody[] {
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
    if (body.instead?.modify === 'add_flat' && m[1]) {
      const n = readAmount(m[1], Number(body.instead.value) || 1);
      // prevent-N templates use negative flat; plus-N stay positive
      const sign = Number(body.instead.value) < 0 ? -1 : 1;
      body.instead = { modify: 'add_flat', value: sign * Math.abs(n) };
      if (body.effectId?.endsWith('-plus-n')) body.effectId = body.effectId.replace(/-plus-n$/, `-plus-${n}`);
      if (body.effectId?.endsWith('-prevent-n')) body.effectId = body.effectId.replace(/-prevent-n$/, `-prevent-${n}`);
    }
    out.push(body);
  }
  return out;
}

export function collectBatch64DamageReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!text || !/would deal damage|deals that much damage|deals double that damage|prevent \d|prevent one|prevent two|prevent three/i.test(text)) {
    // Still allow ability-worded prevent-all combat lines via sentence parse in prevention module;
    // this collector focuses on amount-modify / spell families.
    if (!/spell would deal|source an opponent|enchanted player|chosen player|wizard you control|another source you control/i.test(text)) {
      return [];
    }
  }
  // Sentence split with ability-word strip (Immune —, Flare Star —).
  const name = String(source.sourceName || '').toLowerCase();
  let normalized = text;
  if (name) normalized = normalized.split(name).join('~');
  const short = name.split(',')[0].trim();
  if (short && short !== name && short.length >= 3) normalized = normalized.split(short).join('~');
  normalized = normalized.replace(/\bthis (?:creature|permanent|artifact|enchantment)\b/g, '~');
  const sentences = normalized
    .split(/(?<=\.)\s+/)
    .map((s) => s.replace(/^[a-z][a-z0-9' !?.+-]*[\u2014\u2013-]\s*/i, '').replace(/\.$/, '').trim())
    .filter(Boolean);

  const specs: ReplacementEffectSpec[] = [];
  for (const sentence of sentences) {
    for (const body of parseBatch64DamageSentence(sentence)) {
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
