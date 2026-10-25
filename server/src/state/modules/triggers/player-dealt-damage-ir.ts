/**
 * Oracle IR "whenever you're dealt [noncombat] damage" (player-subject dealt_damage).
 * Central noncombat hook: processPlayerDealtDamageTriggers (via resolvePlayerDamage) calls
 * this for noncombat damage; damage paths that bypass resolvePlayerDamage (IR damage diff,
 * loyalty templates, trigger opponent damage, mana-ability self damage) call it directly.
 * Combat damage stays with turnCombatDamageTriggerQueue, so this never runs for combat.
 * Public: queuePlayerDealtNoncombatDamageIR.
 */
import type { GameContext } from '../../context.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates } from './triggerConditionFamilyMatch.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';

/** Shorthand for damage paths outside resolvePlayerDamage (socket handlers, mana self damage). */
export function notifyNoncombatPlayerDamage(ctx: any, damagedPlayerId: string, damageAmount: number, sourcePermanent?: any): void {
  queuePlayerDealtNoncombatDamageIR(ctx, { damagedPlayerId, damageAmount, sourcePermanent });
}

export function queuePlayerDealtNoncombatDamageIR(
  ctx: GameContext,
  options: {
    damagedPlayerId: string;
    damageAmount: number;
    sourcePermanent?: any;
    /** Legacy triggers already queued for this event: [{ permanentId, effect }]. */
    legacyHits?: ReadonlyArray<{ permanentId: string; effect: string }>;
  },
): any[] {
  try {
    if (!ctx || (ctx as any).isReplaying) return [];
    const damagedPlayerId = String(options.damagedPlayerId || '').trim();
    const damageAmount = Number(options.damageAmount || 0);
    if (!damagedPlayerId || !(damageAmount > 0)) return [];
    const state = (ctx as any).state;
    const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const playerSubject = { id: 'player:' + damagedPlayerId, controller: damagedPlayerId, card: { type_line: '' } };
    const detected: any[] = [];
    for (const permanent of battlefield) {
      if (!permanent?.card) continue;
      const oracle = String(permanent.card.oracle_text || '');
      if (!/dealt\s+(?:noncombat\s+)?damage/i.test(oracle)) continue;
      const lines = collectMatchingParsedEventLines({
        ctx,
        oracleText: oracle,
        event: 'dealt_damage',
        subjectPermanent: playerSubject,
        subjectControllerId: damagedPlayerId,
        sourcePermanent: permanent,
        damageKind: 'noncombat',
        thatPlayerId: damagedPlayerId,
        matchContext: { subjectIsPlayer: true },
      } as any);
      for (const line of lines) {
        const cond: any = (line as any).condition || {};
        if (cond.playerSubject !== true) continue;
        if (cond.damageKind === 'combat') continue;
        const pid = String(permanent.id || '');
        if ((options.legacyHits || []).some((hit) => hit.permanentId === pid && parsedEffectDuplicates([hit.effect], line))) continue;
        if (detected.some((d) => d.permanentId === pid && d.effect === line.effect)) continue;
        detected.push({
          permanentId: pid,
          cardName: String(permanent.card?.name || 'Unknown'),
          controllerId: String(permanent.controller || ''),
          description: line.effect,
          effect: line.effect,
          mandatory: !/^you may\b/i.test(line.effect),
        });
      }
    }
    if (detected.length === 0) return [];
    const queued: any[] = [];
    for (const trigger of orderTriggersByAPNAP(ctx, detected)) {
      const item = queueGenericTriggeredAbility(ctx, trigger, 'you_are_dealt_damage', {
        damagedPlayerId,
        damageAmount,
        isCombatDamage: false,
        sourcePermanentId: String(options.sourcePermanent?.id || ''),
      });
      if (item) queued.push(item);
    }
    return queued;
  } catch {
    return [];
  }
}
