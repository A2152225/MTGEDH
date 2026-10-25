// client/src/utils/restrictionReasonText.ts
// Rewrites server block/cast restriction reasons into readable toast/modal text.
// Public entry symbols: readableCastRestriction, readableCombatError, flagbearerTargetReason.

/** "Cast this spell only if you've cast another red spell this turn." -> "you haven't cast another red spell this turn." */
export function readableCastRestriction(message: unknown): string | null {
  const m = String(message || '').trim().match(/^Cast this spell only if you've cast another (?:(\w+) )?spell this turn\.?$/i);
  if (!m) return null;
  return m[1] ? `you haven't cast another ${m[1]} spell this turn yet.` : "you haven't cast another spell this turn yet.";
}

/** "A can't block B (Attacker can't be blocked ...)" -> "A can't block B \u2014 B can only be blocked by ...". */
export function readableCombatError(message: unknown): string {
  const raw = String(message || '');
  const m = raw.match(/^(.+?) can't block (.+?) \((.*)\)$/);
  if (!m) return raw;
  const [, blocker, attacker, reason] = m;
  const except = reason.match(/^Attacker can't be blocked except by creatures with (.+?)\.?$/i);
  if (except) return `${blocker} can't block ${attacker} \u2014 ${attacker} can only be blocked by creatures with ${except[1]}.`;
  if (/^Attacker can't be blocked while attacking alone/i.test(reason)) return `${blocker} can't block ${attacker} \u2014 ${attacker} can't be blocked while it's attacking alone.`;
  return raw;
}

/** Confirm-disabled reason when a required Flagbearer target is not yet chosen (null = satisfied). */
export function flagbearerTargetReason(requiredIds: readonly string[], selectedIds: Iterable<string>): string | null {
  if (requiredIds.length === 0) return null;
  for (const id of selectedIds) if (requiredIds.includes(id)) return null;
  return 'You must choose at least one Flagbearer as a target.';
}
