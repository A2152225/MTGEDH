/**
 * Saga chapter abilities that trigger as the Saga enters (CR 714.3a / 714.2c): a Saga enters with
 * a lore counter, and going from 0 to N lore counters triggers every chapter up to N (only
 * chapter N for read ahead, CR 702.155c). The precombat-main lore step queues later chapters;
 * this covers entry on every path (cast, reanimate, flicker, manual put) by noticing Sagas the
 * previous SBA pass had not seen. The seen-set is refreshed while replaying but nothing queues.
 * Public entry symbols: queueSagaEntryChapterTriggers.
 */
import type { GameContext } from '../context.js';
import { parseSagaChapters } from './upkeep-triggers.js';
import { appendEvent } from '../../db/index.js';
import { uid } from '../utils.js';

function isSaga(perm: any): boolean {
  return /\bsaga\b/i.test(String(perm?.card?.type_line || '')) && perm?.faceDown !== true;
}

export function queueSagaEntryChapterTriggers(ctx: GameContext): number {
  const state = (ctx as any)?.state;
  if (!state) return 0;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const prevSeen: string[] = Array.isArray(state._sagaEntrySeen) ? state._sagaEntrySeen : [];
  if (prevSeen.length === 0 && !battlefield.some(isSaga)) return 0;
  const seen = new Set(prevSeen);
  const nextSeen: string[] = [];
  const entered: any[] = [];
  for (const perm of battlefield) {
    if (!isSaga(perm)) continue;
    const id = String(perm?.id || '').trim();
    if (!id) continue;
    nextSeen.push(id);
    if (!seen.has(id)) entered.push(perm);
  }
  state._sagaEntrySeen = nextSeen;
  if ((ctx as any)?.isReplaying || entered.length === 0) return 0;

  let queued = 0;
  for (const perm of entered) {
    const lore = Number(perm?.counters?.lore ?? 0) || 0;
    if (lore <= 0) continue;
    const oracle = String(perm?.card?.oracle_text || '');
    const chapters = parseSagaChapters(oracle);
    if (chapters.length === 0) continue;
    const maxChapter = Math.max(...chapters.map((c) => c.chapter));
    const readAhead = /\bread ahead\b/i.test(oracle);
    for (const chapter of chapters.filter((c) => (readAhead ? c.chapter === lore : c.chapter <= lore)).sort((a, b) => a.chapter - b.chapter)) {
      const sagaData = { sagaChapter: chapter.chapter, sagaSacrificeAfterResolve: chapter.chapter >= maxChapter };
      const controller = String(perm.controller || perm.owner || '');
      const triggerId = uid('saga_chapter');
      const base = {
        id: triggerId, type: 'triggered_ability', controller, source: String(perm.id), permanentId: String(perm.id),
        sourceName: String(perm.card?.name || 'Saga'), description: chapter.effect, effect: chapter.effect,
        triggerType: 'saga_chapter', mandatory: true, triggeringPlayer: controller,
      };
      state.stack = Array.isArray(state.stack) ? state.stack : [];
      state.stack.push({ ...base, ...sagaData, effectData: sagaData });
      queued++;
      const gameId = String((ctx as any)?.gameId || '').trim();
      if (gameId && gameId !== 'unknown') {
        try {
          appendEvent(gameId, Number(state.seq ?? 0), 'pushTriggeredAbility', {
            triggerId, sourceId: base.source, permanentId: base.permanentId, sourceName: base.sourceName,
            controllerId: controller, description: base.description, effect: base.effect,
            triggerType: 'saga_chapter', mandatory: true, triggeringPlayer: controller, effectData: sagaData,
          });
        } catch { /* best-effort persistence */ }
      }    }
  }
  return queued;
}