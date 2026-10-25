/**
 * "Instant and sorcery spells you control have lifelink" (Radiant Scrollwielder,
 * Heartflame Duelist): damage dealt by such a resolving spell also makes its controller
 * gain that much life (rule 702.15b). Called from executeSpellEffectCore after spell damage.
 */
import { applyLifeGainViaProcessLifeChange } from './turn-handlers/turnCombatDamageLifeGain.js';
import { getResolvingSpellSource } from './replacementResolvingSpellSource.js';

const GRANT_RE = /\b(instant and sorcery|instant|sorcery|noncreature) spells you control have lifelink\b/i;

export function spellHasGrantedLifelink(state: any, controller: string, spellTypeLine: string): boolean {
  const tl = String(spellTypeLine || '').toLowerCase();
  if (!controller || !tl) return false;
  for (const perm of (state?.battlefield || []) as any[]) {
    if (!perm || String(perm.controller) !== controller) continue;
    const m = String(perm.card?.oracle_text || '').match(GRANT_RE);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    if (kind === 'noncreature' ? !tl.includes('creature') : kind.split(' and ').some((k) => tl.includes(k))) return true;
  }
  return false;
}

/**
 * Oracle IR path: after a resolving spell's IR steps apply, sum the damage it dealt (other players' life
 * drop plus new marked damage on permanents, from the pre-apply snapshot) and gain that much if the spell
 * has lifelink. Skipped when the IR source is a battlefield permanent (abilities, not spells).
 */
export function applyOracleIrSpellLifelinkGain(
  ctx: any,
  result: { appliedSteps?: ReadonlyArray<{ kind?: string }> },
  before: { lifeByPlayer: ReadonlyMap<string, number>; permanents: ReadonlyMap<string, { damage: number }> },
  opts: { controller?: string; sourceId?: string; sourceItem?: any },
): number {
  try {
    if (!ctx || ctx.isReplaying) return 0;
    if (!(result?.appliedSteps || []).some((s) => String(s?.kind || '').includes('damage'))) return 0;
    const state = ctx.state;
    const sourceId = String(opts.sourceId || '');
    if (sourceId && ((state?.battlefield || []) as any[]).some((perm: any) => String(perm?.id) === sourceId)) return 0;
    const item = opts.sourceItem;
    const card: any = item?.card || getResolvingSpellSource(state, sourceId)?.card
      || ((state?.stack || []) as any[]).find((s: any) => String(s?.id || '') === sourceId)?.card;
    const controller = String(item?.controller || opts.controller || '');
    if (!card || !controller) return 0;
    const printed = /^lifelink\b/im.test(String(card.oracle_text || ''));
    if (!printed && !spellHasGrantedLifelink(state, controller, String(card.type_line || ''))) return 0;
    let dealt = 0;
    for (const [pid, life] of before.lifeByPlayer) {
      if (pid === controller) continue;
      const now = Number(state?.life?.[pid] ?? ((state?.players || []) as any[]).find((pl: any) => pl?.id === pid)?.life);
      if (Number.isFinite(now) && now < life) dealt += life - now;
    }
    for (const perm of (state?.battlefield || []) as any[]) {
      const prev = before.permanents.get(String(perm?.id || ''));
      const now = Math.max(Number(perm?.damage || 0), Number(perm?.damageMarked || 0), Number(perm?.markedDamage || 0));
      if (now > (prev ? prev.damage : 0)) dealt += now - (prev ? prev.damage : 0);
    }
    if (dealt <= 0) return 0;
    return applyLifeGainViaProcessLifeChange(ctx, controller, dealt, String(card.name || 'spell') + ' (lifelink)').actualChange;
  } catch {
    return 0;
  }
}

/** Gain life for spell damage when the spell has (granted or printed) lifelink. Returns life gained. */
export function applySpellLifelinkGain(ctx: any, opts: { sourcePermanentId?: string; sourceId?: string; caster?: string; amount: number }): number {
  try {
    const amount = Math.max(0, Number(opts.amount) || 0);
    if (!ctx || ctx.isReplaying || amount <= 0 || opts.sourcePermanentId) return 0;
    const state = ctx.state;
    const item = ((state?.stack || []) as any[]).find((s: any) => String(s?.id || '') === String(opts.sourceId || ''));
    const controller = String(item?.controller || opts.caster || '');
    // The stack item may already be gone mid-resolution; fall back to the recorded resolving-spell snapshot.
    const card: any = item?.card || getResolvingSpellSource(state, String(opts.sourceId || ''))?.card;
    if (!card || !controller) return 0;
    const printed = /^lifelink\b/im.test(String(card.oracle_text || ''));
    if (!printed && !spellHasGrantedLifelink(state, controller, String(card.type_line || ''))) return 0;
    return applyLifeGainViaProcessLifeChange(ctx, controller, amount, String(card.name || 'spell') + ' (lifelink)').actualChange;
  } catch {
    return 0;
  }
}
