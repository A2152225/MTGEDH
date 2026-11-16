/**
 * IR emitter for "whenever a creature you control fights".
 * Called from applyFightDamageBetweenCreatures so every legal fight path fires
 * through IR exactly once per fighting creature.
 * Public: emitFightsTriggers.
 */
import type { GameContext } from '../../context.js';
import { collectMatchingParsedEventLines } from './triggerConditionFamilyMatch.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';

export function emitFightsTriggers(ctx: GameContext, creatureA: any, creatureB: any): any[] {
  if (!ctx || (ctx as any).isReplaying) return [];
  const battlefield: any[] = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
  if (battlefield.length === 0) return [];

  const seenFighters = new Set<string>();
  const fighters: any[] = [];
  for (const fighter of [creatureA, creatureB]) {
    const id = String(fighter?.id || '').trim();
    if (!id || seenFighters.has(id)) continue;
    seenFighters.add(id);
    fighters.push(fighter);
  }
  if (fighters.length === 0) return [];

  const queued: any[] = [];
  const fired = new Set<string>();
  for (const fighter of fighters) {
    for (const watcher of battlefield) {
      if (!watcher?.card) continue;
      for (const line of collectMatchingParsedEventLines({
        ctx,
        oracleText: String(watcher.card.oracle_text || ''),
        event: 'fights',
        subjectPermanent: fighter,
        subjectControllerId: String(fighter?.controller || ''),
        sourcePermanent: watcher,
      })) {
        const key = String(watcher.id || '') + ':' + String(fighter.id || '') + ':' + String(line.effect || '').toLowerCase();
        if (fired.has(key)) continue;
        fired.add(key);
        const item = queueGenericTriggeredAbility(ctx, {
          effect: line.effect,
          description: line.effect,
          controllerId: String(watcher.controller || ''),
          permanentId: String(watcher.id || ''),
          cardName: String(watcher.card?.name || 'Unknown'),
        }, 'fights', { fightingPermanentId: String(fighter.id || '') });
        if (item) queued.push(item);
      }
    }
  }
  return queued;
}
