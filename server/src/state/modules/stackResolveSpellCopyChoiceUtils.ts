import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, cardManaValue } from '../utils.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';

export function wasSpellCastFromGraveyard(item: any): boolean {
  if (!item) return false;

  const castWithAbility = String(item?.card?.castWithAbility || item?.castWithAbility || '').trim().toLowerCase();
  return item?.castFromGraveyard === true
    || item?.card?.castFromGraveyard === true
    || String(item?.castSourceZone || item?.card?.castSourceZone || '').trim().toLowerCase() === 'graveyard'
    || ['flashback', 'jump-start', 'retrace', 'escape', 'disturb', 'harmonize', 'graveyard-cast'].includes(castWithAbility);
}

export function shouldQueueResolvedSpellCopyChoice(item: any, oracleText: string): boolean {
  if (!item || item?.isCopy === true) {
    return false;
  }

  if (!wasSpellCastFromGraveyard(item)) {
    return false;
  }

  return /if\s+this\s+spell\s+was\s+cast\s+from\s+a\s+graveyard\s*,\s*you\s+may\s+copy\s+this\s+spell\s+and\s+may\s+choose\s+a\s+new\s+target\s+for\s+the\s+copy/i.test(
    String(oracleText || '').replace(/[\u2019]/g, "'"),
  );
}

export function buildResolvedSpellCopySnapshot(
  item: any,
  sourceName: string,
  controller: PlayerID,
): any {
  const copiedCard = item?.card && typeof item.card === 'object' && !Array.isArray(item.card)
    ? { ...(item.card as Record<string, any>) }
    : item?.card;

  if (copiedCard && typeof copiedCard === 'object' && !Array.isArray(copiedCard)) {
    copiedCard.zone = 'stack';
    copiedCard.ceaseOnResolution = true;
    copiedCard.ceaseOnCounter = true;
    copiedCard.castFromHand = false;
    copiedCard.castFromExile = false;
    copiedCard.castFromGraveyard = false;
    copiedCard.castFromLibrary = false;
    copiedCard.castFromRebound = false;
    copiedCard.castSourceZone = undefined;
    copiedCard.fromZone = undefined;
    copiedCard.source = undefined;
    copiedCard.castWithAbility = undefined;
  }

  return {
    ...item,
    id: uid('copied_spell'),
    type: String(item?.type || 'spell'),
    controller: String(item?.controller || controller),
    targets: Array.isArray(item?.targets)
      ? item.targets.map((target: any) => (
          target && typeof target === 'object' && !Array.isArray(target)
            ? { ...target }
            : target
        ))
      : item?.targets,
    card: copiedCard,
    spell: item?.spell ? { ...(item.spell as Record<string, any>) } : item?.spell,
    searchParams: item?.searchParams ? { ...(item.searchParams as Record<string, any>) } : item?.searchParams,
    targetRequirements: item?.targetRequirements
      ? { ...(item.targetRequirements as Record<string, any>) }
      : item?.targetRequirements,
    manaPayment: item?.manaPayment
      ? (Array.isArray(item.manaPayment) ? [...item.manaPayment] : { ...(item.manaPayment as Record<string, any>) })
      : item?.manaPayment,
    counterImmunity: item?.counterImmunity
      ? (Array.isArray(item.counterImmunity) ? [...item.counterImmunity] : { ...(item.counterImmunity as Record<string, any>) })
      : item?.counterImmunity,
    entersBattlefieldWithCounters: item?.entersBattlefieldWithCounters
      ? { ...(item.entersBattlefieldWithCounters as Record<string, any>) }
      : item?.entersBattlefieldWithCounters,
    copiedFromStackItemId: String(item?.id || '').trim() || undefined,
    copiedBySourceName: sourceName,
    isCopy: true,
    castFromHand: false,
    castFromExile: false,
    castFromGraveyard: false,
    castFromLibrary: false,
    castSourceZone: undefined,
    source: undefined,
  };
}

function buildSevinnesReclamationCopyRetargetTargets(
  ctx: GameContext,
  controller: PlayerID,
): Array<{ id: string; name: string; type: string; controller: string; zoneOwnerId: string; imageUrl?: string; typeLine?: string; isOpponent: boolean }> {
  const zones = (ctx.state as any)?.zones || {};
  const graveyard = Array.isArray(zones?.[controller]?.graveyard) ? zones[controller].graveyard : [];
  const permanentTypePattern = /\bartifact\b|\bcreature\b|\benchantment\b|\bland\b|\bplaneswalker\b|\bbattle\b/i;

  return graveyard
    .filter((entry: any) => {
      if (!entry?.id) return false;
      if (!permanentTypePattern.test(String(entry?.type_line || ''))) return false;
      return cardManaValue(entry) <= 3;
    })
    .map((entry: any) => ({
      id: String(entry.id),
      name: String(entry.name || 'Card'),
      type: 'card',
      controller: String(controller),
      zoneOwnerId: String(controller),
      imageUrl: entry?.image_uris?.small || entry?.image_uris?.normal,
      typeLine: entry?.type_line,
      isOpponent: false,
    }));
}

export function queueResolvedSpellCopyChoice(
  ctx: GameContext,
  item: any,
  controller: PlayerID,
  sourceName: string,
): void {
  const copiedSpellSnapshot = buildResolvedSpellCopySnapshot(item, sourceName, controller);
  const retargetValidTargets = buildSevinnesReclamationCopyRetargetTargets(ctx, controller);

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller,
    description: `${sourceName}: Copy this spell?`,
    mandatory: false,
    sourceId: String(item?.id || '').trim() || undefined,
    sourceName,
    options: [
      { id: 'yes', label: 'Copy spell' },
      { id: 'no', label: 'Do not copy' },
    ],
    minSelections: 1,
    maxSelections: 1,
    resolvedSpellCopyChoice: true,
    resolvedSpellCopySnapshot: copiedSpellSnapshot,
    resolvedSpellCopyRetargetValidTargets: retargetValidTargets,
    resolvedSpellCopyRetargetMinTargets: 1,
    resolvedSpellCopyRetargetMaxTargets: 1,
    resolvedSpellCopyRetargetTargetDescription: 'target permanent card with mana value 3 or less from your graveyard',
  } as any);
}
