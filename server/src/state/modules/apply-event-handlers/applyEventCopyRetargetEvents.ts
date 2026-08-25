// server/src/state/modules/apply-event-handlers/applyEventCopyRetargetEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Copying triggered abilities and spells, copy retargeting, and myriad token copies.
// Public entry: applyCopyRetargetEvents(ctx, e) -> true when it handled the event.
//
// Handles: copyTriggeredAbilityResolve, copyTriggeredSpellResolve, resolvedSpellCopyChoiceResolve, resolvedSpellCopyResolve, copyRetargetChoiceResolve, assignTriggeredAbilityTargets, retargetAbilityCopyResolve, retargetSpellCopyResolve, myriadChoice
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { applyMyriadTokenCopies } from "../triggerMyriadTokenUtils.js";
import {
  generateDeterministicId,
  clearReplayQueuedSteps,
  clearReplayQueuedStepById,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { consumeRecordedManaCostFromPool } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionStepType } from "../../resolution/index.js";

export function applyCopyRetargetEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "copyTriggeredAbilityResolve": {
        try {
          const paid = (e as any).paid !== false;
          const triggerStackItemId = String((e as any).triggerStackItemId || '').trim();
          const triggeringStackItemId = String((e as any).triggeringStackItemId || '').trim();
          const copiedStackItemId = String((e as any).copiedStackItemId || '').trim();
          const controllerId = String((e as any).controllerId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const manaCost = String((e as any).manaCost || '').trim();

          ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          const stack = ctx.state.stack as any[];
          if (triggerStackItemId) {
            const triggerIndex = stack.findIndex((item: any) => item && String(item.id || '').trim() === triggerStackItemId);
            if (triggerIndex >= 0) {
              stack.splice(triggerIndex, 1);
            }
          }
          if (!paid) {
            ctx.bumpSeq();
            break;
          }
          if (!triggeringStackItemId) break;

          const existingCopiedItem = copiedStackItemId
            ? stack.find((item: any) => item && String(item.id || '').trim() === copiedStackItemId)
            : null;
          if (!existingCopiedItem) {
            const original = stack.find((item: any) => item && String(item.id || '').trim() === triggeringStackItemId);
            if (!original) break;

            const copiedItem: any = {
              ...original,
              id: copiedStackItemId || generateDeterministicId(ctx, 'copied_ability', triggeringStackItemId),
              controller: String((original as any).controller || controllerId),
              targets: Array.isArray((original as any).targets)
                ? (original as any).targets.map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (original as any).targets,
              card: (original as any).card ? { ...(original as any).card } : (original as any).card,
              ability: (original as any).ability ? { ...(original as any).ability } : (original as any).ability,
              searchParams: (original as any).searchParams ? { ...(original as any).searchParams } : (original as any).searchParams,
              upgradeData: (original as any).upgradeData ? { ...(original as any).upgradeData } : (original as any).upgradeData,
              equipParams: (original as any).equipParams ? { ...(original as any).equipParams } : (original as any).equipParams,
              fortifyParams: (original as any).fortifyParams ? { ...(original as any).fortifyParams } : (original as any).fortifyParams,
              reconfigureParams: (original as any).reconfigureParams ? { ...(original as any).reconfigureParams } : (original as any).reconfigureParams,
              copiedFromStackItemId: triggeringStackItemId,
              copiedBySourceName: sourceName,
              isCopy: true,
            };

            stack.push(copiedItem);
          }

          const stateAny = ctx.state as any;
          const manaPool = controllerId ? stateAny?.manaPool?.[controllerId] : null;
          if (manaPool && manaCost) {
            consumeRecordedManaCostFromPool(manaPool, manaCost);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(copyTriggeredAbilityResolve): failed', err);
        }
        break;
      }

      case "copyTriggeredSpellResolve": {
        try {
          const sourceName = String((e as any).sourceName || 'Spell copy').trim() || 'Spell copy';
          const controllerId = String((e as any).controllerId || '').trim();
          const triggeringStackItemId = String((e as any).triggeringStackItemId || '').trim();
          const copiedStackItemId = String((e as any).copiedStackItemId || '').trim();
          if (!triggeringStackItemId) break;

          const stack = ctx.state.stack as any[];
          const existingCopiedItem = copiedStackItemId
            ? stack.find((item: any) => item && String(item.id || '').trim() === copiedStackItemId)
            : null;
          if (!existingCopiedItem) {
            const original = stack.find((item: any) => item && String(item.id || '').trim() === triggeringStackItemId);
            if (!original) break;

            const copiedItem: any = {
              ...original,
              id: copiedStackItemId || generateDeterministicId(ctx, 'copied_spell', triggeringStackItemId),
              type: String((original as any).type || 'spell'),
              controller: String((original as any).controller || controllerId),
              targets: Array.isArray((original as any).targets)
                ? (original as any).targets.map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (original as any).targets,
              card: (original as any).card ? { ...(original as any).card } : (original as any).card,
              spell: (original as any).spell ? { ...(original as any).spell } : (original as any).spell,
              searchParams: (original as any).searchParams ? { ...(original as any).searchParams } : (original as any).searchParams,
              targetRequirements: (original as any).targetRequirements ? { ...(original as any).targetRequirements } : (original as any).targetRequirements,
              manaPayment: (original as any).manaPayment
                ? (Array.isArray((original as any).manaPayment) ? [...(original as any).manaPayment] : { ...(original as any).manaPayment })
                : (original as any).manaPayment,
              counterImmunity: (original as any).counterImmunity
                ? (Array.isArray((original as any).counterImmunity) ? [...(original as any).counterImmunity] : { ...(original as any).counterImmunity })
                : (original as any).counterImmunity,
              entersBattlefieldWithCounters: (original as any).entersBattlefieldWithCounters
                ? { ...(original as any).entersBattlefieldWithCounters }
                : (original as any).entersBattlefieldWithCounters,
              copyRetargetValidTargets: Array.isArray((original as any).copyRetargetValidTargets)
                ? (original as any).copyRetargetValidTargets.map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (original as any).copyRetargetValidTargets,
              copyRetargetTargetTypes: Array.isArray((original as any).copyRetargetTargetTypes)
                ? [...(original as any).copyRetargetTargetTypes]
                : (original as any).copyRetargetTargetTypes,
              copiedFromStackItemId: triggeringStackItemId,
              copiedBySourceName: sourceName,
              isCopy: true,
            };

            stack.push(copiedItem);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(copyTriggeredSpellResolve): failed', err);
        }
        break;
      }

      case "resolvedSpellCopyChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.resolvedSpellCopyChoice === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(resolvedSpellCopyChoiceResolve): failed', err);
        }
        break;
      }

      case "resolvedSpellCopyResolve": {
        try {
          const rawCopiedSpell = (e as any).copiedSpell;
          if (!rawCopiedSpell || typeof rawCopiedSpell !== 'object' || Array.isArray(rawCopiedSpell)) {
            break;
          }

          ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          const stack = ctx.state.stack as any[];
          const copiedSpellId = String((rawCopiedSpell as any).id || '').trim();
          const existingCopiedItem = copiedSpellId
            ? stack.find((item: any) => item && String(item.id || '').trim() === copiedSpellId)
            : null;

          if (!existingCopiedItem) {
            stack.push({
              ...(rawCopiedSpell as any),
              ...(copiedSpellId ? { id: copiedSpellId } : {}),
              targets: Array.isArray((rawCopiedSpell as any).targets)
                ? ((rawCopiedSpell as any).targets as any[]).map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (rawCopiedSpell as any).targets,
              card: (rawCopiedSpell as any).card && typeof (rawCopiedSpell as any).card === 'object' && !Array.isArray((rawCopiedSpell as any).card)
                ? { ...((rawCopiedSpell as any).card as Record<string, any>) }
                : (rawCopiedSpell as any).card,
              spell: (rawCopiedSpell as any).spell && typeof (rawCopiedSpell as any).spell === 'object' && !Array.isArray((rawCopiedSpell as any).spell)
                ? { ...((rawCopiedSpell as any).spell as Record<string, any>) }
                : (rawCopiedSpell as any).spell,
              searchParams: (rawCopiedSpell as any).searchParams && typeof (rawCopiedSpell as any).searchParams === 'object' && !Array.isArray((rawCopiedSpell as any).searchParams)
                ? { ...((rawCopiedSpell as any).searchParams as Record<string, any>) }
                : (rawCopiedSpell as any).searchParams,
              targetRequirements: (rawCopiedSpell as any).targetRequirements && typeof (rawCopiedSpell as any).targetRequirements === 'object' && !Array.isArray((rawCopiedSpell as any).targetRequirements)
                ? { ...((rawCopiedSpell as any).targetRequirements as Record<string, any>) }
                : (rawCopiedSpell as any).targetRequirements,
              manaPayment: (rawCopiedSpell as any).manaPayment
                ? (Array.isArray((rawCopiedSpell as any).manaPayment)
                    ? [...((rawCopiedSpell as any).manaPayment as any[])]
                    : { ...((rawCopiedSpell as any).manaPayment as Record<string, any>) })
                : (rawCopiedSpell as any).manaPayment,
              counterImmunity: (rawCopiedSpell as any).counterImmunity
                ? (Array.isArray((rawCopiedSpell as any).counterImmunity)
                    ? [...((rawCopiedSpell as any).counterImmunity as any[])]
                    : { ...((rawCopiedSpell as any).counterImmunity as Record<string, any>) })
                : (rawCopiedSpell as any).counterImmunity,
              entersBattlefieldWithCounters: (rawCopiedSpell as any).entersBattlefieldWithCounters && typeof (rawCopiedSpell as any).entersBattlefieldWithCounters === 'object' && !Array.isArray((rawCopiedSpell as any).entersBattlefieldWithCounters)
                ? { ...((rawCopiedSpell as any).entersBattlefieldWithCounters as Record<string, any>) }
                : (rawCopiedSpell as any).entersBattlefieldWithCounters,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(resolvedSpellCopyResolve): failed', err);
        }
        break;
      }

      case "copyRetargetChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const copyKind = String((e as any).copyKind || '').trim().toLowerCase();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                ((copyKind === 'spell' && (step as any)?.retargetSpellCopy === true) ||
                  (copyKind !== 'spell' && (step as any)?.retargetAbilityCopy === true)) &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(copyRetargetChoiceResolve): failed', err);
        }
        break;
      }

      case "assignTriggeredAbilityTargets": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const triggerStackItemId = String((e as any).triggerStackItemId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const targets = Array.isArray((e as any).targets) ? (e as any).targets.map((t: any) => String(t)) : [];
          if (!triggerStackItemId) break;
          const stack: any[] = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
          const stackItem = stack.find((item: any) => item && String(item?.id || '') === triggerStackItemId);
          if (stackItem) {
            stackItem.targets = targets.slice();
          }
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedStepById(replayGameId, resolvedStepId);
          }
          ctx.bumpSeq();
        } catch {
          // best-effort replay
        }
        break;
      }

      case "myriadChoice": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                if ((step as any).myriadChoice !== true) return false;
                const queuedPermanentId = String((step as any).permanentId || (step as any).sourceId || '').trim();
                return !permanentId || queuedPermanentId === permanentId;
              });
            }
          }

          const selectedOpponentIds = Array.isArray((e as any).selectedOpponentIds)
            ? ((e as any).selectedOpponentIds as any[])
                .map((value: any) => String(value || '').trim())
                .filter(Boolean)
            : [];
          const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
            ? ((e as any).createdPermanentIds as any[])
                .map((value: any) => String(value || '').trim())
                .filter(Boolean)
            : [];
          const sourcePermanentSnapshot = (e as any).sourcePermanentSnapshot && typeof (e as any).sourcePermanentSnapshot === 'object'
            ? JSON.parse(JSON.stringify((e as any).sourcePermanentSnapshot))
            : null;
          const sourceName = String((e as any).sourceName || sourcePermanentSnapshot?.card?.name || 'Myriad').trim() || 'Myriad';
          const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
          const sourcePermanent = sourcePermanentSnapshot
            || battlefield.find((permanent: any) => String(permanent?.id || '') === permanentId)
            || null;

          if (!playerId || !sourcePermanent) {
            debugWarn(2, `[applyEvent] myriadChoice: missing source snapshot for ${permanentId || 'unknown permanent'}`);
            ctx.bumpSeq();
            break;
          }

          applyMyriadTokenCopies(
            ctx as any,
            sourcePermanent,
            playerId as any,
            selectedOpponentIds,
            createdPermanentIds,
            sourceName,
          );
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(myriadChoice): failed', err);
        }
        break;
      }

      case "retargetAbilityCopyResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const stackItemId = String((e as any).stackItemId || '').trim();
          const targets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          if (!stackItemId || targets.length === 0) break;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (String((step as any)?.type || '') !== String(ResolutionStepType.TARGET_SELECTION)) return false;
              if ((step as any)?.retargetAbilityCopyTargetSelection !== true) return false;
              return String((step as any)?.sourceId || '').trim() === stackItemId;
            });
          }

          const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
          const copiedItem = stack.find((item: any) => item && String(item.id || '') === stackItemId);
          if (!copiedItem) break;

          copiedItem.targets = [...targets];

          const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
          if (String((copiedItem as any).abilityType || '') === 'equip' && (copiedItem as any).equipParams) {
            const nextTargetId = String(copiedItem.targets[0] || '').trim();
            const validTarget = Array.isArray((copiedItem as any).copyRetargetValidTargets)
              ? (copiedItem as any).copyRetargetValidTargets.find((target: any) => String(target?.id || '') === nextTargetId)
              : battlefield.find((target: any) => target && String(target.id || '') === nextTargetId);
            (copiedItem as any).equipParams = {
              ...((copiedItem as any).equipParams || {}),
              targetCreatureId: nextTargetId,
              targetCreatureName: String(validTarget?.name || validTarget?.card?.name || (copiedItem as any).equipParams?.targetCreatureName || 'Creature'),
            };
          } else if (String((copiedItem as any).abilityType || '') === 'reconfigure_attach' && (copiedItem as any).reconfigureParams) {
            const nextTargetId = String(copiedItem.targets[0] || '').trim();
            const validTarget = Array.isArray((copiedItem as any).copyRetargetValidTargets)
              ? (copiedItem as any).copyRetargetValidTargets.find((target: any) => String(target?.id || '') === nextTargetId)
              : battlefield.find((target: any) => target && String(target.id || '') === nextTargetId);
            (copiedItem as any).reconfigureParams = {
              ...((copiedItem as any).reconfigureParams || {}),
              targetCreatureId: nextTargetId,
              targetCreatureName: String(validTarget?.name || validTarget?.card?.name || (copiedItem as any).reconfigureParams?.targetCreatureName || 'Creature'),
            };
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(retargetAbilityCopyResolve): failed', err);
        }
        break;
      }

      case "retargetSpellCopyResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const stackItemId = String((e as any).stackItemId || '').trim();
          const targets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          if (!stackItemId || targets.length === 0) break;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (String((step as any)?.type || '') !== String(ResolutionStepType.TARGET_SELECTION)) return false;
              if ((step as any)?.retargetSpellCopyTargetSelection !== true) return false;
              return String((step as any)?.sourceId || '').trim() === stackItemId;
            });
          }

          const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
          const copiedItem = stack.find((item: any) => item && String(item.id || '') === stackItemId);
          if (!copiedItem) break;

          copiedItem.targets = [...targets];

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(retargetSpellCopyResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
