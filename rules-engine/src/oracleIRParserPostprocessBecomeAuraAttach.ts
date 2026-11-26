// Licids ("{U}, {T}: Gliding Licid loses this ability and becomes an Aura enchantment with enchant
// creature. Attach it to target creature. You may pay {U} to end this effect."): the ability splitter cut
// the activation after "enchant creature", leaving "Attach it to target creature" as a stray spell
// ability, so the become_aura step had no enchant target and the activation did nothing. Fold the attach
// sentence back into the become_aura step as `attachTarget` (enchant stays the printed restriction) and keep the
// "pay {X} to end this effect" cost on the step.
//
// Public entry points:
//   mergeBecomeAuraAttachAbilities

import type { OracleIRAbility } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

const ATTACH_IT_TO_TARGET = /^attach\s+(?:it|this\s+permanent|this\s+creature)\s+to\s+(target\s+.+)$/i;
const PAY_TO_END_EFFECT = /^you\s+may\s+pay\s+((?:\{[^}]+\})+)\s+to\s+end\s+this\s+effect$/i;

function normalizeRaw(raw: unknown): string {
  return String(raw || '')
    .replace(/[\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '')
    .trim();
}

function joinText(base: unknown, extra: string): string | undefined {
  if (typeof base !== 'string' || !extra) return undefined;
  return `${base.trim()} ${extra}`.trim();
}

export function mergeBecomeAuraAttachAbilities(abilities: OracleIRAbility[]): OracleIRAbility[] {
  const out: OracleIRAbility[] = [];
  for (let idx = 0; idx < abilities.length; idx += 1) {
    const ability = abilities[idx];
    const steps = Array.isArray(ability.steps) ? ability.steps : [];
    const last: any = steps[steps.length - 1];
    const follow: any = abilities[idx + 1];
    if (!last || last.kind !== 'become_aura' || !follow || String(follow.type || '') !== 'spell') {
      out.push(ability);
      continue;
    }
    const followSteps: any[] = Array.isArray(follow.steps) ? follow.steps : [];
    const attachMatch = followSteps[0]?.kind === 'attach' ? normalizeRaw(followSteps[0]?.raw).match(ATTACH_IT_TO_TARGET) : null;
    if (!attachMatch) {
      out.push(ability);
      continue;
    }
    const endMatch = followSteps.length > 1 ? normalizeRaw(followSteps[1]?.raw).match(PAY_TO_END_EFFECT) : null;
    if (followSteps.length > (endMatch ? 2 : 1)) {
      out.push(ability);
      continue;
    }
    const merged = {
      ...last,
      attachTarget: parseObjectSelector(attachMatch[1]),
      ...(endMatch ? { endEffectCost: endMatch[1] } : {}),
    };
    const followText = String(follow.text || '').trim();
    const followEffect = String(follow.effectText || follow.text || '').trim();
    const text = joinText((ability as any).text, followText);
    const effectText = joinText((ability as any).effectText, followEffect);
    out.push({
      ...ability,
      steps: [...steps.slice(0, -1), merged],
      ...(text ? { text } : {}),
      ...(effectText ? { effectText } : {}),
    } as OracleIRAbility);
    idx += 1;
  }
  return out;
}
