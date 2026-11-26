/**
 * Origin: long-tail P/T apply passes (batch106Apply, batch111Apply).
 * Those passes were added after the declarative static-spec layer already covered some of
 * the same lines (Nim Lasher, Guardian's Magemark, Seven Dwarves), so both layers added the
 * bonus. A long-tail branch asks this guard first and skips a line the declarative layer
 * already applies.
 * Public: declarativeSpecAppliesPtLine
 */
import { parseStaticEffectSpecsFromOraclePermanent } from './staticEffectSpecOracleParsing.js';

const overlapCache = new Map<string, boolean>();

function grantsNumericPowerToughness(spec: any): boolean {
  // Long-tail census markers (":batch1NN-...") only carry ability tags, never the bonus itself.
  if (/:batch\d+-/.test(String(spec?.id || ''))) return false;
  const grant = spec?.grant || {};
  return (Number(grant.power) || 0) !== 0 || (Number(grant.toughness) || 0) !== 0;
}

/** True when the declarative static-spec parser already grants P/T for the source's matching oracle lines. */
export function declarativeSpecAppliesPtLine(source: any, lineMatches: (oracleLine: string) => boolean): boolean {
  const card = source?.card || {};
  const oracle = String(card.oracle_text || source?.oracle_text || '');
  const lines = oracle.split(/\n+/).filter((line) => line.trim() && lineMatches(line));
  if (lines.length === 0) return false;
  const key = `${card.name || ''}|${card.type_line || ''}|${lines.join('\n')}`;
  const cached = overlapCache.get(key);
  if (cached !== undefined) return cached;
  const probe = {
    id: String(source?.id || 'pt-overlap-probe'),
    controller: source?.controller,
    owner: source?.owner,
    card: { ...card, oracle_text: lines.join('\n') },
  };
  const applies = parseStaticEffectSpecsFromOraclePermanent(probe as any).some(grantsNumericPowerToughness);
  overlapCache.set(key, applies);
  return applies;
}
