// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingQualifiedGrants.ts
// Keyword / quoted-ability grants to a qualified group you control (round 21 census tail):
//   "Each creature you control with a counter on it has ward {1}." (Cathedral Acolyte)
//   "Each other creature you control with a +1/+1 counter on it has haste." (Exava)
//   "White legendary creatures you control have "bands with other legendary creatures."" (Cathedral of Serra)
//   "Each legendary permanent you control has ward {2}." / "Treasures you control have "..."" / "Each creature you control has ward {1}."
// Ward keeps its cost ("ward {1}") so getGrantedWardCost can read it. Lines another handler already
// covered (same abilities from this source) are skipped.
// Public entry symbols: pushQualifiedGrantSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import type { StaticEffectScope, StaticEffectScopeQualifier, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const COLOR_LETTER: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const LINE_RE = /^(?:each |all )?(other )?((?:(?:white|blue|black|red|green|legendary|nontoken|token) )*)([a-z]+?)(?:s)? you control(?: with (?:a|an|one or more) ((?:[+-]\d+\/[+-]\d+|[a-z]+) )?counters? on (?:it|them))? (?:has|have) (.+?)\.?$/;

export function pushQualifiedGrantSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, _perm: BattlefieldPermanent, oracle: string): void {
  const lines = String(oracle || '').replace(/[\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').split(/\n+/)
    .map((l) => l.replace(/\([^)]*\)/g, '').trim());
  lines.forEach((raw, index) => {
    const line = raw.toLowerCase();
    const m = LINE_RE.exec(line.replace(/\.$/, ''));
    if (!m) return;
    const [, other, adjRaw, noun, counterRaw, tailLower] = m;
    const adjs = adjRaw.trim().split(/\s+/).filter(Boolean);
    const counter = counterRaw ? counterRaw.trim() : '';
    // Nothing qualifies the group: plain "creatures you control have X" belongs to the base lord handlers.
    const hasCounterClause = / with (?:a|an|one or more) (?:\S+ )?counters? on (?:it|them)/.test(line);
    const plainCreatures = noun === 'creature' && !adjs.length && !hasCounterClause && !/\bward\b/.test(tailLower);
    if (plainCreatures) return;
    const tailStart = raw.toLowerCase().lastIndexOf(tailLower.slice(0, 12));
    const tail = tailStart >= 0 ? raw.slice(tailStart).replace(/\.$/, '') : tailLower;
    let abilities = parseAbilitiesFromTail(tail);
    const ward = /\bward\s*((?:\{[^}]+\})+)/i.exec(tail.replace(/"[^"]*"/g, ' '));
    if (ward) abilities = abilities.map((a) => (a === 'ward' ? `ward ${ward[1].toLowerCase()}` : a));
    if (!abilities.length) return;
    const qualifier: StaticEffectScopeQualifier = {};
    const colors = adjs.filter((a) => COLOR_LETTER[a]).map((a) => COLOR_LETTER[a]);
    if (colors.length) qualifier.colors = colors;
    if (adjs.includes('legendary')) qualifier.legendary = true;
    if (adjs.includes('nontoken')) qualifier.token = false;
    if (adjs.includes('token')) qualifier.token = true;
    if (counter) qualifier.counter = counter;
    else if (/ with (?:a|an|one or more) counters? on (?:it|them)/.test(line)) qualifier.anyCounter = true;
    let scope: StaticEffectScope;
    if (noun === 'creature') scope = { kind: other ? 'other_creatures_you_control' : 'creatures_you_control' };
    else if (noun === 'permanent') scope = { kind: other ? 'other_permanents_you_control' : 'permanents_you_control' };
    else if (isCreatureTypeWord(noun[0].toUpperCase() + noun.slice(1))) scope = { kind: other ? 'other_creatures_you_control' : 'creatures_you_control', creatureType: noun[0].toUpperCase() + noun.slice(1) };
    else if (/^(?:artifact|enchantment|land|planeswalker|treasure|food|clue|equipment|aura|vehicle|blood|map|gold)$/.test(noun)) { scope = { kind: other ? 'other_permanents_you_control' : 'permanents_you_control' }; qualifier.subtype = noun; }
    else return;
    if (Object.keys(qualifier).length) scope.qualifier = qualifier;
    const key = JSON.stringify(abilities);
    if (specs.some((s) => String(s.sourcePermanentId) === String(source.sourcePermanentId) && JSON.stringify(s.grant?.abilities || []) === key)) return;
    specs.push(buildSpec(source, `qualified-grant:${index}`, scope, { abilities }));
  });
}