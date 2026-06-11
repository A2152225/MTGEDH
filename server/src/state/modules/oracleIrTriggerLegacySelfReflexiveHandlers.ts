import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { createToken, movePermanentToExile } from './counters_tokens.js';
import { attachEquipmentToCreature } from './triggerEquipmentUtils.js';
import { permanentIsCommanderCard, wasPermanentCardMovedToExile } from './triggerPermanentUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacySelfReflexiveParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly sourcePermanentIdForSelf: string;
}

export function applyRetiredTriggerLegacySelfExileCreateToken(
  params: TriggerLegacySelfReflexiveParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const selfExileCreateTokenMatch = String(params.desc || '').match(
    /^exile\s+(?:it|this(?:\s+(?:permanent|creature|card))?)\.\s*if\s+you\s+do,\s*create\s+(?:a|an|one)\s+(\d+)\/(\d+)\s+(?:(white|blue|black|red|green|colorless)\s+)?([a-z][a-z\s-]*?)\s+creature\s+token(?:\s+with\s+([^.]+))?\.?$/i,
  );
  if (!selfExileCreateTokenMatch || !params.sourcePermanentIdForSelf) {
    return false;
  }

  const sourcePermanent = Array.isArray(params.state.battlefield)
    ? params.state.battlefield.find((permanent: any) => String(permanent?.id || '') === params.sourcePermanentIdForSelf)
    : null;
  if (!sourcePermanent) {
    return true;
  }

  const permanentSnapshot = {
    ...(sourcePermanent as any),
    card: sourcePermanent.card && typeof sourcePermanent.card === 'object' ? { ...(sourcePermanent.card as any) } : sourcePermanent.card,
  };
  const gameId = String((params.ctx as any).gameId || '').trim();

  if (gameId && gameId !== 'unknown' && !(params.ctx as any).isReplaying && !permanentIsCommanderCard(params.ctx, sourcePermanent)) {
    try {
      appendEvent(gameId, Number((params.ctx as any).seq?.value ?? (params.ctx as any).seq ?? (params.state as any).seq ?? 0), 'exilePermanent', {
        permanentId: params.sourcePermanentIdForSelf,
        sourcePermanentId: params.sourcePermanentIdForSelf,
        sourceName: params.sourceName,
        reason: 'reflexive_self_exile_create_token',
      });
    } catch (err) {
      debugWarn(1, `[executeTriggerEffect] appendEvent(exilePermanent self-exile token reflexive) failed for ${params.sourceName}:`, err);
    }
  }

  movePermanentToExile(params.ctx, params.sourcePermanentIdForSelf);
  if (!wasPermanentCardMovedToExile(params.state, permanentSnapshot)) {
    return true;
  }

  const power = Number.parseInt(String(selfExileCreateTokenMatch[1] || '0'), 10);
  const toughness = Number.parseInt(String(selfExileCreateTokenMatch[2] || '0'), 10);
  const colorWord = String(selfExileCreateTokenMatch[3] || '').trim().toLowerCase();
  const tokenSubtypeRaw = String(selfExileCreateTokenMatch[4] || 'Creature').trim();
  const tokenSubtype = tokenSubtypeRaw.replace(/\b\w/g, (char) => char.toUpperCase());
  const abilityText = String(selfExileCreateTokenMatch[5] || '').trim();
  const colorMap: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const abilities = abilityText
    ? abilityText
        .split(/\s*(?:,|and)\s+/i)
        .map((ability) => ability.trim().replace(/\b\w/g, (char) => char.toUpperCase()))
        .filter(Boolean)
    : [];

  const tokenOptions = {
    colors: colorMap[colorWord] ? [colorMap[colorWord]] : [],
    typeLine: `Token Creature — ${tokenSubtype}`,
    abilities,
  };
  const createdTokenIds = createToken(params.ctx, params.controller, tokenSubtype, 1, power, toughness, tokenOptions);
  if (gameId && gameId !== 'unknown' && !(params.ctx as any).isReplaying) {
    for (const tokenId of createdTokenIds) {
      const tokenPermanent = Array.isArray(params.state.battlefield)
        ? params.state.battlefield.find((permanent: any) => String(permanent?.id || '') === String(tokenId))
        : null;
      if (!tokenPermanent) continue;
      try {
        appendEvent(gameId, Number((params.ctx as any).seq?.value ?? (params.ctx as any).seq ?? (params.state as any).seq ?? 0), 'executeEffect', {
          effectType: 'createToken',
          controllerId: params.controller,
          sourceId: params.sourcePermanentIdForSelf,
          sourceName: params.sourceName,
          reason: 'reflexive_self_exile_create_token',
          tokenData: {
            id: tokenPermanent.id,
            name: tokenSubtype,
            typeLine: tokenOptions.typeLine,
            power,
            toughness,
            colors: tokenOptions.colors,
            abilities,
          },
        });
      } catch (err) {
        debugWarn(1, `[executeTriggerEffect] appendEvent(executeEffect createToken self-exile reflexive) failed for ${params.sourceName}:`, err);
      }
    }
  }
  return true;
}

export function applyRetiredTriggerLegacyAttachToTargetCreatureYouControl(
  params: TriggerLegacySelfReflexiveParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (
    !/^attach\s+(?:it|this\s+(?:equipment|artifact)|~)\s+to\s+target\s+creature\s+you\s+control\b/i.test(String(params.desc || ''))
    || !params.sourcePermanentIdForSelf
  ) {
    return false;
  }

  const targetCreatureId = Array.isArray(params.triggerItem?.targets)
    ? String(params.triggerItem.targets[0] || '').trim()
    : '';
  if (!targetCreatureId) {
    return true;
  }

  attachEquipmentToCreature(params.ctx, params.state, params.controller, {
    equipmentId: params.sourcePermanentIdForSelf,
    targetCreatureId,
    sourceName: params.sourceName,
    equipmentName: params.sourceName,
  });
  return true;
}
