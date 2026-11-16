/**
 * Origin: server/src/state/modules/onCastSpellTriggerUtils.ts
 * Cluster: ripple (CR 702.60), printed or granted (Thrumming Stone: "Spells you cast have ripple 4").
 * Public: parseRippleOnCastEffect, grantedRippleOnCastDescriptions, applyStackRippleTrigger
 *
 * Ripple N is an on-cast trigger: reveal the top N cards, cast any with the same name as the spell
 * without paying their mana costs, put the rest on the bottom. Resolution reuses the revealed-library
 * cast prompt (castRevealedFromLibraryChoice), which persists the library result for replay.
 */

import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { getGrantedSpellOrHandKeyword } from './batch95SpellAndHandKeywordGrants.js';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const RIPPLE_EFFECT = /^you may reveal the top (\w+) cards? of your library\.\s*you may cast spells with the same name as this spell\b/i;

/** N for a ripple on-cast effect ("you may reveal the top four cards of your library. You may cast spells with the same name..."). */
export function parseRippleOnCastEffect(effect: string): number | null {
  const m = RIPPLE_EFFECT.exec(String(effect || '').trim());
  if (!m) return null;
  const word = m[1].toLowerCase();
  const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS.indexOf(word);
  return n > 0 ? n : null;
}

/** On-cast trigger descriptions for ripple granted to the spell by a battlefield source. */
export function grantedRippleOnCastDescriptions(
  state: any,
  playerId: string,
  card: any,
): Array<{ description: string; effect: string }> {
  if (!state || !playerId || !card) return [];
  const grant = getGrantedSpellOrHandKeyword(state, playerId as any, card, 'ripple' as any, { zone: 'cast' } as any);
  const n = Math.floor(Number(grant?.numericValue) || 0);
  if (n <= 0) return [];
  const word = NUMBER_WORDS[n] || String(n);
  const effect = `you may reveal the top ${word} cards of your library. You may cast spells with the same name as this spell from among the revealed cards without paying their mana costs. Put the rest on the bottom of your library in any order.`;
  return [{ description: `When you cast this spell, ${effect}`, effect }];
}

function libraryOf(ctx: GameContext, playerId: string): any[] {
  const lib = (ctx as any)?.libraries?.get?.(playerId);
  if (Array.isArray(lib)) return lib;
  const fromZones = (ctx as any)?.state?.zones?.[playerId]?.library;
  return Array.isArray(fromZones) ? fromZones : [];
}

/** Resolves a ripple trigger: queues one cast-or-bottom prompt per same-name card (or one bottom prompt when none match). */
export function applyStackRippleTrigger(params: {
  ctx: GameContext;
  controller: string;
  sourceName: string;
  triggerItem: any;
}): boolean {
  const { ctx, controller, triggerItem } = params;
  if (String(triggerItem?.triggerType || '') !== 'ripple') return false;
  const gameId = String((ctx as any)?.gameId || '').trim();
  // Replay re-applies the persisted castRevealedFromLibraryResolve event instead of re-prompting.
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return true;
  const count = Math.floor(Number(triggerItem?.effectData?.rippleCount) || 0);
  const spellName = String(triggerItem?.effectData?.triggeringSpell?.name || params.sourceName || '').trim();
  if (count <= 0 || !spellName) return true;

  const revealed = libraryOf(ctx, controller).slice(0, count).map((card: any) => ({ ...card }));
  if (revealed.length === 0) return true;
  const sameName = (card: any) => String(card?.name || '').trim().toLowerCase() === spellName.toLowerCase();
  const hits = revealed.filter(sameName);
  const others = revealed.filter((card: any) => !sameName(card));
  const sourceName = `${spellName} (ripple ${count})`;
  const sourceId = String(triggerItem?.source || triggerItem?.sourceId || '').trim() || undefined;

  const queueStep = (hitCard: any, otherCards: any[], canCast: boolean) => {
    const cardName = String(hitCard?.name || 'a card').trim();
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controller as any,
      description: canCast
        ? `${sourceName}: You may cast ${cardName} without paying its mana cost.`
        : `${sourceName}: No revealed card has the same name. Put the revealed cards on the bottom of your library.`,
      mandatory: !canCast,
      sourceId,
      sourceName,
      options: canCast
        ? [{ id: 'cast', label: `Cast ${cardName}` }, { id: 'decline', label: `Put ${cardName} on the bottom of your library` }]
        : [{ id: 'decline', label: 'Put them on the bottom of your library' }],
      minSelections: 1,
      maxSelections: 1,
      castRevealedFromLibraryChoice: true,
      castRevealedFromLibraryCard: hitCard,
      castRevealedFromLibraryOtherCards: otherCards,
      castRevealedFromLibraryPlayerId: controller,
    } as any);
  };

  if (hits.length === 0) {
    queueStep(others[0], others.slice(1), false);
    return true;
  }
  hits.forEach((hit, index) => queueStep(hit, index === hits.length - 1 ? others : [], true));
  return true;
}