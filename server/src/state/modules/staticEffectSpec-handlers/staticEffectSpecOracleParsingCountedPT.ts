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
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseStaticAttachedPTBonusFromOracle,
  resolveAttachedPTBonusFromOracle,
} from '../../utils-handlers/ptAttachedBonusParseHelpers.js';

const CARD_TYPES = ['artifact', 'creature', 'land', 'enchantment', 'planeswalker'];
/** "Mountain you control" (Earth Servant); the count reads effective land types (Evil Presence, Blood Moon). */
const LAND_SUBTYPE_YOU_CONTROL_RE = /^(plains|island|swamp|mountain|forest|desert|gate|cave|town|sphere|locus|lair|mine|tower)(?:e?s)? you control$/;

function countGrant(phrase: string): Partial<StaticEffectGrant> | null {
  const p = phrase.trim();
  let m = p.match(/^(other )?(artifact|creature|land|enchantment|planeswalker) you control$/);
  if (m) return { countBasis: 'controller_permanents_of_type', countCardType: m[2], ...(m[1] ? { countExcludeSource: true } : {}) };
  m = p.match(/^([a-z]+) counters? (you|your opponents) have$/);
  if (m) return { countBasis: 'player_counters', countCounterType: m[1], countWho: m[2] === 'you' ? 'you' : 'opponents' };
  m = p.match(/^(other )?creature on the battlefield with ([a-z ]+)$/);
  if (m) return { countBasis: 'creatures_with_keyword', countKeyword: m[2], ...(m[1] ? { countExcludeSource: true } : {}) };
  m = p.match(/^(aura|equipment)(?: and (aura|equipment))? attached to (?:it|this creature)$/);
  if (m) return { countBasis: 'attachments_on_source', countAttachmentKinds: [m[1], m[2]].filter(Boolean) as string[] };
  if (p === 'card in your hand') return { countBasis: 'controller_hand_size' };
  m = p.match(LAND_SUBTYPE_YOU_CONTROL_RE);
  if (m) return { countBasis: 'controller_lands_of_subtype', countCardType: m[1] };
  if (p === 'basic land type among lands you control') return { countBasis: 'controller_basic_land_types' };
  // Creature/artifact subtypes ("other Rat you control", "Equipment you control"): word-bounded type-line match.
  m = p.match(/^(other )?([a-z]+) you control$/);
  if (m && !/^(card|permanent|token|spell|nonland|other)$/.test(m[2])) {
    return { countBasis: 'controller_permanents_of_type', countCardType: m[2], ...(m[1] ? { countExcludeSource: true } : {}) };
  }
  m = p.match(/^(?:(artifact|creature|land|enchantment|planeswalker) )?card in your graveyard$/);
  if (m) return { countBasis: 'controller_graveyard_cards_of_type', countCardType: m[1] && CARD_TYPES.includes(m[1]) ? m[1] : '' };
  m = p.match(/^([a-z+\/0-9-]+) counter on (?:~|this (?:equipment|aura|artifact|enchantment))$/);
  if (m) return { countBasis: 'source_counters', countCounterType: m[1], countOnEffectSource: true };
  m = p.match(/^([a-z+\/0-9-]+) counter on (?:it|this creature)$/);
  if (m) return { countBasis: 'source_counters', countCounterType: m[1] };
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

const WHERE_X_RE = /^(this creature|enchanted creature|equipped creature) gets ([+-])x\/([+-])(x|0),? where x is (.+)$/;

function whereXBasis(phrase: string): Partial<StaticEffectGrant> | null {
  const p = phrase.trim();
  if (p === 'your life total') return { countBasis: 'controller_life_total' as any };
  const m = p.match(/^the number of (.+?)s?$/);
  if (!m) return null;
  return countGrant(m[1]) || countGrant(m[1].replace(/^cards in your (hand|graveyard)$/, 'card in your $1'));
}

function pushWhereXSpec(specs: StaticEffectSpec[], source: StaticEffectSpecSource, hostId: string, oracle: string, m: RegExpMatchArray, index: number): void {
  const basis = whereXBasis(m[5]);
  if (!basis) return;
  const grant: StaticEffectGrant = { power: m[2] === '-' ? -1 : 1, toughness: m[4] === '0' ? 0 : (m[3] === '-' ? -1 : 1), ...basis };
  if (m[1] === 'this creature') { specs.push(buildSpec(source, `self-where-x-pt:${index}`, { kind: 'self' }, grant)); return; }
  if (!hostId || legacyAttachedReaderApplies(oracle)) return;
  specs.push({ ...buildSpec(source, `attached-where-x-pt:${index}`, { kind: 'self' }, grant), sourcePermanentId: hostId, effectSourcePermanentId: source.sourcePermanentId, scope: { kind: 'self' } });
}

const LINE_RE = /^(this creature|enchanted creature|equipped creature) gets ([+-]\d+)\/([+-]\d+)(?: for each ([a-z+\/0-9 ~-]+?))?(?: and ([^.]+))?$/;

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
    const attached = m[1] !== 'this creature';
    const grant: StaticEffectGrant = { power: parseInt(m[2], 10), toughness: parseInt(m[3], 10) };
    let tail = m[5] || '';
    if (m[4]) {
      // The lazy count phrase stops at the first "and" ("Aura and Equipment attached to it"); try the joined form first.
      const joined = tail ? countGrant(`${m[4]} and ${tail}`) : null;
      const basis = joined || countGrant(m[4]);
      if (!basis) return;
      if (joined) tail = '';
      Object.assign(grant, basis);
    } else if (!attached) {
      return;
    }
    if (/\bfor each\b/.test(tail)) return;
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
