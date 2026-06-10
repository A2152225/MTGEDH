import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debugWarn } from '../../utils/debug.js';
import { ResolutionStepType } from '../resolution/index.js';
import { listLocalCardNamesForChoiceSyncIfReady, parseCardNameChoiceCriteriaFromOracleText } from '../../services/localCardLookup.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';

export function tryResolveAcademicProbationSpellEffects(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    targets: any[];
    selectedModes: any[];
    isReplaying: boolean;
  },
): boolean {
  const isAcademicProbation = String(options.effectiveCard?.name || '').toLowerCase() === 'academic probation';
  if (!isAcademicProbation) {
    return false;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const targets = options.targets;
  const selectedModes = options.selectedModes;
  const isReplaying = options.isReplaying;

  const currentTurn = Number(state?.turnNumber ?? 0) || 0;
  const selectedModeSet = new Set(selectedModes.map((mode: any) => String(mode || '')));
  const usesChosenNameMode = selectedModeSet.has('mode_1');
  const usesPermanentMode = selectedModeSet.has('mode_2');

  if (usesChosenNameMode) {
    const chosenCardName = String(item?.chosenCardName || card?.chosenCardName || '').trim();

    if (!chosenCardName && !isReplaying) {
      const modeText = 'Choose a nonland card name. Opponents can\'t cast spells with the chosen name until your next turn.';
      const cardNameChoiceCriteria = parseCardNameChoiceCriteriaFromOracleText(modeText);
      let candidateNames: string[] | undefined;

      try {
        candidateNames = listLocalCardNamesForChoiceSyncIfReady(cardNameChoiceCriteria);
      } catch (err) {
        debugWarn(1, `[tryResolveAcademicProbationSpellEffects] Failed to gather Academic Probation card-name candidates:`, err);
      }

      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.CARD_NAME_CHOICE,
        playerId: controller,
        description: `Choose a nonland card name for ${effectiveCard.name}`,
        mandatory: true,
        sourceId: card?.id || effectiveCard.id,
        sourceName: effectiveCard.name || 'Spell',
        sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
        spellId: card?.id || effectiveCard.id,
        cardName: effectiveCard.name,
        reason: `Choose a nonland card name for ${effectiveCard.name}`,
        restrictionText: cardNameChoiceCriteria.restrictionText,
        candidateNames,
      } as any);

      state.stack = state.stack || [];
      state.stack.push(item);
      return true;
    }

    if (chosenCardName) {
      const stateAny = state as any;
      stateAny.untilNextTurnSpellNameCastRestrictions = Array.isArray(stateAny.untilNextTurnSpellNameCastRestrictions)
        ? stateAny.untilNextTurnSpellNameCastRestrictions
        : [];

      const alreadyApplied = stateAny.untilNextTurnSpellNameCastRestrictions.some((entry: any) =>
        String(entry?.sourceId || '') === String(card?.id || effectiveCard.id || '') &&
        String(entry?.chosenCardName || entry?.chosenName || '') === chosenCardName,
      );

      if (!alreadyApplied) {
        stateAny.untilNextTurnSpellNameCastRestrictions.push({
          sourceId: card?.id || effectiveCard.id,
          sourceName: effectiveCard.name,
          chosenCardName,
          controllerId: controller,
          turnApplied: currentTurn,
          opponentsOnly: true,
        });
      }
    }
  }

  if (usesPermanentMode) {
    const targetPermanentId = String(typeof targets[0] === 'string' ? targets[0] : targets[0]?.id || '').trim();
    const targetPermanent = targetPermanentId
      ? (state.battlefield || []).find((perm: any) => perm && String(perm.id || '') === targetPermanentId)
      : undefined;

    if (targetPermanent) {
      const grantText = "This permanent can't attack or block (until your next turn)";

      targetPermanent.grantedAbilities = Array.isArray(targetPermanent.grantedAbilities)
        ? targetPermanent.grantedAbilities
        : [];
      if (!targetPermanent.grantedAbilities.includes(grantText)) {
        targetPermanent.grantedAbilities.push(grantText);
      }

      targetPermanent.untilNextTurnGrants = Array.isArray(targetPermanent.untilNextTurnGrants)
        ? targetPermanent.untilNextTurnGrants
        : [];
      targetPermanent.untilNextTurnGrants.push({
        controllerId: controller,
        turnApplied: currentTurn,
        grantedAbilities: [grantText],
        sourceName: effectiveCard.name,
        kind: 'cant_attack_or_block',
      });

      targetPermanent.untilNextTurnCantActivateAbilities = Array.isArray(targetPermanent.untilNextTurnCantActivateAbilities)
        ? targetPermanent.untilNextTurnCantActivateAbilities
        : [];
      targetPermanent.untilNextTurnCantActivateAbilities.push({
        controllerId: controller,
        turnApplied: currentTurn,
        sourceName: effectiveCard.name,
        kind: 'cant_activate_abilities',
      });
    }
  }

  return false;
}
