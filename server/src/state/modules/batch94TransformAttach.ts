// server/src/state/modules/batch94TransformAttach.ts
// B94: "As this permanent transforms into [Face], attach it to a player."
// (Curse of Leeches). The chosen player may be supplied; this module does
// not prompt. Public: parseTransformsAttachToPlayer, applyTransformAttachToPlayer.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const ATTACH_RE = /as this permanent transforms into .+, attach it to a player/i;

export function parseTransformsAttachToPlayer(oracle: string): boolean {
  return ATTACH_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function applyTransformAttachToPlayer(permanent: any, playerId?: string): { applied: boolean; needsPlayerChoice: boolean } {
  const oracle = readCardOracleText(permanent?.card || permanent);
  if (!parseTransformsAttachToPlayer(oracle)) return { applied: false, needsPlayerChoice: false };
  const pid = String(playerId || permanent?.transformAttachPlayerId || permanent?.chosenPlayerId || '').trim();
  if (!pid) return { applied: false, needsPlayerChoice: true };
  permanent.attachedTo = pid;
  permanent.enchantedPlayerId = pid;
  permanent.attachedToPlayerId = pid;
  return { applied: true, needsPlayerChoice: false };
}
