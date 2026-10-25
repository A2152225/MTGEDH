// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingAttachedExtras.ts
// Attached statics the conditional attached reader does not cover (census round 16):
//   "Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1." (Frogify)
//   "As long as enchanted land is a basic Mountain, Goblin creatures get +0/+2." (Goblin Caves)
//   "Enchanted creature gets -2/-0. It gets -6/-0 instead as long as its controller has seven or more cards in their graveyard." (So Tiny)
//   "It gets an additional +0/+2 and has first strike as long as an Equipment named Groom's Finery is attached to a creature you control." (Bride's Gown)
//   "As long as enchanted creature is blue, it gets +1/+1 and has \"...\"" (Helm of the Ghastlord; the quoted grant is left to trigger code)
// Public entry symbols: pushAttachedExtraSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectGrant, StaticEffectScope, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { colorSetEntry } from '../colorSettingMarker.js';
import { parseAttachedStaticCondition } from './staticEffectSpecOracleParsingConditionalAttachedPT.js';

const HOST = '(?:enchanted|equipped) (?:creature|permanent)';
const PT = '([+-]\\d+)\\/([+-]\\d+)';
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const cond = (o: Record<string, unknown>) => o as unknown as StaticEffectCondition;

function hostCondition(raw: string, hostId: string): StaticEffectCondition | null {
  const t = raw.trim().replace(/[.,]+$/, '');
  const m = t.match(/^(?:its controller|it) has (\w+) or more cards in (?:their|its controller's|his or her) graveyard$/);
  if (m) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const n = words[m[1]] ?? Number(m[1]);
    if (Number.isFinite(n)) return cond({ kind: 'zone_count', zone: 'graveyard', who: 'host', option: hostId, cmp: 'min', count: n });
  }
  const named = t.match(/^an equipment named (.+?) is attached to a creature you control$/);
  if (named) return cond({ kind: 'controller_named_equipment_attached', option: named[1] });
  return parseAttachedStaticCondition(t);
}

import { pushTypeExtraSpecs } from './staticEffectSpecOracleParsingTypeExtras.js';

export function pushAttachedExtraSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushTypeExtraSpecs(specs, source, perm, oracle);
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const onHost = (id: string, grant: StaticEffectGrant, condition?: StaticEffectCondition | null) => specs.push({
    ...buildSpec(source, id, { kind: 'self' }, grant, condition || undefined),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/).map((l) => l.replace(/\([^)]*\)/g, '').trim());
  lines.forEach((line, index) => {
    // Zendikon: "Enchanted land is a 5/3 green Elemental creature with reach and haste. It's still a land."
    const z = line.match(/^enchanted (?:land|artifact) is an? \d+\/\d+ ([a-z ,]*?)\bcreature(?: with ([a-z ,]+?))?\.\s*it's still an? (?:land|artifact)\b/);
    if (z) {
      const words = z[1].replace(/,/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
      const colors = words.filter((w) => /^(?:white|blue|black|red|green)$/.test(w));
      const subtypes = words.filter((w) => !colors.includes(w) && w !== 'colorless').map(cap);
      const abilities = z[2] ? parseAbilitiesFromTail(z[2]) : [];
      const colorAdditions = colors.map((c) => colorSetEntry(c)!).filter(Boolean);
      const grant: StaticEffectGrant = {
        ...(subtypes.length ? { typeAdditions: subtypes } : {}),
        ...(colorAdditions.length ? { colorAdditions } : {}),
        ...(abilities.length ? { abilities } : {}),
      };
      if (Object.keys(grant).length) onHost(`attached-extra-zendikon:${index}`, grant);
      return;
    }
    let m = line.match(new RegExp('^' + HOST + ' (?:loses all abilities and )?is an? (?:(white|blue|black|red|green) )?([a-z]+) creature with base power and toughness \\d+\\/\\d+'));
    if (m) {
      onHost(`attached-extra-type:${index}`, { typeAdditions: [cap(m[2])], loseOtherCreatureTypes: true, ...(m[1] ? { colorAdditions: [colorSetEntry(m[1])!] } : {}) });
      return;
    }
    // Extras riding a P/T bonus the legacy attached reader already applies (Starforged Sword, Runed Stalactite).
    m = line.match(new RegExp('^' + HOST + ' gets ' + PT + ' and (?:loses ([a-z ]+?)|(is every creature type))\\.?$'));
    if (m) {
      if (m[4]) onHost(`attached-extra-every-type:${index}`, { typeAdditions: ['*'] });
      else if (m[3] !== 'all abilities') onHost(`attached-extra-loses:${index}`, { removeAbilities: m[3].split(/,? and |, /).map((k) => k.trim()).filter(Boolean) });
      return;
    }
    m = line.match(new RegExp('^as long as enchanted land is a basic ([a-z]+), ([a-z]+) creatures get ' + PT + '\\.?$'));
    if (m) {
      const scope: StaticEffectScope = { kind: 'all_creatures_of_type', creatureType: m[2] };
      specs.push(buildSpec(source, `attached-extra-land-lord:${index}`, scope, { power: Number(m[3]), toughness: Number(m[4]) },
        cond({ kind: 'attached_host_is_basic_subtype', landType: m[1], option: hostId })));
      return;
    }
    m = line.match(new RegExp('^' + HOST + ' gets ' + PT + '\\. it gets ' + PT + ' instead as long as (.+?)\\.?$'));
    if (m) {
      const c = hostCondition(m[5], hostId);
      if (!c) return;
      const [p1, t1, p2, t2] = [m[1], m[2], m[3], m[4]].map(Number);
      onHost(`attached-extra-base:${index}`, { power: p1, toughness: t1 });
      onHost(`attached-extra-instead:${index}`, { power: p2 - p1, toughness: t2 - t1 }, c);
      return;
    }
    m = line.match(new RegExp('(?:^|\\. )it gets an additional ' + PT + '(?: and has ([a-z ]+?))? as long as (an equipment named .+? is attached to a creature you control|its controller has .+)\\.?$'));
    if (m) {
      const c = hostCondition(m[4], hostId);
      const abilities = m[3] ? parseAbilitiesFromTail(m[3]) : [];
      if (!c || (m[3] && abilities.length === 0)) return;
      onHost(`attached-extra-additional:${index}`, { power: Number(m[1]), toughness: Number(m[2]), ...(abilities.length ? { abilities } : {}) }, c);
      return;
    }
    m = line.match(new RegExp('^as long as ' + HOST + ' is (white|blue|black|red|green), it gets ' + PT + ' and has "[^"]+"\\.?$'));
    if (m) onHost(`attached-extra-color:${index}`, { power: Number(m[2]), toughness: Number(m[3]) }, cond({ kind: 'target_has_mana_color', color: m[1] }));
  });
}
