// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalAttachedPT.ts
// Conditional attached P/T / keyword statics applied to the host:
//   "Enchanted creature gets +2/+2 as long as an opponent controls a white permanent." (Black Scarab)
//   "As long as enchanted permanent is a creature, it gets +1/+1." (Twisted Embrace)
//   "As long as equipped creature is attacking, it gets +2/+0 and has first strike."
// An unrecognized condition yields no spec (never "always on"); the legacy positive-only attached
// reader skips "as long as" sentences so these are not double counted.
// Public entry symbols: pushConditionalAttachedPTSpecs, parseAttachedStaticCondition.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { parseStaticSelfCondition } from './staticEffectSpecOracleParsingConditionalSelfGrants.js';
import { parseOtherwiseGrant, splitOtherwiseClause } from './staticEffectSpecOtherwiseClause.js';

const HOST = '(?:enchanted|equipped) (?:creature|permanent|land|artifact)';
const TRAILING = new RegExp('^(?:[a-z\' ]+ \u2014 )?' + HOST + ' gets (?:an additional )?([+-]\\d+)\\/([+-]\\d+)(?: and has ([^.]+?))? as long as (.+)$');
const LEADING = new RegExp('^(?:[a-z\' ]+ \u2014 )?as long as (.+?), (?:' + HOST + '|it) gets (?:an additional )?([+-]\\d+)\\/([+-]\\d+)(?: and has ([^.]+))?$');

export function parseAttachedStaticCondition(raw: string): StaticEffectCondition | null {
  const c = String(raw || '').trim().replace(/[.,]+$/, '');
  let m = c.match(/^an opponent controls an? (?:(white|blue|black|red|green) )?(artifact|creature|enchantment|land|planeswalker|permanent)$/);
  if (m) return { kind: 'opponent_controls_matching', ...(m[1] ? { color: m[1] } : {}), cardType: m[2] } as StaticEffectCondition;
  if (new RegExp('^' + HOST + ' is legendary$').test(c)) return { kind: 'target_is_legendary_creature' } as StaticEffectCondition;
  m = c.match(new RegExp('^' + HOST + ' is an? (artifact|creature|enchantment|land)$'));
  if (m) return { kind: 'target_has_type', cardType: m[1] };
  // "as long as equipped creature is a Human" (True-Faith Censer): a creature subtype of the host.
  m = c.match(new RegExp('^' + HOST + ' is an? ([a-z]+)$'));
  if (m && !['planeswalker', 'battle', 'permanent'].includes(m[1])) {
    return { kind: 'target_has_creature_type', creatureType: m[1][0].toUpperCase() + m[1].slice(1) } as StaticEffectCondition;
  }
  return parseStaticSelfCondition(c.replace(new RegExp('^' + HOST), 'it'));
}

export function pushConditionalAttachedPTSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  // Sentences too: "Equipped creature gets +2/+0. As long as equipped creature is legendary, it gets ..." (Bride's Gown).
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/)
    .flatMap((l) => (/"/.test(l) || /otherwise,/.test(l) ? [l] : l.split(/(?<=\.)\s+(?=as long as )/)));
  lines.forEach((raw, index) => {
    // "Otherwise, it gets -2/-1." (Serra's Boon): the otherwise grant under the negated condition.
    const [mainText, otherwiseText] = splitOtherwiseClause(raw.replace(/\([^)]*\)/g, '').trim());
    const line = mainText.trim().replace(/\.$/, '');
    const other = otherwiseText ? parseOtherwiseGrant(otherwiseText, HOST) : null;
    let power = 0;
    let toughness = 0;
    let tail = '';
    let condText = '';
    const t = line.match(TRAILING);
    const l = t ? null : line.match(LEADING);
    if (t) {
      [power, toughness, tail, condText] = [Number(t[1]), Number(t[2]), t[3] || '', t[4]];
    } else if (l) {
      [condText, power, toughness, tail] = [l[1], Number(l[2]), Number(l[3]), l[4] || ''];
    } else {
      return;
    }
    const condition = parseAttachedStaticCondition(condText);
    if (!condition) return;
    const abilities = tail ? parseAbilitiesFromTail(tail) : [];
    if (tail && abilities.length === 0) return;
    const grant: StaticEffectGrant = { power, toughness, ...(abilities.length ? { abilities } : {}) };
    specs.push({
      ...buildSpec(source, `attached-conditional-pt:${index}`, { kind: 'self' }, grant, condition),
      sourcePermanentId: hostId,
      effectSourcePermanentId: source.sourcePermanentId,
      scope: { kind: 'self' },
    });
    if (other) {
      specs.push({
        ...buildSpec(source, `attached-conditional-pt-otherwise:${index}`, { kind: 'self' }, other, condition),
        conditionNegated: true,
        sourcePermanentId: hostId,
        effectSourcePermanentId: source.sourcePermanentId,
        scope: { kind: 'self' },
      });
    }
  });
}
