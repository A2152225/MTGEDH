import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { getSavedMayAbilityTriggerDecision } from '../../socket/trigger-shortcuts.js';
import { startEffectProgramResolution } from '../effects/index.js';
import type { EffectProgram, EffectProgramHandlers } from '../../../../rules-engine/src/effectProgram.js';
import { ChoiceEventType, type ChoiceResponse } from '../../../../rules-engine/src/choiceEvents.js';
import { applyGraveyardPermissionEffectsFromText } from './graveyard-permissions.js';
import { isControllerOptionalTriggeredAbilityEffect } from './trigger-runtime-wiring.js';
import { isPerPlayerOptionalEffectText } from '../../../../rules-engine/src/oracleIRPerPlayerOptional.js';
import {
  buildOptionalEffectKey,
  findMayAutoPreferenceEntry,
} from '../../../../shared/src/optionalEffectKey.js';
import {
  matchesNoUntilTargetsChangePreference,
  resolveNoUntilTargetsChangePreference,
} from '../../../../shared/src/mayAutoPreference.js';
import { resolveTriggerStackItemEffectText } from './triggerStackItemEffectText.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { collectTriggerExecutionSteps } from './oracleIrTriggerExecutionHelpers.js';
import { oracleIrEffectProgramWouldPresentOptionalMay } from './oracleIrEffectProgramServer.js';
import { recordDoThisOnlyOnceEachTurnOnAccept } from './triggerDoThisOnlyOnceEachTurn.js';
import { isNoOpOptionalCombatDamagePayLife } from '../../../../rules-engine/src/oracleIRExecutorCombatDamageCounts.js';

/** Set on ctx when an optional may is consumed via Always No / no-until / shortcut no. */
export const OPTIONAL_MAY_AUTO_DECLINED_FLAG = '__optionalMayAutoDeclined';

export function markOptionalMayAutoDeclined(ctx: GameContext): void {
  (ctx as any)[OPTIONAL_MAY_AUTO_DECLINED_FLAG] = true;
}

export function consumeOptionalMayAutoDeclined(ctx: GameContext): boolean {
  const flagged = (ctx as any)[OPTIONAL_MAY_AUTO_DECLINED_FLAG] === true;
  (ctx as any)[OPTIONAL_MAY_AUTO_DECLINED_FLAG] = false;
  return flagged;
}

/**
 * True when resolving this optional trigger would auto-decline without a prompt
 * (Always No, no-until-targets, or trigger-shortcut always_no). Side-effect free.
 */
export function wouldAutoDeclineOptionalTriggeredAbility(state: any, item: any): boolean {
  if (!item || (item as any).type !== 'triggered_ability') return false;
  if ((item as any).mandatory !== false) return false;
  if ((item as any).optionalTriggeredAbilityDecisionApplied === true) return false;

  const triggerController = String((item as any).controller || '').trim();
  const sourceName = String((item as any).sourceName || 'Unknown').trim();
  if (!triggerController || !sourceName) return false;

  const effectText = resolveTriggerStackItemEffectText(item, { state });
  const description = String((item as any).description || '').trim();
  const effectForOptionalCheck = String(effectText || description || '').trim();
  if (effectForOptionalCheck && isPerPlayerOptionalEffectText(effectForOptionalCheck)) {
    return false;
  }
  if (effectForOptionalCheck && !isControllerOptionalTriggeredAbilityEffect(effectForOptionalCheck)) {
    return false;
  }
  if (isNoOpOptionalCombatDamagePayLife(state, triggerController, effectForOptionalCheck)) {
    return true;
  }

  const savedTriggerDecision = getSavedMayAbilityTriggerDecision(state as any, triggerController, sourceName);
  if (savedTriggerDecision === 'yes') return false;
  if (savedTriggerDecision === 'no') return true;

  const effectKey = buildOptionalEffectKey(sourceName, effectForOptionalCheck);
  const mayPrefEntry = findMayAutoPreferenceEntry(
    state?.mayAutoPreferences?.[triggerController],
    effectKey,
  );
  const mayPref = mayPrefEntry?.value;
  if (mayPref === 'no') return true;
  if (mayPref === 'yes') return false;
  if (matchesNoUntilTargetsChangePreference(state, mayPref, effectForOptionalCheck)) {
    return true;
  }
  return false;
}

function normalizeOptionalTriggeredAbilityChoice(response: ChoiceResponse | undefined): 'yes' | 'no' {
  if (!response || response.cancelled) {
    return 'no';
  }

  const selections = response.selections;
  if (Array.isArray(selections)) {
    return selections.map((selection) => String(selection).trim().toLowerCase()).includes('yes') ? 'yes' : 'no';
  }

  return String(selections).trim().toLowerCase() === 'yes' ? 'yes' : 'no';
}

