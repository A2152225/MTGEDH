/**
 * socket/game-actions-handlers/castModalModeTargetAvailability.ts
 *
 * CR 700.2a / 601.2c: a mode that requires targets can be chosen only when every target
 * it needs has a legal choice. Modal-spell prompts used to offer every mode, so the AI (and
 * players) could pick "Destroy target nonbasic land" with no nonbasic land in play and the
 * cast then died on NO_VALID_TARGETS after the mode prompt. This drops such modes from the
 * offered list before MODE_SELECTION is queued.
 *
 * Conservative: X-count modes, parse failures and "fewer legal modes than the minimum"
 * keep the original option list (the existing downstream checks still apply).
 *
 * Public entry symbols: restrictModalModesToLegalTargets.
 */
import { evaluateTargeting } from "../../rules-engine/targeting";
import type { extractModalModesForSpellCast } from "../../utils/oraclePromptContext.js";
import { reportHookFailure } from "../../../../shared/src/hookFailureReporter.js";
import { resolveCastSpellParsedTargeting } from "./gameActionsCastSpellParsedTargeting.js";
import { getOracleTextForCastMode } from "./gameActionsModalCastModeCosts.js";
import {
  buildSpellTargetListFromRequirements,
  buildSpellTargetSelectionClauses,
} from "./gameActionsSpellTargetSelection.js";

type ModalInfo = ReturnType<typeof extractModalModesForSpellCast>;

function modeHasLegalTargets(game: any, playerId: string, cardName: string, modeText: string): boolean {
  const { spellSpec, targetReqs, preferParsedTargetReqs } = resolveCastSpellParsedTargeting({
    cardName,
    oracleText: modeText,
    gameState: game.state,
    controllerId: playerId,
  });
  const useSpec = Boolean(spellSpec) && !preferParsedTargetReqs;
  const reqSource: any = useSpec ? spellSpec : targetReqs;
  if (reqSource?.minTargetsIsX || reqSource?.maxTargetsIsX) return true;
  const minTargets = Number(reqSource?.minTargets || 0);
  const needs = useSpec ? minTargets > 0 : Boolean(targetReqs?.needsTargets) && minTargets > 0;
  if (!needs) return true;
  if ((targetReqs as any)?.perOpponent || (targetReqs as any)?.groupedTargets) return true;

  const clauses = buildSpellTargetSelectionClauses(game, playerId, cardName, modeText);
  if (clauses.length > 1) {
    return clauses.every((clause) => clause.validTargetList.length >= clause.minTargets);
  }
  const list = useSpec
    ? evaluateTargeting(game.state as any, playerId as any, spellSpec as any)
    : buildSpellTargetListFromRequirements(game, playerId, targetReqs);
  return list.length >= minTargets;
}

/** Offer only modes whose targets can be chosen now (modal "Choose one/two" spells). */
export function restrictModalModesToLegalTargets(
  modalSpellInfo: ModalInfo,
  state: any,
  playerId: string,
  oracleText: string,
  cardName: string,
): ModalInfo {
  if (!modalSpellInfo || !Array.isArray(modalSpellInfo.options) || modalSpellInfo.options.length === 0) return modalSpellInfo;
  if (!state || !Array.isArray(state.battlefield)) return modalSpellInfo;
  try {
    const game = { state };
    const legal = modalSpellInfo.options.filter((option: any) => {
      const id = String(option?.id ?? '');
      if (!id) return true;
      const modeText = getOracleTextForCastMode(oracleText, false, [id], undefined, cardName).toLowerCase();
      if (!/\btargets?\b/.test(modeText)) return true;
      return modeHasLegalTargets(game, playerId, cardName, modeText);
    });
    if (legal.length === modalSpellInfo.options.length) return modalSpellInfo;
    const minModes = Number(modalSpellInfo.minModes ?? 1);
    if (legal.length === 0 || legal.length < minModes) return modalSpellInfo;
    const maxModes = Number(modalSpellInfo.maxModes);
    return {
      ...modalSpellInfo,
      options: legal,
      ...(Number.isFinite(maxModes) && maxModes > legal.length ? { maxModes: legal.length } : {}),
      // Entwine means choosing every mode; impossible once one has no legal target.
      entwineCost: undefined,
    } as ModalInfo;
  } catch (err) {
    reportHookFailure('cast.modalModeTargetAvailability', err, { source: 'castModalModeTargetAvailability', cardName });
    return modalSpellInfo;
  }
}
