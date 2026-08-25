// server/src/state/modules/apply-event-handlers/applyEventActivateBattlefieldAbilityStackReplay.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts
// (activateBattlefieldAbility case body cluster).
//
// Cluster: Rebuild stack items and copy-retarget evidence for battlefield activations.
// Public entry: applyActivateBattlefieldAbilityStackReplay(ctx, e)
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { generateDeterministicId } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { consumeRecordedManaCostFromPool } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";

export function applyActivateBattlefieldAbilityStackReplay(ctx: GameContext, e: GameEvent): void {
  const stateAny = ctx.state as any;
  const playerId = (e as any).playerId;
  const permId = (e as any).permanentId;
  const abilityId = (e as any).abilityId;
  const abilityText = String((e as any).abilityText || '');
  const activatedAbilityText = String((e as any).activatedAbilityText || '');
  const activatedAbilityIndex = Number((e as any).activatedAbilityIndex);


          try {
            const retargetValidTargets = Array.isArray((e as any).copyRetargetValidTargets) ? (e as any).copyRetargetValidTargets : null;
            const retargetTargetTypes = Array.isArray((e as any).copyRetargetTargetTypes) ? (e as any).copyRetargetTargetTypes : null;
            const retargetMinTargets = Number((e as any).copyRetargetMinTargets ?? NaN);
            const retargetMaxTargets = Number((e as any).copyRetargetMaxTargets ?? NaN);
            const retargetTargetDescription = String((e as any).copyRetargetTargetDescription || '');
            const persistedTargets = Array.isArray((e as any).targets) ? (e as any).targets : null;
            const persistedStackItemId = String((e as any).stackItemId || '').trim();
            const persistedTapUntapAction = String((e as any).tapUntapAction || '').trim().toLowerCase();
            const persistedAbilityType = String((e as any).abilityType || (e as any).abilityId || '').trim().toLowerCase();
            const isEquipActivation = persistedAbilityType === 'equip';
            const isFortifyActivation = persistedAbilityType === 'fortify';
            const isFightActivation = persistedAbilityType === 'fight';
            const isAddCounterActivation = persistedAbilityType === 'add_counter';
            const isLevelUpActivation = persistedAbilityType === 'level_up';
            const isOutlastActivation = persistedAbilityType === 'outlast';
            const isMonstrosityActivation = persistedAbilityType === 'monstrosity';
            const isAdaptActivation = persistedAbilityType === 'adapt';
            const isReconfigureAttachActivation = persistedAbilityType === 'reconfigure_attach';
            const isReconfigureUnattachActivation = persistedAbilityType === 'reconfigure_unattach';
            const persistedUsesStack = (e as any).usesStack === true;
            // Explicit usesStack:false means live already applied (or deferred via discrete events);
            // do not invent a stack item from cost evidence alone.
            const explicitNonStack = (e as any).usesStack === false;
            const replayAbilityDescription = String(abilityText || '').trim()
              || (persistedUsesStack && activatedAbilityText.includes(':')
                ? activatedAbilityText.split(':').slice(1).join(':').trim()
                : '');
            const tappedPermanentsForCost = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            const tappedOtherPermanentForCost = playerId != null && permId != null
              ? tappedPermanentsForCost.some((id: string) => id !== String(permId))
              : tappedPermanentsForCost.length > 0;
            const hasInteractiveCostEvidence =
              tappedOtherPermanentForCost ||
              Boolean(Array.isArray((e as any).discardedCardIds) && (e as any).discardedCardIds.length > 0) ||
              Boolean(Array.isArray((e as any).exiledCardIdsFromHandForCost) && (e as any).exiledCardIdsFromHandForCost.length > 0) ||
              Boolean(Array.isArray((e as any).returnedPermanentsToHandForCost) && (e as any).returnedPermanentsToHandForCost.length > 0) ||
              Boolean(Array.isArray((e as any).sacrificedPermanents) && (e as any).sacrificedPermanents.length > 0) ||
              Boolean(Array.isArray((e as any).removedCountersForCost) && (e as any).removedCountersForCost.length > 0) ||
              Boolean(Number((e as any).lifePaidForCost || 0) > 0);
            const shouldRebuildStack = !explicitNonStack && Boolean(replayAbilityDescription || activatedAbilityText) && playerId != null && permId != null && (
              isEquipActivation ||
              isFortifyActivation ||
              isFightActivation ||
              isAddCounterActivation ||
              isLevelUpActivation ||
              isOutlastActivation ||
              isMonstrosityActivation ||
              isAdaptActivation ||
              isReconfigureAttachActivation ||
              isReconfigureUnattachActivation ||
              persistedUsesStack ||
              Boolean(persistedTargets && persistedTargets.length > 0) ||
              (Boolean(activatedAbilityText) && hasInteractiveCostEvidence)
            );
            const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
            if (shouldRebuildStack) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId));
              const existingStackItem = Array.isArray(stack)
                ? stack.find((item: any) =>
                    item &&
                    String(item.type || '') === 'ability' &&
                    (
                      (persistedStackItemId && String(item.id || '') === persistedStackItemId) ||
                      (
                        String(item.controller || '') === String(playerId) &&
                        String(item.source || '') === String(permId) &&
                        (!replayAbilityDescription || String(item.description || '') === replayAbilityDescription)
                      )
                    )
                  )
                : null;

              if (existingStackItem && persistedStackItemId && String((existingStackItem as any).id || '') !== persistedStackItemId) {
                (existingStackItem as any).id = persistedStackItemId;
              }

              if (!existingStackItem && permanent) {
                const manaCost = (String(activatedAbilityText || '').match(/\{[^}]+\}/g) || [])
                  .filter((symbol: string) => !/^\{[tq]\}$/i.test(symbol))
                  .join('');
                const manaPool = stateAny.manaPool?.[String(playerId)];
                const hasPaymentManaDelta = Boolean(
                  (e as any).paymentManaDelta &&
                  typeof (e as any).paymentManaDelta === 'object' &&
                  !Array.isArray((e as any).paymentManaDelta) &&
                  Object.keys((e as any).paymentManaDelta).length > 0
                );
                if (manaPool && manaCost && !hasPaymentManaDelta) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }

                const rebuiltStackItem: any = {
                  id: persistedStackItemId || generateDeterministicId(ctx, 'ability_battlefield', `${String(permId)}:${persistedAbilityType || replayAbilityDescription || activatedAbilityText}`),
                  type: 'ability',
                  controller: String(playerId),
                  source: String(permId),
                  sourceName: String((e as any).cardName || (permanent as any)?.card?.name || 'Ability'),
                  description: replayAbilityDescription || activatedAbilityText,
                  activatedAbilityText: activatedAbilityText || undefined,
                  xValue: typeof (e as any).xValue === 'number' ? (e as any).xValue : undefined,
                };

                if (persistedTargets) {
                  rebuiltStackItem.targets = persistedTargets.map((id: any) => String(id));
                }
                if (persistedTapUntapAction === 'tap' || persistedTapUntapAction === 'untap') {
                  rebuiltStackItem.tapUntapAction = persistedTapUntapAction;
                }
                if (retargetValidTargets) {
                  rebuiltStackItem.copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                  rebuiltStackItem.copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                  if (Number.isFinite(retargetMinTargets)) rebuiltStackItem.copyRetargetMinTargets = retargetMinTargets;
                  if (Number.isFinite(retargetMaxTargets)) rebuiltStackItem.copyRetargetMaxTargets = retargetMaxTargets;
                  if (retargetTargetDescription) rebuiltStackItem.copyRetargetTargetDescription = retargetTargetDescription;
                }

                if (isEquipActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.equipParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'equip';
                  rebuiltStackItem.equipParams = {
                    equipmentId: String(permId || ''),
                    targetCreatureId,
                    equipmentName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Equipment'),
                    targetCreatureName: String((e as any)?.equipParams?.targetCreatureName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isFortifyActivation) {
                  const targetLandId = String(persistedTargets?.[0] || (e as any)?.fortifyParams?.targetLandId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetLandId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetLandId);
                  rebuiltStackItem.abilityType = 'fortify';
                  rebuiltStackItem.fortifyParams = {
                    fortificationId: String(permId || ''),
                    targetLandId,
                    fortificationName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Fortification'),
                    targetLandName: String((e as any)?.fortifyParams?.targetLandName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isFightActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.fightParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'fight';
                  rebuiltStackItem.fightParams = {
                    sourceCreatureId: String(permId || ''),
                    targetCreatureId,
                    sourceCreatureName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Creature'),
                    targetCreatureName: String(validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isAddCounterActivation) {
                  const targetPermanentId = String(persistedTargets?.[0] || (e as any)?.counterParams?.targetId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetPermanentId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetPermanentId);
                  const counterParams = (e as any)?.counterParams || {};
                  rebuiltStackItem.abilityType = 'add_counter';
                  rebuiltStackItem.counterParams = {
                    targetId: targetPermanentId,
                    targetName: String(counterParams.targetName || validTarget?.name || validTarget?.card?.name || ''),
                    counterType: String(counterParams.counterType || ''),
                    targetControllerRule: counterParams.targetControllerRule || 'any',
                    oracleText: String(counterParams.oracleText || activatedAbilityText || replayAbilityDescription || ''),
                    scalingText: counterParams.scalingText ? String(counterParams.scalingText) : null,
                  };
                } else if (isLevelUpActivation) {
                  rebuiltStackItem.abilityType = 'level_up';
                  rebuiltStackItem.levelUpParams = {
                    amount: Number((e as any)?.levelUpParams?.amount || 1),
                  };
                } else if (isOutlastActivation) {
                  rebuiltStackItem.abilityType = 'outlast';
                  rebuiltStackItem.outlastParams = {
                    amount: Number((e as any)?.outlastParams?.amount || 1),
                    counterType: String((e as any)?.outlastParams?.counterType || '+1/+1'),
                  };
                } else if (isMonstrosityActivation) {
                  rebuiltStackItem.abilityType = 'monstrosity';
                  rebuiltStackItem.monstrosityParams = {
                    amount: Number((e as any)?.monstrosityParams?.amount || 0),
                  };
                } else if (isAdaptActivation) {
                  rebuiltStackItem.abilityType = 'adapt';
                  rebuiltStackItem.adaptParams = {
                    amount: Number((e as any)?.adaptParams?.amount || 0),
                  };
                } else if (isReconfigureAttachActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.reconfigureParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'reconfigure_attach';
                  rebuiltStackItem.reconfigureParams = {
                    reconfigureId: String(permId || ''),
                    targetCreatureId,
                    reconfigureName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Equipment'),
                    targetCreatureName: String((e as any)?.reconfigureParams?.targetCreatureName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isReconfigureUnattachActivation) {
                  rebuiltStackItem.abilityType = 'reconfigure_unattach';
                }

                stack.push(rebuiltStackItem);
              }
            }

            if (retargetValidTargets || persistedTargets) {
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  if (persistedTargets) {
                    (item as any).targets = persistedTargets.map((id: any) => String(id));
                  }
                  if (persistedTapUntapAction === 'tap' || persistedTapUntapAction === 'untap') {
                    (item as any).tapUntapAction = persistedTapUntapAction;
                  }
                  if (typeof (e as any).xValue === 'number') {
                    (item as any).xValue = (e as any).xValue;
                  }
                  if (retargetValidTargets) {
                    (item as any).copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                    (item as any).copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                    if (Number.isFinite(retargetMinTargets)) (item as any).copyRetargetMinTargets = retargetMinTargets;
                    if (Number.isFinite(retargetMaxTargets)) (item as any).copyRetargetMaxTargets = retargetMaxTargets;
                    if (retargetTargetDescription) (item as any).copyRetargetTargetDescription = retargetTargetDescription;
                  }
                  if (isEquipActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'equip';
                    (item as any).equipParams = {
                      equipmentId: String(permId || ''),
                      targetCreatureId,
                      equipmentName: String((e as any).cardName || item.sourceName || 'Equipment'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  } else if (isFortifyActivation) {
                    const targetLandId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetLandId)
                      : null;
                    (item as any).abilityType = 'fortify';
                    (item as any).fortifyParams = {
                      fortificationId: String(permId || ''),
                      targetLandId,
                      fortificationName: String((e as any).cardName || item.sourceName || 'Fortification'),
                      targetLandName: String(validTarget?.name || ''),
                    };
                  } else if (isFightActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'fight';
                    (item as any).fightParams = {
                      sourceCreatureId: String(permId || ''),
                      targetCreatureId,
                      sourceCreatureName: String((e as any).cardName || item.sourceName || 'Creature'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  } else if (isAddCounterActivation) {
                    const targetPermanentId = String(persistedTargets?.[0] || (e as any)?.counterParams?.targetId || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetPermanentId)
                      : null;
                    const counterParams = (e as any)?.counterParams || {};
                    (item as any).abilityType = 'add_counter';
                    (item as any).counterParams = {
                      targetId: targetPermanentId,
                      targetName: String(counterParams.targetName || validTarget?.name || ''),
                      counterType: String(counterParams.counterType || ''),
                      targetControllerRule: counterParams.targetControllerRule || 'any',
                      oracleText: String(counterParams.oracleText || activatedAbilityText || ''),
                      scalingText: counterParams.scalingText ? String(counterParams.scalingText) : null,
                    };
                  } else if (isLevelUpActivation) {
                    (item as any).abilityType = 'level_up';
                    (item as any).levelUpParams = {
                      amount: Number((e as any)?.levelUpParams?.amount || 1),
                    };
                  } else if (isOutlastActivation) {
                    (item as any).abilityType = 'outlast';
                    (item as any).outlastParams = {
                      amount: Number((e as any)?.outlastParams?.amount || 1),
                      counterType: String((e as any)?.outlastParams?.counterType || '+1/+1'),
                    };
                  } else if (isMonstrosityActivation) {
                    (item as any).abilityType = 'monstrosity';
                    (item as any).monstrosityParams = {
                      amount: Number((e as any)?.monstrosityParams?.amount || 0),
                    };
                  } else if (isAdaptActivation) {
                    (item as any).abilityType = 'adapt';
                    (item as any).adaptParams = {
                      amount: Number((e as any)?.adaptParams?.amount || 0),
                    };
                  } else if (isReconfigureAttachActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'reconfigure_attach';
                    (item as any).reconfigureParams = {
                      reconfigureId: String(permId || ''),
                      targetCreatureId,
                      reconfigureName: String((e as any).cardName || item.sourceName || 'Equipment'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  }
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          // Intervening-if support: if we persisted deterministic Treasure spend metadata for this activation,
          // attach it to the matching ability stack item when present.
          try {
            const known = (e as any).manaFromTreasureSpentKnown === true && typeof (e as any).manaFromTreasureSpent === 'boolean';
            if (known) {
              const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  (item as any).manaFromTreasureSpentKnown = true;
                  (item as any).manaFromTreasureSpent = Boolean((e as any).manaFromTreasureSpent);
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          // Fail closed for non-stack activations lacking reconstructible effect evidence:
          // costs/stack evidence above still apply; we do not invent the ability's effect body.
          try {
            const usesStackFlag = (e as any).usesStack === true;
            const abilityTypeFlag = String((e as any).abilityType || '').trim();
            const hasEffectPayload =
              Boolean(Array.isArray((e as any).counterUpdates) && (e as any).counterUpdates.length > 0) ||
              Boolean((e as any).specialAnimation && typeof (e as any).specialAnimation === 'object') ||
              Boolean((e as any).hideawayMovedCardToHand && typeof (e as any).hideawayMovedCardToHand === 'object') ||
              Boolean((e as any).queuedResolutionStep && typeof (e as any).queuedResolutionStep === 'object') ||
              Boolean(abilityTypeFlag) ||
              Boolean(String((e as any).stackItemId || '').trim()) ||
              usesStackFlag;
            const looksLikeManaAbilityText =
              /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(String((e as any).abilityText || '')) &&
              !/target/i.test(String((e as any).abilityText || ''));
            if ((e as any).usesStack === false && !hasEffectPayload && !looksLikeManaAbilityText) {
              debugWarn(
                1,
                'applyEvent(activateBattlefieldAbility): non-stack activation lacks reconstructible effect payload; applied costs/evidence only',
                {
                  permanentId: (e as any).permanentId,
                  abilityId: (e as any).abilityId,
                  cardName: (e as any).cardName,
                },
              );
            }
          } catch {
            // ignore diagnostics failures
          }
}