function appendOptionalTriggeredAbilityDecisionEvent(
  ctx: GameContext,
  gameId: string,
  payload: {
    readonly playerId: PlayerID;
    readonly sourceId?: string;
    readonly sourceName: string;
    readonly effectProgramId: string;
    readonly effectProgramStepId: string;
    readonly effectProgramBindingKey: string;
    readonly choiceResponse?: ChoiceResponse;
    readonly choice: 'yes' | 'no';
    readonly deferredTriggeredAbilityItem: any;
    readonly turnNumber?: number;
  },
): void {
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) {
    return;
  }

  Promise.resolve(appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0), 'optionalTriggeredAbilityChoice', {
    playerId: payload.playerId,
    sourceId: String(payload.sourceId || '').trim(),
    sourceName: payload.sourceName,
    effectProgram: {
      effectProgramId: payload.effectProgramId,
      effectProgramFamily: 'optional_triggered_ability',
      effectProgramSourceId: String(payload.sourceId || '').trim() || undefined,
      effectProgramSourceName: payload.sourceName,
      effectProgramStepId: payload.effectProgramStepId,
      effectProgramBindingKey: payload.effectProgramBindingKey,
    },
    choiceBinding: {
      bindingKey: payload.effectProgramBindingKey,
      response: payload.choiceResponse,
    },
    choice: payload.choice,
    ...(payload.turnNumber && payload.turnNumber > 0 ? { turnNumber: payload.turnNumber } : {}),
    deferredTriggeredAbilityItem: payload.deferredTriggeredAbilityItem,
  })).catch((err) => {
    debugWarn(1, '[resolveTopOfStack] appendEvent(optionalTriggeredAbilityChoice) failed:', err);
  });
}

export function queueOptionalTriggeredAbilityEffectProgram(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  effectText: string,
  description: string,
): void {
  const gameId = String((ctx as any).gameId || 'unknown');
  const resolvedSourceId = String((item as any)?.source || sourceId || '').trim() || undefined;
  const deferredTriggeredAbilityItem = {
    ...(item as any),
    optionalTriggeredAbilityDecisionApplied: true,
  };
  const programId = `optional-trigger:${resolvedSourceId || sourceName}:${String((item as any)?.id || Date.now())}`;
  const choiceBindingKey = `${programId}:decision`;
  const descriptionText = `You may: ${effectText || sourceName}`;

  const program: EffectProgram = {
    id: programId,
    controllerId: triggerController,
    sourceId: resolvedSourceId,
    sourceName,
    metadata: {
      family: 'optional_triggered_ability',
    },
    steps: [
      {
        id: `${programId}:choice`,
        kind: 'choice',
        bindingKey: choiceBindingKey,
        raw: effectText,
        choiceRequest: {
          type: ChoiceEventType.OPTION_CHOICE,
          playerId: triggerController,
          description: descriptionText,
          mandatory: false,
          sourceId: resolvedSourceId,
          sourceName,
          payload: {
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
            minSelections: 1,
            maxSelections: 1,
          },
        },
      },
      {
        id: `${programId}:resolve`,
        kind: 'command',
        raw: effectText,
        command: {
          kind: 'resolve_optional_triggered_ability',
          choiceBindingKey,
        },
      },
    ],
  };

  const handlers: EffectProgramHandlers<any> = {
    applyCommand: ({ state, runtime, step }) => {
      if ((step.command as any)?.kind !== 'resolve_optional_triggered_ability') {
        return state;
      }

      const bindingKey = String((step.command as any)?.choiceBindingKey || choiceBindingKey);
      const choiceResponse = runtime.bindings[bindingKey] as ChoiceResponse | undefined;
      const choice = normalizeOptionalTriggeredAbilityChoice(choiceResponse);
      const turnNumberForEvent = Number((ctx as any).state?.turnNumber ?? (ctx as any).state?.turn ?? 0) || 0;
      appendOptionalTriggeredAbilityDecisionEvent(ctx, gameId, {
        playerId: triggerController,
        sourceId: resolvedSourceId,
        sourceName,
        effectProgramId: programId,
        effectProgramStepId: `${programId}:choice`,
        effectProgramBindingKey: choiceBindingKey,
        choiceResponse,
        choice,
        deferredTriggeredAbilityItem,
        turnNumber: turnNumberForEvent > 0 ? turnNumberForEvent : undefined,
      });

      if (choice !== 'yes') {
        debug(2, `[resolveTopOfStack] Declined deferred optional triggered ability for ${sourceName}`);
        return state;
      }

      const ctxState = (ctx as any).state || state;
      const directlyApplied = applyGraveyardPermissionEffectsFromText(
        ctx,
        triggerController,
        sourceName,
        effectText || description,
        deferredTriggeredAbilityItem,
      );
      if (directlyApplied > 0) {
        debug(2, `[resolveTopOfStack] Applied deferred optional graveyard permission effect directly for ${sourceName}`);
        return ctxState;
      }

      ctxState.stack = Array.isArray(ctxState.stack) ? ctxState.stack : [];
      ctxState.stack.push(deferredTriggeredAbilityItem);

      return {
        state: (ctx as any).state || ctxState,
        events: [
          {
            kind: 'resolve_top_of_stack',
            sourceName,
          },
        ],
      };
    },
  };

  startEffectProgramResolution({
    game: ctx,
    gameId,
    program,
    handlers: handlers as any,
    state: (ctx as any).state,
    queueExtraConfig: {
      effectText,
      fullAbilityText: description,
      deferredTriggeredAbilityItem,
    },
  });
}

