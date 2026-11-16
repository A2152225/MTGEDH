// server/src/state/modules/counters_tokens-handlers/countersTokensJinnieFayQueue.ts
// Queue Jinnie Fay's optional "that many Cat or Dog tokens" replacement as an
// OPTION_CHOICE. Public: maybeQueueJinnieFayTokenChoice.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { summarizeTokenAmountReplacements } from '../replacementEffectSpec.js';
import {
  collectBatch93TokenReplacementSpecsFromState,
  type TokenChoiceFace,
} from '../replacementBatch93TokenReplacements.js';

export function maybeQueueJinnieFayTokenChoice(
  ctx: GameContext,
  controller: PlayerID | string,
  pending: {
    name: string;
    count: number;
    basePower?: number;
    baseToughness?: number;
    options?: any;
    skipMirrormindReplacement?: boolean;
  },
): boolean {
  if (!ctx || pending?.options?.skipJinnieFayReplacement === true) return false;
  if ((ctx as any)._suppressJinnieFayReplacement === true) return false;
  const gameId = String((ctx as any).gameId || '').trim();
  const isReplaying = Boolean((ctx as any).isReplaying);
  if (isReplaying || !gameId || gameId === 'unknown') return false;

  const playerId = String(controller || '').trim();
  const originalCount = Math.max(0, Math.floor(Number(pending?.count || 0)));
  if (!playerId || originalCount <= 0) return false;

  const specs = collectBatch93TokenReplacementSpecsFromState((ctx as any).state).filter((s: any) =>
    String(s.sourceController || '') === playerId && s.effectId === 'optional-token-identity-choice',
  );
  if (!specs.length) return false;
  const spec = specs[0];
  const faces: TokenChoiceFace[] = Array.isArray((spec.metadata as any)?.faces) ? (spec.metadata as any).faces : [];
  if (faces.length < 2) return false;

  const summary = summarizeTokenAmountReplacements((ctx as any).state, playerId, {
    tokenName: pending.name,
    tokenTypeLine: pending.options?.typeLine,
  });
  const tokensToCreate = Math.max(0, Math.floor((originalCount + Number(summary.extraTokens || 0)) * Number(summary.multiplier || 1)));
  if (tokensToCreate <= 0) return false;

  let tokenName = pending.name;
  let tokenPower = pending.basePower;
  let tokenToughness = pending.baseToughness;
  let tokenOptions = pending.options;
  const replaced = summary.replaceCreatedToken;
  if (replaced && (replaced as any).name) {
    tokenName = String((replaced as any).name);
    tokenPower = (replaced as any).power != null ? Number((replaced as any).power) : tokenPower;
    tokenToughness = (replaced as any).toughness != null ? Number((replaced as any).toughness) : tokenToughness;
    tokenOptions = {
      ...(pending.options || {}),
      typeLine: (replaced as any).typeLine || pending.options?.typeLine,
      colors: (replaced as any).colors || pending.options?.colors,
      abilities: (replaced as any).abilities || pending.options?.abilities,
    };
  }

  const additionalTokens = Array.isArray(summary.additionalTokens) ? summary.additionalTokens : [];
  const sourceName = String(spec.sourceName || 'Jinnie Fay, Jetmir\'s Second').trim() || 'Jinnie Fay, Jetmir\'s Second';
  const sourceId = String(spec.sourcePermanentId || 'jinnie-fay').trim();

  const faceOptions = faces.map((face, index) => ({
    id: `face_${index}`,
    label: `Create ${tokensToCreate} ${face.power}/${face.toughness} ${face.name} token${tokensToCreate === 1 ? '' : 's'}${face.keyword ? ` with ${face.keyword}` : ''}`,
  }));
  const optionNormal = {
    id: 'normal',
    label: `Create the normal ${tokensToCreate} token${tokensToCreate === 1 ? '' : 's'} (${tokenName})`,
  };

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    description: `${sourceName}: You may instead create that many 2/2 Cat tokens with haste or that many 3/1 Dog tokens with vigilance.`,
    mandatory: true,
    sourceId,
    sourceName,
    jinnieFayTokenChoice: true,
    jinnieFayFaces: faces,
    jinnieFayOriginalTokenCreate: {
      controller: playerId,
      name: tokenName,
      count: tokensToCreate,
      basePower: tokenPower,
      baseToughness: tokenToughness,
      options: {
        ...(tokenOptions || {}),
        skipEventPersistence: true,
        skipTokenReplacements: true,
        skipJinnieFayReplacement: true,
      },
      additionalTokens,
      skipMirrormindReplacement: pending.skipMirrormindReplacement === true,
    },
    options: [...faceOptions, optionNormal],
  } as any);
  return true;
}
