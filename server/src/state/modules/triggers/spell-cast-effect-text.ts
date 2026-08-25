/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover spell-cast effect-text helpers used by detectSpellCastTriggers
 * Public: extendSpellCopyEffectText, extractSpellCastEffect, normalizeSpellCastEffectText
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
export function extendSpellCopyEffectText(
  oracleText: string,
  matchedText: string,
  effectText: string,
  matchIndex?: number,
): string {
  const baseEffect = String(effectText || '').trim();
  const lowerBaseEffect = baseEffect.toLowerCase();
  let extendedEffect = baseEffect;

  const normalizedOracle = String(oracleText || '');
  const safeIndex = Number.isFinite(matchIndex as number)
    ? Number(matchIndex)
    : normalizedOracle.toLowerCase().indexOf(String(matchedText || '').toLowerCase());

  if ((lowerBaseEffect.includes('copy that spell') || lowerBaseEffect.includes('copy it')) && !lowerBaseEffect.includes('choose new targets for the copy') && safeIndex >= 0) {
    const trailingText = normalizedOracle.slice(safeIndex + String(matchedText || '').length);
    const retargetSentenceMatch = trailingText.match(/^\s*\.\s*(You may choose new targets? for the copy\.)/i);
    if (retargetSentenceMatch) {
      extendedEffect = `${extendedEffect} ${retargetSentenceMatch[1].trim()}`.trim();
    }
  }

  if (
    (lowerBaseEffect.includes('copy that spell') || lowerBaseEffect.includes('copy it'))
    && !lowerBaseEffect.includes('choose new targets for the copy')
    && /you may choose new targets? for the copy\.?/i.test(normalizedOracle)
    && !extendedEffect.toLowerCase().includes('choose new targets for the copy')
  ) {
    extendedEffect = `${extendedEffect} You may choose new targets for the copy.`.trim();
  }

  if (
    safeIndex >= 0
    && /from (?:your|a|any|an opponent['’]s|target opponent['’]s) graveyard to the battlefield/i.test(extendedEffect)
  ) {
    let trailingText = normalizedOracle.slice(safeIndex + String(matchedText || '').length);
    const riderPatterns = [
      /^\s*(?:\.\s*)?(It gains [^.]+\.)/i,
      /^\s*(?:\.\s*)?(Exile it at the beginning of [^.]+\.)/i,
      /^\s*(?:\.\s*)?(If it would leave the battlefield, [^.]+\.)/i,
    ];
    let matchedRider = true;
    while (matchedRider) {
      matchedRider = false;
      for (const pattern of riderPatterns) {
        const riderMatch = trailingText.match(pattern);
        if (!riderMatch) continue;
        const riderSentence = String(riderMatch[1] || '').trim();
        if (riderSentence && !extendedEffect.toLowerCase().includes(riderSentence.toLowerCase())) {
          extendedEffect = `${extendedEffect} ${riderSentence}`.trim();
        }
        trailingText = trailingText.slice(riderMatch[0].length);
        matchedRider = true;
        break;
      }
    }
  }

  return extendedEffect;
}

export function extractSpellCastEffect(
  oracleText: string,
  match: RegExpMatchArray,
  captureGroup: number,
): string {
  const matchIndex = Number.isFinite(match.index)
    ? Number(match.index)
    : oracleText.toLowerCase().indexOf(String(match[0] || '').toLowerCase());
  const execMatch = Object.assign([...match], {
    index: matchIndex >= 0 ? matchIndex : 0,
    input: oracleText,
  }) as RegExpExecArray;
  return extendSpellCopyEffectText(
    oracleText,
    match[0],
    timingTriggerEffect(oracleText, execMatch, captureGroup),
    matchIndex >= 0 ? matchIndex : undefined,
  );
}

export function normalizeSpellCastEffectText(
  oracleText: string,
  matchedText: string,
  rawEffect: string,
  matchIndex?: number,
): { effectText: string; optionalPaymentCost?: string; mandatory: boolean } {
  let effectText = extendSpellCopyEffectText(oracleText, matchedText, rawEffect, matchIndex);
  const optionalPaymentPattern = /you may pay ((?:\{[^}]+\})+)\.\s*(?:if|when) you do,?\s*(.+)/is;
  let mayPayMatch = effectText.match(optionalPaymentPattern);

  const safeIndex = Number.isFinite(matchIndex as number)
    ? Number(matchIndex)
    : oracleText.toLowerCase().indexOf(String(matchedText || '').toLowerCase());

  if (!mayPayMatch && /^you may pay /i.test(effectText) && safeIndex >= 0) {
    const trailingText = oracleText.slice(safeIndex + String(matchedText || '').length);
    const continuationMatch = trailingText.match(/^\.\s*if you do,?\s*([^.]+)/i);
    if (continuationMatch) {
      effectText = `${effectText}. If you do, ${String(continuationMatch[1] || '').trim()}`;
      mayPayMatch = effectText.match(optionalPaymentPattern);
    }
  }

  if (mayPayMatch) {
    return {
      effectText: String(mayPayMatch[2] || '').trim(),
      optionalPaymentCost: String(mayPayMatch[1] || '').trim(),
      mandatory: false,
    };
  }

  return {
    effectText,
    mandatory: !effectText.toLowerCase().includes('you may'),
  };
}
