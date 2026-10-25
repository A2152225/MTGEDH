/**
 * "~ can block creatures with shadow as though it had shadow" (Heartwood Dryad, Wall of Diffusion)
 * and "Creatures you control can block creatures with shadow as though they had shadow".
 */
function rec(obj: unknown): Record<string, unknown> | null {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
}

function oracleOf(perm: unknown): string {
  const card = rec(rec(perm)?.card);
  const text = card?.oracle_text;
  return typeof text === 'string' ? text.toLowerCase().replace(/\u2019/g, "'") : '';
}

const SELF_RE = /(?:^|[\n.]\s*)(?:~|this creature|[a-z0-9 ,'-]+?) can block creatures with shadow as though (?:it|this creature) had shadow/;
const TEAM_RE = /creatures you control can block creatures with shadow as though they had shadow/;

export function canBlockShadowAsThough(blocker: unknown, battlefield: unknown): boolean {
  if (SELF_RE.test(oracleOf(blocker))) return true;
  const controller = rec(blocker)?.controller;
  if (!Array.isArray(battlefield) || typeof controller !== 'string') return false;
  return (battlefield as unknown[]).some(p => rec(p)?.controller === controller && TEAM_RE.test(oracleOf(p)));
}
