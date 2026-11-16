// server/src/state/modules/counters_tokens-handlers/countersTokensJinnieFayApply.ts
// Apply a Jinnie Fay token-identity choice on a GameContext.
// Public: applyJinnieFayTokenChoiceOnContext.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { applyJinnieFayTokenChoice, type TokenChoiceFace } from '../replacementBatch93TokenReplacements.js';
import { createToken } from '../counters_tokens.js';

function asCtx(ctx: GameContext, gameId?: string): GameContext {
  const next: any = ctx;
  if (gameId && !next.gameId) next.gameId = gameId;
  if (typeof next.bumpSeq !== 'function') next.bumpSeq = () => {};
  return next;
}

export function applyJinnieFayTokenChoiceOnContext(ctx: GameContext, event: {
  playerId: string;
  choiceId?: string;
  cancelled?: boolean;
  faces?: TokenChoiceFace[];
  original?: any;
  gameId?: string;
}): { applied: boolean; choiceId: string; createdIds: string[]; tokenName: string; count: number } {
  const empty = { applied: false, choiceId: 'normal', createdIds: [] as string[], tokenName: '', count: 0 };
  const original = event?.original || {};
  const controllerId = String(original.controller || event?.playerId || '').trim();
  const tokenCount = Math.max(0, Math.floor(Number(original.count ?? 0)));
  if (!controllerId || tokenCount <= 0 || !ctx) return empty;

  const gameCtx = asCtx(ctx, event?.gameId);
  let choiceId = String(event?.choiceId || '').trim() || 'normal';
  if (event?.cancelled) choiceId = 'normal';

  let tokenName = String(original.name || 'Token');
  let power = original.basePower;
  let toughness = original.baseToughness;
  let options = { ...(original.options || {}), skipEventPersistence: true, skipTokenReplacements: true, skipJinnieFayReplacement: true };

  const faceMatch = /^face_(\d+)$/.exec(choiceId);
  if (faceMatch) {
    const faces: TokenChoiceFace[] = Array.isArray(event?.faces) ? event!.faces! : (original.faces || []);
    const chosen = applyJinnieFayTokenChoice(faces, Number(faceMatch[1]), tokenCount);
    if (chosen) {
      tokenName = chosen.name;
      power = chosen.power;
      toughness = chosen.toughness;
      options = {
        ...options,
        colors: chosen.colors,
        typeLine: chosen.typeLine && !String(chosen.typeLine).toLowerCase().startsWith('token')
          ? `Token ${chosen.typeLine}`
          : (chosen.typeLine || options.typeLine),
        abilities: chosen.keywords,
      };
    } else {
      choiceId = 'normal';
    }
  } else {
    choiceId = 'normal';
  }

  const createdIds = createToken(
    gameCtx,
    controllerId as PlayerID,
    tokenName,
    tokenCount,
    power,
    toughness,
    options,
    original.skipMirrormindReplacement === true,
  ) || [];

  const extras = Array.isArray(original.additionalTokens) ? original.additionalTokens : [];
  for (const extra of extras) {
    const extraCount = Math.max(0, Math.floor(Number(extra?.count || 0)));
    if (extraCount <= 0 || !extra?.name) continue;
    const extraIds = createToken(
      gameCtx,
      controllerId as PlayerID,
      String(extra.name),
      extraCount,
      extra.power,
      extra.toughness,
      {
        colors: extra.colors,
        typeLine: extra.typeLine,
        abilities: extra.abilities,
        skipEventPersistence: true,
        skipTokenReplacements: true,
        skipJinnieFayReplacement: true,
      },
      true,
    ) || [];
    createdIds.push(...extraIds);
  }

  if (typeof (gameCtx as any).bumpSeq === 'function') (gameCtx as any).bumpSeq();
  return { applied: true, choiceId, createdIds, tokenName, count: tokenCount };
}
