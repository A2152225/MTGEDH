// Origin parent: rules-engine/src/RulesEngineAdapter.ts
// Cluster moved: resolveStackTop.
// Public entry symbols: resolveStackTop.
// Class methods become thin wrappers that call these via .call(this, ...).
// Leaf must not import RulesEngineAdapter.ts or RulesEngineAdapter-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EngineResult } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { getColorsFromObject } from '../oracleIRExecutorManaUtils';
import {
  popFromStack,
  resolveStackObject,
  type Stack,
} from '../stackOperations';
import {
  buildResolutionEventDataFromGameState,
  buildTriggerEventDataFromPayloads,
  buildTriggeredAbilityChoiceEvents,
  evaluateTriggerCondition,
  executeTriggeredAbilityEffectWithOracleIR,
  type TriggerEventData,
} from '../triggeredAbilities';
import { applyTemporaryCantLoseAndOpponentsCantWinEffect } from '../winEffectCards';

/** Adapter instance passed as `this` from RulesEngineAdapter thin wrappers. */
export type AdapterResolveStackTopHost = any;

export function resolveStackTop(this: AdapterResolveStackTopHost, gameId: string): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const stack = this.stacks.get(gameId)!;
    const battlefieldBeforeResolution = Array.isArray(state.battlefield) ? [...state.battlefield] : [];
    
    const popResult = popFromStack(stack);
    
    if (!popResult.object) {
      return { next: state, log: ['Stack is empty'] };
    }
    
    const legalTargets = this.getLegalStackTargetIds(state, popResult.object);
    
    // Validate and resolve
    const resolveResult = resolveStackObject(popResult.object, legalTargets);
    
    this.stacks.set(gameId, popResult.stack);
    
    if (resolveResult.countered) {
      this.emit({
        type: RulesEngineEvent.SPELL_COUNTERED,
        timestamp: Date.now(),
        gameId,
        data: { object: popResult.object },
      });
    } else {
      this.emit({
        type: popResult.object.type === 'spell' 
          ? RulesEngineEvent.SPELL_RESOLVED 
          : RulesEngineEvent.ABILITY_RESOLVED,
        timestamp: Date.now(),
        gameId,
        data: { object: popResult.object },
      });
    }

    let nextState = state;
    const oracleLogs: string[] = [];
    const stackObjectAny = popResult.object as any;
    const spellTypeLine = String(stackObjectAny.card?.type_line || '').toLowerCase();
    const isPermanentSpell =
      popResult.object.type === 'spell' &&
      ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'].some(type =>
        spellTypeLine.includes(type)
      );
    if (!resolveResult.countered) {
      if (popResult.object.type === 'spell') {
        const spellOracleText = String(stackObjectAny.card?.oracle_text || '');
        const temporaryWinLossResult = applyTemporaryCantLoseAndOpponentsCantWinEffect(
          nextState,
          String(popResult.object.id || popResult.object.spellId || stackObjectAny.card?.id || `spell-${Date.now()}`),
          String(popResult.object.cardName || stackObjectAny.card?.name || 'Spell'),
          popResult.object.controllerId,
          popResult.object.controllerId,
          spellOracleText,
        );
        if (temporaryWinLossResult.applied) {
          nextState = temporaryWinLossResult.state;
          oracleLogs.push(...temporaryWinLossResult.log);
        }
      }

      const triggerMeta = popResult.object.triggerMeta;
      const effectText = triggerMeta?.effectText;

      if (!isPermanentSpell && effectText && effectText.trim().length > 0) {
        const normalizedStackTargets = Array.isArray(popResult.object.targets)
          ? legalTargets
              .map((id: any) => String(id || '').trim())
              .filter((id: string) => id.length > 0)
          : [];
        const dedupedStackTargets = Array.from(new Set(normalizedStackTargets));
        const playerIdSet = new Set((nextState.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean));
        const dedupedStackPlayerTargets = dedupedStackTargets.filter(id => playerIdSet.has(id));
        const dedupedStackOpponentTargets = dedupedStackPlayerTargets.filter(id => id !== popResult.object.controllerId);
        const dedupedStackPermanentTargets = dedupedStackTargets.filter(id => !playerIdSet.has(id));
        const normalizedEventData = buildTriggerEventDataFromPayloads(
          popResult.object.controllerId,
          triggerMeta.triggerEventDataSnapshot,
          {
            sourceId: popResult.object.spellId,
            sourceControllerId: popResult.object.controllerId,
            targets: legalTargets,
            affectedPlayerIds: dedupedStackPlayerTargets,
            affectedOpponentIds: dedupedStackOpponentTargets,
            ...(dedupedStackPermanentTargets.length === 1
              ? { targetPermanentId: dedupedStackPermanentTargets[0] }
              : {}),
          }
        );

        const executionEventData: TriggerEventData = {
          ...(triggerMeta.triggerEventDataSnapshot || {}),
          ...normalizedEventData,
          sourceId: normalizedEventData.sourceId ?? triggerMeta.triggerEventDataSnapshot?.sourceId ?? popResult.object.spellId,
          sourceObjectType: popResult.object.type === 'ability' ? 'ability' : 'spell',
          sourceControllerId:
            normalizedEventData.sourceControllerId ??
            triggerMeta.triggerEventDataSnapshot?.sourceControllerId ??
            popResult.object.controllerId,
          sourceColors: getColorsFromObject(stackObjectAny.card || stackObjectAny),
          spellType:
            normalizedEventData.spellType ??
            triggerMeta.triggerEventDataSnapshot?.spellType,
        };

        const resolutionEventData = buildResolutionEventDataFromGameState(
          nextState,
          popResult.object.controllerId,
          executionEventData
        );

        const resolvedInterveningIfClause = String(triggerMeta.interveningIfClause || '').trim() || undefined;
        if (triggerMeta.hasInterveningIf && !resolvedInterveningIfClause) {
          oracleLogs.push('[oracle-ir] Trigger skipped at resolution (intervening-if missing clause)');
          return {
            next: nextState,
            log: [...(resolveResult.log || [`Resolved ${popResult.object.cardName}`]), ...oracleLogs],
          };
        }

        if (resolvedInterveningIfClause) {
          const stillTrue = evaluateTriggerCondition(
            resolvedInterveningIfClause,
            popResult.object.controllerId,
            resolutionEventData
          );
          if (!stillTrue) {
            oracleLogs.push('[oracle-ir] Trigger skipped at resolution (intervening-if false)');
            return {
              next: nextState,
              log: [...(resolveResult.log || [`Resolved ${popResult.object.cardName}`]), ...oracleLogs],
            };
          }
        }

        const knownTriggerResult = this.resolveHelmOfTheHostTrigger(
          nextState,
          popResult.object,
          effectText,
          triggerMeta,
        );

        const executeResult = knownTriggerResult.handled
          ? {
              state: knownTriggerResult.state,
              log: knownTriggerResult.log,
              appliedSteps: [],
              skippedSteps: [],
              automationGaps: [],
              pendingOptionalSteps: [],
            }
          : executeTriggeredAbilityEffectWithOracleIR(
              nextState,
              {
                controllerId: popResult.object.controllerId,
                sourceId:
                  triggerMeta?.triggerEventDataSnapshot?.sourceId ??
                  popResult.object.spellId,
                sourceName: triggerMeta?.sourceName || popResult.object.cardName,
                effect: effectText,
              },
              resolutionEventData,
              { allowOptional: false }
            );

        const triggerChoiceEvents = buildTriggeredAbilityChoiceEvents(
          nextState,
          {
            controllerId: popResult.object.controllerId,
            sourceId: popResult.object.spellId,
            sourceName: triggerMeta?.sourceName || popResult.object.cardName,
            effect: effectText,
            optional: Boolean((popResult.object as any)?.triggerMeta?.optional),
          },
          resolutionEventData
        );

        const needsChoicePrompt =
          triggerChoiceEvents.length > 0 &&
          (((executeResult.pendingOptionalSteps || []).length > 0) || ((executeResult.skippedSteps || []).length > 0));

        nextState = executeResult.state;
        oracleLogs.push(...(executeResult.log || []));

        if ((executeResult.automationGaps || []).length > 0) {
          this.emit({
            type: RulesEngineEvent.ORACLE_AUTOMATION_GAP_RECORDED,
            timestamp: Date.now(),
            gameId,
            data: {
              stackObjectId: popResult.object.id,
              sourceId: popResult.object.spellId,
              sourceName: triggerMeta?.sourceName || popResult.object.cardName,
              controllerId: popResult.object.controllerId,
              count: executeResult.automationGaps.length,
              records: executeResult.automationGaps,
            },
          });
        }

        if (needsChoicePrompt) {
          this.emit({
            type: RulesEngineEvent.CHOICE_REQUIRED,
            timestamp: Date.now(),
            gameId,
            data: {
              stackObjectId: popResult.object.id,
              sourceId: popResult.object.spellId,
              sourceName: triggerMeta?.sourceName || popResult.object.cardName,
              effectText,
              controllerId: popResult.object.controllerId,
              choiceEvents: triggerChoiceEvents,
              triggerEventData: resolutionEventData,
            },
          });
          oracleLogs.push(`[oracle-ir] Trigger requires player choice: ${popResult.object.cardName}`);
        }

        const replicateCount = this.getReplicateCount(stackObjectAny);
        if (replicateCount > 0) {
          for (let copyIndex = 0; copyIndex < replicateCount; copyIndex += 1) {
            const copyResult = executeTriggeredAbilityEffectWithOracleIR(
              nextState,
              {
                controllerId: popResult.object.controllerId,
                sourceId: popResult.object.spellId,
                sourceName: triggerMeta?.sourceName || popResult.object.cardName,
                effect: effectText,
              },
              resolutionEventData,
              { allowOptional: false }
            );

            nextState = copyResult.state;
            oracleLogs.push(
              `[oracle-ir] Replicate copy ${copyIndex + 1}/${replicateCount} resolved for ${popResult.object.cardName}`
            );
            oracleLogs.push(...(copyResult.log || []));

            if ((copyResult.automationGaps || []).length > 0) {
              this.emit({
                type: RulesEngineEvent.ORACLE_AUTOMATION_GAP_RECORDED,
                timestamp: Date.now(),
                gameId,
                data: {
                  stackObjectId: popResult.object.id,
                  sourceId: popResult.object.spellId,
                  sourceName: triggerMeta?.sourceName || popResult.object.cardName,
                  controllerId: popResult.object.controllerId,
                  count: copyResult.automationGaps.length,
                  records: copyResult.automationGaps,
                },
              });
            }
          }
        }
      }
    }

    if (popResult.object.type === 'spell' && !isPermanentSpell) {
      const exileInsteadOfGraveyard = Boolean(
        stackObjectAny.exileInsteadOfGraveyard || stackObjectAny.card?.exileInsteadOfGraveyard
      );
      const returnToHandInsteadOfGraveyard = Boolean(
        stackObjectAny.returnToHandInsteadOfGraveyard || stackObjectAny.card?.returnToHandInsteadOfGraveyard
      );
      const castFromZone = String(
        stackObjectAny.castFromZone || stackObjectAny.card?.castFromZone || ''
      ).trim().toLowerCase();
      const reboundApplies =
        resolveResult.destination === 'graveyard' &&
        !exileInsteadOfGraveyard &&
        !returnToHandInsteadOfGraveyard &&
        castFromZone === 'hand' &&
        this.spellCardHasKeyword(stackObjectAny, 'rebound');
      const destinationZone =
        reboundApplies
          ? 'exile'
          : resolveResult.destination === 'graveyard' && exileInsteadOfGraveyard
          ? 'exile'
          : resolveResult.destination === 'graveyard' && returnToHandInsteadOfGraveyard
            ? 'hand'
          : resolveResult.destination;

      if (destinationZone === 'graveyard' || destinationZone === 'exile' || destinationZone === 'hand') {
        nextState = this.moveResolvedNonPermanentSpellToZone(nextState, stackObjectAny, destinationZone);
        if (reboundApplies && destinationZone === 'exile') {
          nextState = this.registerReboundDelayedTrigger(nextState, stackObjectAny);
          oracleLogs.push(
            `[oracle-ir] ${popResult.object.cardName} was exiled with Rebound and a delayed upkeep trigger was scheduled`
          );
        } else {
          oracleLogs.push(
            destinationZone === 'exile'
              ? `[oracle-ir] ${popResult.object.cardName} was exiled after leaving the stack`
              : destinationZone === 'hand'
                ? `[oracle-ir] ${popResult.object.cardName} was returned to its owner's hand after leaving the stack`
                : `[oracle-ir] ${popResult.object.cardName} was put into its owner's graveyard after leaving the stack`
          );
        }
      }
    } else if (popResult.object.type === 'spell' && isPermanentSpell && !resolveResult.countered) {
      nextState = this.moveResolvedPermanentSpellToBattlefield(nextState, stackObjectAny);
      oracleLogs.push(`[oracle-ir] ${popResult.object.cardName} entered the battlefield`);
    }

    const becameMonstrousResult = this.processBecameMonstrousTriggers(
      gameId,
      battlefieldBeforeResolution,
      nextState
    );
    nextState = becameMonstrousResult.next;
    oracleLogs.push(...(becameMonstrousResult.log || []));
    
    return {
      next: nextState,
      log: [...(resolveResult.log || [`Resolved ${popResult.object.cardName}`]), ...oracleLogs],
    };
  }