export function tryDeferOptionalTriggeredAbilityMayDecision(
  ctx: GameContext,
  item: any,
  state: any,
  options: {
    triggerController: PlayerID;
    sourceName: string;
    sourceId: string;
    effectText: string;
    description: string;
    optionalTriggeredAbilityDecisionApplied: boolean;
    bumpSeq: () => void;
  },
): boolean {
  if ((item as any).mandatory !== false || options.optionalTriggeredAbilityDecisionApplied) {
    return false;
  }

  const effectForOptionalCheck = String(options.effectText || options.description || '').trim();
  if (effectForOptionalCheck && isPerPlayerOptionalEffectText(effectForOptionalCheck)) {
    return false;
  }
  if (effectForOptionalCheck && !isControllerOptionalTriggeredAbilityEffect(effectForOptionalCheck)) {
    return false;
  }

  if (isNoOpOptionalCombatDamagePayLife(state, options.triggerController, effectForOptionalCheck)) {
    debug(2, `[resolveTopOfStack] Skipping no-op optional pay-X-life (X=0) for ${options.sourceName} (${options.triggerController})`);
    markOptionalMayAutoDeclined(ctx);
    options.bumpSeq();
    return true;
  }

  const savedTriggerDecision = getSavedMayAbilityTriggerDecision(state as any, options.triggerController, options.sourceName);
  if (savedTriggerDecision === 'yes') {
    (item as any).optionalTriggeredAbilityDecisionApplied = true;
    recordDoThisOnlyOnceEachTurnOnAccept(state, item);
    debug(2, `[resolveTopOfStack] Optional trigger shortcut auto-yes for ${options.sourceName} (${options.triggerController})`);
    return false;
  }
  if (savedTriggerDecision === 'no') {
    debug(2, `[resolveTopOfStack] Optional trigger shortcut auto-no for ${options.sourceName} (${options.triggerController})`);
    markOptionalMayAutoDeclined(ctx);
    options.bumpSeq();
    return true;
  }

  // Always No / Always Yes via MayAbilityModal (mayAutoPreferences) — decline before
  // queuing another Effect Program prompt. Checked here so a pending EP snapshot
  // cannot wipe the preference and re-prompt for each subsequent trigger.
  const effectKey = buildOptionalEffectKey(
    options.sourceName,
    String(options.effectText || options.description || '').trim(),
  );
  const mayPrefEntry = findMayAutoPreferenceEntry(
    state?.mayAutoPreferences?.[options.triggerController],
    effectKey,
  );
  const mayPref = mayPrefEntry?.value;
  if (mayPref === 'no') {
    debug(2, `[resolveTopOfStack] Optional mayAutoPreference auto-no for ${options.sourceName} (${options.triggerController})`);
    markOptionalMayAutoDeclined(ctx);
    options.bumpSeq();
    return true;
  }
  const noUntilChoice = resolveNoUntilTargetsChangePreference(
    state,
    options.triggerController,
    mayPrefEntry?.key || effectKey,
    mayPref,
    String(options.effectText || options.description || '').trim(),
  );
  if (noUntilChoice === 'no') {
    debug(2, `[resolveTopOfStack] Optional no-until-targets auto-no for ${options.sourceName} (${options.triggerController})`);
    markOptionalMayAutoDeclined(ctx);
    options.bumpSeq();
    return true;
  }
  if (mayPref === 'yes') {
    (item as any).optionalTriggeredAbilityDecisionApplied = true;
    recordDoThisOnlyOnceEachTurnOnAccept(state, item);
    debug(2, `[resolveTopOfStack] Optional mayAutoPreference auto-yes for ${options.sourceName} (${options.triggerController})`);
    return false;
  }

  if ((ctx as any).isReplaying) {
    return false;
  }

  // IR primary + Effect Program already owns the "you may" Yes/No during effect
  // resolution (Baral loot, etc.). Do not also queue a stack-level deferral prompt.
  // Always No / shortcuts above still apply; Always Yes sets decisionApplied and
  // proceeds with optionalOfferAccepted (EP may-choice collapsed).
  if (isOracleIrTriggerPrimaryEnabled()) {
    try {
      const irSteps = collectTriggerExecutionSteps(
        effectForOptionalCheck,
        options.sourceName,
        item,
      );
      if (oracleIrEffectProgramWouldPresentOptionalMay(irSteps)) {
        debug(
          2,
          `[resolveTopOfStack] Skipping stack optional deferral for ${options.sourceName}; ` +
            `IR Effect Program will present the may choice (${options.triggerController})`,
        );
        return false;
      }
    } catch (err) {
      debugWarn(1, `[resolveTopOfStack] IR optional-may ownership probe failed for ${options.sourceName}:`, err);
    }
  }

  queueOptionalTriggeredAbilityEffectProgram(
    ctx,
    item,
    options.triggerController,
    options.sourceName,
    options.sourceId,
    options.effectText,
    options.description,
  );
  debug(2, `[resolveTopOfStack] Deferred optional triggered ability prompt for ${options.sourceName} (${options.triggerController})`);
  return true;
}
