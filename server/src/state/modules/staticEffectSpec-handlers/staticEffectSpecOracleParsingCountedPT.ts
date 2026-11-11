// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingCountedPT.ts
// Census P/T families the older readers miss:
//   "This creature gets +1/+0 for each artifact you control." (Nim Lasher), "... for each Aura attached to it"
//   (Kor Spiritdancer), "... for each oil counter on it" (Necrosquito), "... for each card in your hand" (Dread Slag),
//   "... for each creature card in your graveyard" (Fiend Artisan);
//   "Enchanted/Equipped creature gets +1/+1 for each creature you control" (Pennon Blade), "... for each Aura and
//   Equipment attached to it" (Strong Back); and attached penalties the positive-only legacy reader skips:
//   "Enchanted creature gets -5/-0 and loses all abilities." (Quantum Reduction, Fresh Start, Duskmourn's Domination).
// Attached lines the legacy attached P/T reader (ptAttachedBonusParseHelpers) already applies are skipped.
// Public entry symbols: pushCountedAndAttachedPTSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseLordAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseR36CountGrant } from '../staticEffectSpecR36CountBases.js';
import {
  parseStaticAttachedPTBonusFromOracle,
  resolveAttachedPTBonusFromOracle,
} from '../../utils-handlers/ptAttachedBonusParseHelpers.js';

const CARD_TYPES = ['artifact', 'creature', 'land', 'enchantment', 'planeswalker'];
/** "Mountain you control" (Earth Servant); the count reads effective land types (Evil Presence, Blood Moon). */
const LAND_SUBTYPE_YOU_CONTROL_RE = /^(plains|island|swamp|mountain|forest|desert|gate|cave|town|sphere|locus|lair|mine|tower)(?:e?s)? you control$/;

