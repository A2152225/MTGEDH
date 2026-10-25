// server/src/state/modules/staticEffectSpecEntryLifeConditions.ts
// Census round 9 self conditions:
//   "~ has hexproof as long as it entered this turn" (Thrasta, Zurgo and Ojutai) -> 'target_entered_this_turn',
//   "as long as your life total is less than or equal to half your starting life total" (Bhaal, Myrkul)
//     -> 'source_controller_life_at_most_half_starting'.
// Public entry symbols: parseEntryLifeCondition, evalEntryLifeCondition.

export function parseEntryLifeCondition(raw: string): { kind: string } | null {
  const c = String(raw || '').toLowerCase().replace(/\u2019/g, "'").replace(/[.,]+$/, '').trim();
  if (/^(?:it|this creature|this permanent|~) entered(?: the battlefield)? this turn$/.test(c)) return { kind: 'target_entered_this_turn' };
  if (/^your life total is less than or equal to half your starting life total$/.test(c)) {
    return { kind: 'source_controller_life_at_most_half_starting' };
  }
  return null;
}

function lifeOf(state: any, playerId: string): number | undefined {
  const v = state?.life?.[playerId];
  if (Number.isFinite(Number(v))) return Number(v);
  const pl = (Array.isArray(state?.players) ? state.players : []).find((x: any) => String(x?.id) === playerId);
  return Number.isFinite(Number(pl?.life)) ? Number(pl.life) : undefined;
}

/** Returns undefined for kinds this module does not own. */
export function evalEntryLifeCondition(kind: string, permanent: any, controllerId: string, state: any): boolean | undefined {
  if (kind === 'target_entered_this_turn') return permanent?.enteredThisTurn === true;
  if (kind === 'source_controller_life_at_most_half_starting') {
    const life = lifeOf(state, String(controllerId || ''));
    const starting = Number(state?.startingLife ?? 40) || 40;
    return life !== undefined && life <= starting / 2;
  }
  return undefined;
}
