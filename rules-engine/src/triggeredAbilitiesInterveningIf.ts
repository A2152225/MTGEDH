import type { TriggeredAbility } from './triggeredAbilitiesTypes';

export function resolveInterveningIfClause(
  input: Pick<TriggeredAbility, 'interveningIfClause' | 'hasInterveningIf' | 'condition'>
): string | undefined {
  const direct = String(input.interveningIfClause || '').trim();
  if (direct) return direct;
  if (!input.hasInterveningIf) return undefined;
  const fallback = String(input.condition || '').trim();
  return fallback || undefined;
}