function countGrant(phrase: string): Partial<StaticEffectGrant> | null {
  const p = phrase.trim();
  const r36 = parseR36CountGrant(p);
  if (r36) return r36;
  let m = p.match(/^(other )?(artifact|creature|land|enchantment|planeswalker) you control$/);
  if (m) return { countBasis: 'controller_permanents_of_type', countCardType: m[2], ...(m[1] ? { countExcludeSource: true } : {}) };
  // "for each legendary creature you control" (Benalish Honor Guard), "nontoken creature", "white creature".
  m = p.match(/^(other )?((?:(?:legendary|nontoken|token|white|blue|black|red|green) )+)(artifact|creature|land|enchantment|planeswalker|permanent) you control$/);
  if (m) {
    const adjs = m[2].trim().split(/\s+/); const letters: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    const q: Record<string, unknown> = {};
    if (adjs.includes('legendary')) q.legendary = true;
    if (adjs.includes('nontoken')) q.token = false; else if (adjs.includes('token')) q.token = true;
    const colors = adjs.filter((a) => letters[a]).map((a) => letters[a]); if (colors.length) q.colors = colors;
    return { countBasis: 'controller_permanents_of_type', countCardType: m[3] === 'permanent' ? '' : m[3], countQualifier: q, ...(m[1] ? { countExcludeSource: true } : {}) };
  }
  if (p === 'opponent whose life total is less than half their starting life total') return { countBasis: 'opponents_below_half_starting_life' as any };
  if (p === 'transformed permanent you control') return { countBasis: 'controller_permanents_of_type', countCardType: '', countQualifier: { transformed: true } };
  // "for each artifact and/or enchantment you control" (Nettlecyst).
  // B83: Born to Drive — "creature and/or Vehicle you control".
  m = p.match(/^(artifact|creature|land|enchantment|planeswalker|vehicle) (?:and ?\/or|or) (artifact|creature|land|enchantment|planeswalker|vehicle) you control$/);
  if (m) return { countBasis: 'controller_permanents_of_type', countCardType: `(?:${m[1]}|${m[2]})` };
  m = p.match(/^([a-z]+) counters? (you|your opponents) have$/);
  if (m) return { countBasis: 'player_counters', countCounterType: m[1], countWho: m[2] === 'you' ? 'you' : 'opponents' };
  m = p.match(/^(other )?creature on the battlefield with ([a-z ]+)$/);
  if (m) return { countBasis: 'creatures_with_keyword', countKeyword: m[2], ...(m[1] ? { countExcludeSource: true } : {}) };
  // B82: Skycat Sovereign — "other creature you control with flying"
  m = p.match(/^(other )?creatures? you control with ([a-z ]+)$/);
  if (m) {
    return {
      countBasis: 'creatures_with_keyword',
      countKeyword: m[2],
      countWho: 'you',
      ...(m[1] ? { countExcludeSource: true } : {}),
    };
  }
  // B82: Winter — "creature and planeswalker card in your graveyard"
  if (/^creature and planeswalker cards? in your graveyard$/.test(p)) {
    return { countBasis: 'controller_graveyard_cards_of_type', countCardType: 'creature_or_planeswalker' };
  }
  // B82: Death's Approach / Bonehoard — creature cards in its controller's / all graveyards
  if (/^creature cards? in its controller'?s graveyard$/.test(p)) {
    return { countBasis: 'host_controller_graveyard_cards_of_type', countCardType: 'creature' };
  }
  if (/^creature cards? in all graveyards$/.test(p)) {
    return { countBasis: 'controller_graveyard_cards_of_type', countCardType: 'creature', countWho: 'all' };
  }
  // B82: Sword of the Squeak — creatures you control with base power or toughness N
  m = p.match(/^creatures? you control with base power or toughness (\d+)$/);
  if (m) {
    return {
      countBasis: 'controller_creatures_with_base_power_or_toughness',
      countCardType: m[1],
    };
  }
  // B80: Winter Soldier — "Equipment attached to him/her/them".
  m = p.match(/^(aura|equipment)(?: and (aura|equipment))? attached to (?:it|this creature|him|her|them)$/);
  if (m) return { countBasis: 'attachments_on_source', countAttachmentKinds: [m[1], m[2]].filter(Boolean) as string[] };
  if (p === 'card in your hand') return { countBasis: 'controller_hand_size' };
  // B81: Enemy of Enlightenment — cards in opponents' hands.
  if (/^cards? in your opponents'? hands?$/.test(p)) return { countBasis: 'controller_hand_size', countWho: 'opponents' };
  // B81: Faeburrow Elder — colors among permanents you control.
  if (p === 'color among permanents you control') return { countBasis: 'controller_colors_among_permanents' };
  // B81: Gleam of Authority — +1/+1 counters on other creatures you control.
  m = p.match(/^([+\-\d/a-z]+) counters? on other creatures you control$/);
  if (m) return { countBasis: 'counters_on_other_creatures_you_control', countCounterType: m[1], countExcludeSource: true };
  // R34: "for each creature your opponents control" (Scourge of Geier Reach).
  m = p.match(/^(artifact|creature|land|enchantment|planeswalker|permanent) (?:your opponents control|an opponent controls)$/);
  if (m) return { countBasis: 'controller_permanents_of_type', countCardType: m[1] === 'permanent' ? '' : m[1], countWho: 'opponents' };
  // R34: "for each Lesson card in your graveyard" (Katara): subtype/supertype word on the type line.
  // B70: Xande — "for each noncreature, nonland card in your graveyard"
  if (/^noncreature,? nonland cards? in your graveyard$/.test(p)) {
    return { countBasis: 'controller_graveyard_cards_of_type', countCardType: 'noncreature_nonland' };
  }
  // B83: Song of Stupefaction — permanent cards in your graveyard.
  if (/^permanent cards? in your graveyard$/.test(p)) {
    return { countBasis: 'controller_graveyard_cards_of_type', countCardType: 'permanent' };
  }
  // B85: Runaway Trash-Bot — artifact and/or enchantment cards in your graveyard.
  if (/^artifact and\/or enchantment cards? in your graveyard$/.test(p)
    || /^enchantment and\/or artifact cards? in your graveyard$/.test(p)) {
    return { countBasis: 'controller_graveyard_cards_of_type', countCardType: 'artifact_or_enchantment' };
  }
  // B85: Earthen Ally — colors among Allies you control.
  {
    const colorsAmong = p.match(/^colors? among ([a-z]+) you control$/);
    if (colorsAmong) {
      let sub = String(colorsAmong[1] || '').toLowerCase();
      if (sub.endsWith('ies')) sub = `${sub.slice(0, -3)}y`;
      else if (sub.endsWith('s') && !sub.endsWith('ss')) sub = sub.slice(0, -1);
      return {
        countBasis: 'controller_colors_among_creature_type',
        countCardType: sub,
      };
    }
  }
  m = p.match(/^([a-z]+) cards? in your graveyard$/);
  if (m && !/^(?:other|nonland|noncreature)$/.test(m[1])) return { countBasis: 'controller_graveyard_cards_of_type', countCardType: m[1] };
  m = p.match(LAND_SUBTYPE_YOU_CONTROL_RE);
  if (m) return { countBasis: 'controller_lands_of_subtype', countCardType: m[1] };
  if (p === 'basic land type among lands you control') return { countBasis: 'controller_basic_land_types' };
  // Creature/artifact subtypes ("other Rat you control", "Equipment you control"): word-bounded type-line match.
  // R32: "for each Officer token you control" (Academy Instructor): subtype tokens.
  m = p.match(/^(other )?([a-z]+) token you control$/);
  if (m && m[2] !== 'creature') return { countBasis: 'controller_permanents_of_type', countCardType: m[2], countQualifier: { token: true }, ...(m[1] ? { countExcludeSource: true } : {}) };
  m = p.match(/^(other )?([a-z]+) you control$/);
  if (m && !/^(card|permanent|token|spell|nonland|other)$/.test(m[2])) {
    return { countBasis: 'controller_permanents_of_type', countCardType: m[2], ...(m[1] ? { countExcludeSource: true } : {}) };
  }
  m = p.match(/^(?:(artifact|creature|land|enchantment|planeswalker) )?card in your graveyard$/);
  if (m) return { countBasis: 'controller_graveyard_cards_of_type', countCardType: m[1] && CARD_TYPES.includes(m[1]) ? m[1] : '' };
  // R35: untyped counters (Gavel of the Righteous, Luxior), host controller's hand, host colours, named creatures.
  if (/^counter on (?:~|this (?:equipment|aura|artifact|enchantment))$/.test(p)) return { countBasis: 'source_counters', countCounterType: '', countOnEffectSource: true };
  if (p === 'counter on it' || p === 'counter on this creature') return { countBasis: 'source_counters', countCounterType: '' };
  if (p === "card in its controller's hand") return { countBasis: 'host_controller_hand_size' };
  if (p === 'of its colors') return { countBasis: 'host_color_count' };
  m = p.match(/^(other )?creature on the battlefield named ([a-z' ,-]+)$/);
  if (m) return { countBasis: 'creatures_named', countName: m[2].trim(), ...(m[1] ? { countExcludeSource: true } : {}) };
  m = p.match(/^([a-z+\/0-9-]+) counter on (?:~|this (?:equipment|aura|artifact|enchantment))$/);
  if (m) return { countBasis: 'source_counters', countCounterType: m[1], countOnEffectSource: true };
  m = p.match(/^([a-z+\/0-9-]+) counter on (?:it|this creature)$/);
  if (m) return { countBasis: 'source_counters', countCounterType: m[1] };
  // B83: Emissary Escort — greatest mana value among other artifacts you control.
  m = p.match(/^the greatest mana value among (other )?(artifacts?|creatures?|permanents?|enchantments?) you control$/);
  if (m) {
    const noun = m[2].replace(/s$/, '');
    return {
      countBasis: 'greatest_mana_value_among_controller_permanents',
      countCardType: noun === 'permanent' ? '' : noun,
      ...(m[1] ? { countExcludeSource: true } : {}),
    };
  }
  // B83: Knowledge Is Power — cards you've drawn this turn.
  if (/^cards? you(?:'ve| have) drawn this turn$/.test(p)) {
    return { countBasis: 'controller_cards_drawn_this_turn' };
  }
  // B85: Moraug — for each time it has attacked this turn.
  if (/^time it has attacked this turn$/.test(p)) {
    return { countBasis: 'recipient_times_attacked_this_turn' };
  }
  // B87: Upriser Renegade.
  if (/^(other )?modified creatures? you control$/.test(p)) {
    return { countBasis: 'controller_modified_creatures', ...(p.startsWith('other ') ? { countExcludeSource: true } : {}) };
  }
  // B87: Rampant Frogantua.
  if (/^players? who has? lost the game$/.test(p)) {
    return { countBasis: 'players_who_lost_the_game' };
  }
  // B87: Bearded Axe — Dwarf, Equipment, and/or Vehicle you control.
  {
    const multi = p.match(/^([a-z]+)(?:, ([a-z]+))*(?:,? and\/?or ([a-z]+)) you control$/);
    if (multi) {
      const parts = p.replace(/ you control$/, '').split(/,? and\/?or |, /).map((w) => w.trim().replace(/s$/, '')).filter(Boolean);
      if (parts.length >= 2) {
        return { countBasis: 'controller_permanents_matching_any_type', countCardType: parts.join('|') };
      }
    }
  }
  // B87: Opaline Bracers — charge counters on this Equipment (where-x / for-each).
  m = p.match(/^([a-z+\/0-9-]+) counters? on (?:~|this (?:equipment|aura|artifact|enchantment))$/);
  if (m) return { countBasis: 'source_counters', countCounterType: m[1], countOnEffectSource: true };
  // B88: Copperhoof — untapped permanents your opponents control.
  if (/^untapped permanents? (?:your opponents control|an opponent controls)$/.test(p)) {
    return { countBasis: 'opponents_untapped_permanents' };
  }
  // B88: Strata Scythe — lands with the same name as the exiled card.
  if (/^lands? on the battlefield with the same name as the exiled card$/.test(p)) {
    return { countBasis: 'lands_matching_effect_source_exiled_name' };
  }
  return null;
}

function legacyAttachedReaderApplies(oracle: string): boolean {
  if (parseStaticAttachedPTBonusFromOracle(oracle)) return true;
  try {
    return resolveAttachedPTBonusFromOracle(oracle, '', [], undefined, {}, {}) !== null;
  } catch {
    return true;
  }
}

const WHERE_X_RE = /^(this creature|enchanted creature|equipped creature|enchanted permanent|creatures you control) gets? ([+-])x\/([+-])(x|0),? where x is (.+)$/;

function whereXBasis(phrase: string): Partial<StaticEffectGrant> | null {
  const p = phrase.trim();
  if (p === 'your life total') return { countBasis: 'controller_life_total' as any };
  // B83: greatest-mana phrases are not "the number of …".
  const greatest = countGrant(p);
  if (greatest?.countBasis === 'greatest_mana_value_among_controller_permanents') return greatest;
  if (greatest?.countBasis === 'controller_cards_drawn_this_turn') return greatest;
  const m = p.match(/^the number of (.+?)s?$/);
  if (!m) return countGrant(p);
  return countGrant(m[1]) || countGrant(m[1].replace(/^cards in your (hand|graveyard)$/, 'card in your $1'));
}

function pushWhereXSpec(specs: StaticEffectSpec[], source: StaticEffectSpecSource, hostId: string, oracle: string, m: RegExpMatchArray, index: number): void {
  const basis = whereXBasis(m[5]);
  if (!basis) return;
  const grant: StaticEffectGrant = { power: m[2] === '-' ? -1 : 1, toughness: m[4] === '0' ? 0 : (m[3] === '-' ? -1 : 1), ...basis };
  if (m[1] === 'this creature') { specs.push(buildSpec(source, `self-where-x-pt:${index}`, { kind: 'self' }, grant)); return; }
  if (m[1] === 'creatures you control') {
    specs.push(buildSpec(source, `creatures-you-control-where-x-pt:${index}`, { kind: 'creatures_you_control' }, grant));
    return;
  }
  if (!hostId || legacyAttachedReaderApplies(oracle)) return;
  specs.push({ ...buildSpec(source, `attached-where-x-pt:${index}`, { kind: 'self' }, grant), sourcePermanentId: hostId, effectSourcePermanentId: source.sourcePermanentId, scope: { kind: 'self' } });
}

// B88: Rolling Hamsphere — "This Vehicle gets +1/+1 for each Hamster you control."
const LINE_RE = /^(this creature|this vehicle|enchanted creature|equipped creature) gets ([+-]\d+)\/([+-]\d+)(?: for each ([a-z+\/0-9 ~',-]+?))?(?: and ([^.]+))?$/;

export function pushCountedAndAttachedPTSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const name = String((perm as any)?.card?.name || '').toLowerCase();
  const hostId = String((perm as any)?.attachedTo || '').trim();
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/);
  lines.forEach((raw, index) => {
    // Ability words ("Domain \u2014 ") are flavour only (CR 207.2c).
    let line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '').replace(/^[a-z' ]+ \u2014 /, '');
    const shortName = name.split(',')[0].trim();
    if (name && line.startsWith(`${name} gets `)) line = `this creature${line.slice(name.length)}`;
    else if (shortName && shortName !== name && line.startsWith(`${shortName} gets `)) line = `this creature${line.slice(shortName.length)}`;
    else if (line.startsWith('~ gets ')) line = `this creature${line.slice(1)}`;
    const whereX = line.match(WHERE_X_RE);
    if (whereX) { pushWhereXSpec(specs, source, hostId, oracle, whereX, index); return; }
    if (name) line = line.split(` counter on ${name}`).join(' counter on ~');
    if (/as long as|until end of turn|where x|^(?:when|whenever|at|if)\b/.test(line)) return;
    const m = line.match(LINE_RE);
    if (!m) return;
    const attached = m[1] !== 'this creature' && m[1] !== 'this vehicle';
    const grant: StaticEffectGrant = { power: parseInt(m[2], 10), toughness: parseInt(m[3], 10) };
    let forEachPhrase = m[4] || '';
    let tail = m[5] || '';
    if (forEachPhrase && tail) {
      // Lazy "for each" cuts at the first "and" ("Aura and Equipment attached to it and has ward").
      const rebuilt = `${forEachPhrase} and ${tail}`;
      const attachCut = rebuilt.match(/^(.+? attached to (?:it|this creature))(?: and (.+))?$/);
      if (attachCut) {
        forEachPhrase = attachCut[1];
        tail = attachCut[2] || '';
      } else if (/^(artifact|creature|enchantment|land|planeswalker) and (artifact|creature|enchantment|land|planeswalker) cards? in/.test(rebuilt)) {
        // B82: Winter — "creature and planeswalker card in your graveyard"
        forEachPhrase = rebuilt;
        tail = '';
      }
    }
    if (forEachPhrase) {
      const basis = countGrant(forEachPhrase);
      if (!basis) return;
      Object.assign(grant, basis);
    } else if (!attached) {
      return;
    }
    if (/\bfor each\b/.test(tail)) return;
    const abilities = tail ? parseLordAbilitiesFromTail(tail.replace(/^has\s+|^have\s+/i, '')) : [];
    if (abilities.length) grant.abilities = abilities;
    if (attached) {
      if (!hostId || legacyAttachedReaderApplies(oracle)) return;
      specs.push({
        ...buildSpec(source, `attached-host-pt:${index}`, { kind: 'self' }, grant),
        sourcePermanentId: hostId,
        effectSourcePermanentId: source.sourcePermanentId,
        scope: { kind: 'self' },
      });
      return;
    }
    const duplicate = specs.some((s) => s.sourcePermanentId === source.sourcePermanentId && s.scope.kind === 'self'
      && s.grant.countBasis && s.grant.power === grant.power && s.grant.toughness === grant.toughness);
    if (!duplicate) specs.push(buildSpec(source, `self-counted-pt:${index}`, { kind: 'self' }, grant));
  });
}
