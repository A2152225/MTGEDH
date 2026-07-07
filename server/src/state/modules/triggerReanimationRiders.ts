import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { isCommanderGrantBackgroundOracle } from './battlefieldAbilityBadges.js';
import { getNextEndStepFireTurnNumber } from './triggerDelayedEffectUtils.js';

function applyReanimatedPermanentLeaveBattlefieldRiders(
  ctx: GameContext,
  permanent: any,
  sourceName: string,
  controller: PlayerID,
  fullText: string,
): void {
  const normalizedText = String(fullText || '')
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalizedText || !permanent) {
    return;
  }

  const stateAny = (ctx as any).state as any;
  if (!stateAny) {
    return;
  }

  if (/\bexile\s+(?:it|that card|that creature|that permanent)\s+at\s+the\s+beginning\s+of\s+(?:the|your)\s+next\s+end\s+step\b/i.test(normalizedText)) {
    stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
      ? stateAny.pendingExileAtNextEndStep
      : [];
    const pendingExileAtNextEndStep = stateAny.pendingExileAtNextEndStep as any[];
    if (!pendingExileAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === String(permanent.id || ''))) {
      pendingExileAtNextEndStep.push({
        permanentId: String(permanent.id || ''),
        fireAtTurnNumber: getNextEndStepFireTurnNumber(stateAny),
        sourceName: String(sourceName || 'Delayed trigger'),
        createdBy: String(controller || permanent?.controller || permanent?.owner || ''),
      });
    }
  }

  if (/\bif\s+it\s+would\s+leave\s+the\s+battlefield,\s*exile\s+it\s+instead\s+of\s+putting\s+it\s+anywhere\s+else\b/i.test(normalizedText)) {
    permanent.leaveBattlefieldReplacementDestination = 'exile';
    if (String(sourceName || '').trim()) {
      permanent.leaveBattlefieldReplacementSourceName = String(sourceName).trim();
    }
    permanent.card = {
      ...(permanent.card || {}),
      leaveBattlefieldReplacementDestination: 'exile',
      ...(String(sourceName || '').trim()
        ? { leaveBattlefieldReplacementSourceName: String(sourceName).trim() }
        : {}),
    };
  }
}

export function applyPermanentKeywordGrantFromText(
  permanent: any,
  sourceName: string,
  fullText: string,
  targetLabel?: string,
): boolean {
  if (!permanent) return false;

  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const oracleText = String(permanent?.card?.oracle_text || fullText || '');
  if (typeLine.includes('background') && isCommanderGrantBackgroundOracle(oracleText)) {
    return false;
  }

  try {
    const KEYWORD_GRANT_VOCAB_TRIG = [
      'indestructible', 'haste', 'flying', 'trample', 'lifelink', 'deathtouch',
      'vigilance', 'menace', 'reach', 'first strike', 'double strike',
      'hexproof', 'shroud', 'flash', 'defender',
    ];
    const grantPattern = /(?:that\s+(?:creature|permanent|card)|it)\s+gains?\s+([^.]+)/gi;
    const granted: string[] = [];
    let gm: RegExpExecArray | null;
    while ((gm = grantPattern.exec(fullText)) !== null) {
      const list = String(gm[1] || '').toLowerCase();
      for (const kw of KEYWORD_GRANT_VOCAB_TRIG) {
        const escapedKw = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        if (new RegExp(`\\b${escapedKw}\\b`, 'i').test(list)) granted.push(kw);
      }
    }
    if (granted.length > 0) {
      permanent.grantedAbilities = Array.isArray(permanent.grantedAbilities) ? permanent.grantedAbilities : [];
      for (const kw of granted) {
        if (!permanent.grantedAbilities.some((a: any) => String(a || '').toLowerCase() === kw)) {
          permanent.grantedAbilities.push(kw);
        }
      }
      if (granted.includes('haste')) {
        permanent.summoningSickness = false;
      }
      debug(2, `[applyPermanentKeywordGrantFromText] ${sourceName} granted [${granted.join(', ')}] to ${targetLabel || permanent.card?.name || permanent.id}`);
      return true;
    }
  } catch (err) {
    debugWarn(1, '[applyPermanentKeywordGrantFromText] keyword-grant rider failed:', err);
  }

  return false;
}

export function applyTriggeredReanimationEntryRiders(
  ctx: GameContext,
  permanent: any,
  sourceName: string,
  controller: PlayerID,
  fullText: string,
  targetLabel?: string,
): void {
  applyReanimatedPermanentLeaveBattlefieldRiders(ctx, permanent, sourceName, controller, fullText);
  applyPermanentKeywordGrantFromText(permanent, sourceName, fullText, targetLabel);
}
