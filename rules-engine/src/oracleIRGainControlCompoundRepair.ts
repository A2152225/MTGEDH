/**
 * Repair compound "gain control of target creature until end of turn, untap …, and it gains haste"
 * into discrete gain_control + untap + grant_temporary_ability steps (Obligator-style).
 */
import type { OracleEffectStep } from './oracleIR';

const COMPOUND_GAIN_CONTROL_RE =
  /^gain\s+control\s+of\s+(target\s+creature)(?:\s+until\s+end\s+of\s+turn)?\s*,\s*untap\s+(?:that\s+creature|it)(?:\s*,?\s*and\s+it\s+gains?\s+(.+?))?(?:\s+until\s+end\s+of\s+turn)?$/i;

const MANGLED_WHAT_RE =
  /^(target\s+creature)(?:\s+until\s+end\s+of\s+turn)?\s*,\s*untap\s+(?:that\s+creature|it)(?:\s*,?\s*and\s+it\s+gains?\s+(.+))?$/i;

function parseAbilityList(text: string): string[] {
  return String(text || '')
    .replace(/\s+until\s+end\s+of\s+turn$/i, '')
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function expandGainControlCompound(step: OracleEffectStep): OracleEffectStep[] | null {
  if (step.kind !== 'gain_control') return null;
  const raw = String((step as any).raw || '').replace(/\s+/g, ' ').trim();
  const whatText = String((step as any).what?.text || '').replace(/\s+/g, ' ').trim();

  let creatureText = 'target creature';
  let abilitiesRaw = '';
  const rawMatch = raw.match(COMPOUND_GAIN_CONTROL_RE);
  const whatMatch = whatText.match(MANGLED_WHAT_RE);
  if (rawMatch) {
    creatureText = String(rawMatch[1] || 'target creature').trim();
    abilitiesRaw = String(rawMatch[2] || '').trim();
  } else if (whatMatch) {
    creatureText = String(whatMatch[1] || 'target creature').trim();
    abilitiesRaw = String(whatMatch[2] || '').trim();
  } else {
    return null;
  }

  const out: OracleEffectStep[] = [
    {
      ...step,
      what: { kind: 'raw', text: creatureText },
      duration: 'until_end_of_turn',
      raw: `gain control of ${creatureText} until end of turn`,
    } as OracleEffectStep,
    {
      kind: 'tap_or_untap',
      target: { kind: 'raw', text: 'that creature' },
      mode: 'untap',
      raw: 'Untap that creature',
    } as OracleEffectStep,
  ];

  const abilities = parseAbilityList(abilitiesRaw);
  if (abilities.length > 0) {
    out.push({
      kind: 'grant_temporary_ability',
      target: { kind: 'raw', text: 'it' },
      duration: 'end_of_turn',
      abilities,
      raw: `it gains ${abilities.join(' and ')} until end of turn`,
    } as OracleEffectStep);
  }

  return out;
}

export function repairGainControlCompoundRiderSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (!Array.isArray(steps) || steps.length === 0) return steps as OracleEffectStep[];
  const out: OracleEffectStep[] = [];
  for (const step of steps) {
    if (step.kind === 'conditional' && Array.isArray((step as any).steps)) {
      const nested = repairGainControlCompoundRiderSteps((step as any).steps);
      out.push(nested === (step as any).steps ? step : { ...step, steps: nested });
      continue;
    }
    const expanded = expandGainControlCompound(step);
    if (expanded) {
      out.push(...expanded);
      continue;
    }
    out.push(step);
  }
  return out;
}
