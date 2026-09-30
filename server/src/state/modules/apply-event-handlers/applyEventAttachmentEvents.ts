// server/src/state/modules/apply-event-handlers/applyEventAttachmentEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Equip, aura attach, mutate, fortify, reconfigure and concede.
// Public entry: applyAttachmentEvents(ctx, e) -> true when it handled the event.
//
// Handles: equipPermanent, attachEnchantmentPermanent, mutatePermanent, fortifyPermanent, reconfigurePermanent, reconfigureUnattachPermanent, concede
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { parsePT } from "../../utils";
import { processEquippedTriggers } from "../triggerEmissionFamilyUtils.js";
import {
  createMutatedPermanent,
  getMutatedPermanentAbilities,
  getMutatedPermanentCharacteristics,
} from "../../../../../rules-engine/src/keywordAbilities/mutate.js";
import { debugWarn } from "../../../utils/debug.js";
import { stampPermanentEntryTimestamp, stampAttachmentTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';


export function applyAttachmentEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "equipPermanent": {
        // Attach equipment to a creature
        const pid = (e as any).playerId;
        const equipmentId = (e as any).equipmentId;
        const targetCreatureId = (e as any).targetCreatureId;
        
        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === equipmentId);
          const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);
          
          if (equipment && targetCreature) {
            // Detach from previous creature if attached
            if (equipment.attachedTo) {
              const prevCreature = battlefield.find((p: any) => p.id === equipment.attachedTo);
              if (prevCreature) {
                (prevCreature as any).attachedEquipment = ((prevCreature as any).attachedEquipment || []).filter((id: string) => id !== equipmentId);
                if (((prevCreature as any).attachedEquipment || []).length === 0) {
                  (prevCreature as any).isEquipped = false;
                }
              }
            }
            
            // Attach to new creature
            equipment.attachedTo = targetCreatureId;
            stampAttachmentTimestamp(ctx.state, equipment);
            (targetCreature as any).attachedEquipment = (targetCreature as any).attachedEquipment || [];
            if (!(targetCreature as any).attachedEquipment.includes(equipmentId)) {
              (targetCreature as any).attachedEquipment.push(equipmentId);
            }
            (targetCreature as any).isEquipped = true;
            try {
              processEquippedTriggers(ctx as any, equipment, targetCreature);
            } catch (equipTriggerErr) {
              debugWarn(1, 'applyEvent(equipPermanent): processEquippedTriggers failed', equipTriggerErr);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(equipPermanent): failed", err);
        }
        break;
      }

      case "attachEnchantmentPermanent": {
        const enchantmentId = (e as any).enchantmentId;
        const targetPermanentId = (e as any).targetPermanentId;

        try {
          const battlefield = ctx.state.battlefield || [];
          const enchantment = battlefield.find((p: any) => p?.id === enchantmentId);
          const targetPermanent = battlefield.find((p: any) => p?.id === targetPermanentId);

          if (enchantment && targetPermanent) {
            if (enchantment.attachedTo) {
              const prevTarget = battlefield.find((p: any) => p?.id === enchantment.attachedTo);
              if (prevTarget) {
                (prevTarget as any).attachments = ((prevTarget as any).attachments || []).filter((id: string) => id !== enchantmentId);
              }
            }

            enchantment.attachedTo = targetPermanentId;
            stampAttachmentTimestamp(ctx.state, enchantment);
            (targetPermanent as any).attachments = (targetPermanent as any).attachments || [];
            if (!(targetPermanent as any).attachments.includes(enchantmentId)) {
              (targetPermanent as any).attachments.push(enchantmentId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(attachEnchantmentPermanent): failed', err);
        }
        break;
      }

      case "mutatePermanent": {
        const targetPermanentId = String((e as any).targetPermanentId || '').trim();
        const onTop = (e as any).onTop === true;
        const mutatingCard = (e as any).mutatingCard;

        try {
          const battlefield = ctx.state.battlefield || [];
          const targetPermanent = battlefield.find((p: any) => p?.id === targetPermanentId);
          const mutatingCardId = String(mutatingCard?.id || '').trim();

          if (targetPermanent && mutatingCard && mutatingCardId) {
            const existingMutatedStack = Array.isArray((targetPermanent as any).mutatedStack)
              ? ((targetPermanent as any).mutatedStack as any[])
              : [];
            const alreadyMerged = existingMutatedStack.some((entry: any) => String(entry?.id || '') === mutatingCardId);

            if (!alreadyMerged) {
              const targetOwner = String((targetPermanent as any).owner || (targetPermanent as any).controller || '');
              const existingMutation = existingMutatedStack.length > 0
                ? {
                    permanentId: String((targetPermanent as any).id || targetPermanentId),
                    controller: String((targetPermanent as any).controller || ''),
                    owner: targetOwner,
                    cardStack: existingMutatedStack.map((entry: any) => ({
                      id: String(entry?.id || ''),
                      name: String(entry?.name || ''),
                      typeLine: String(entry?.typeLine || ''),
                      oracleText: String(entry?.oracleText || ''),
                      power: entry?.power,
                      toughness: entry?.toughness,
                      manaCost: entry?.manaCost,
                      isOriginal: entry?.isOriginal === true,
                      isCommander: entry?.isCommander === true,
                    })),
                    mutationCount: Number((targetPermanent as any).mutationCount || Math.max(1, existingMutatedStack.length - 1)),
                    summoningSicknessInherited: !(targetPermanent as any).summoningSickness,
                  }
                : undefined;

              const mutatedPermanent = createMutatedPermanent(targetPermanent, mutatingCard, onTop, existingMutation as any);
              const topCharacteristics = getMutatedPermanentCharacteristics(mutatedPermanent);
              const combinedAbilities = getMutatedPermanentAbilities(mutatedPermanent);
              const topCardEntry = mutatedPermanent.cardStack[0];

              (targetPermanent as any).mutatedStack = mutatedPermanent.cardStack.map((entry: any) => ({
                id: entry.id,
                name: entry.name,
                typeLine: entry.typeLine,
                oracleText: entry.oracleText,
                power: entry.power,
                toughness: entry.toughness,
                manaCost: entry.manaCost,
                isOriginal: entry.isOriginal,
                isCommander: entry.isCommander,
                imageUrl: entry.id === mutatingCardId
                  ? (mutatingCard?.image_uris?.small || mutatingCard?.image_uris?.normal)
                  : undefined,
              }));
              (targetPermanent as any).mutationCount = mutatedPermanent.mutationCount;
              (targetPermanent as any).timesMutated = mutatedPermanent.mutationCount;
              (targetPermanent as any).card = {
                ...((targetPermanent as any).card || {}),
                ...(onTop ? { ...(mutatingCard as any) } : {}),
                id: topCardEntry?.id || (targetPermanent as any).card?.id,
                name: topCharacteristics.name || (targetPermanent as any).card?.name,
                type_line: topCharacteristics.typeLine || (targetPermanent as any).card?.type_line,
                power: topCharacteristics.power ?? (targetPermanent as any).card?.power,
                toughness: topCharacteristics.toughness ?? (targetPermanent as any).card?.toughness,
                mana_cost: topCharacteristics.manaCost ?? (targetPermanent as any).card?.mana_cost,
                oracle_text: combinedAbilities.join('\n') || (targetPermanent as any).card?.oracle_text || '',
                zone: 'battlefield',
              };

              const parsedTopPower = parsePT(topCharacteristics.power);
              const parsedTopToughness = parsePT(topCharacteristics.toughness);
              if (parsedTopPower !== undefined) {
                (targetPermanent as any).basePower = parsedTopPower;
              }
              if (parsedTopToughness !== undefined) {
                (targetPermanent as any).baseToughness = parsedTopToughness;
              }
              (targetPermanent as any).isCommander = mutatedPermanent.cardStack.some((entry: any) => entry?.isCommander === true);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mutatePermanent): failed', err);
        }
        break;
      }

      case "fortifyPermanent": {
        const fortificationId = (e as any).fortificationId;
        const targetLandId = (e as any).targetLandId;

        try {
          const battlefield = ctx.state.battlefield || [];
          const fortification = battlefield.find((p: any) => p?.id === fortificationId);
          const targetLand = battlefield.find((p: any) => p?.id === targetLandId);

          if (fortification && targetLand) {
            if (fortification.attachedTo) {
              const prevTarget = battlefield.find((p: any) => p.id === fortification.attachedTo);
              if (prevTarget) {
                (prevTarget as any).attachedEquipment = ((prevTarget as any).attachedEquipment || []).filter((id: string) => id !== fortificationId);
                if (((prevTarget as any).attachedEquipment || []).length === 0) {
                  (prevTarget as any).isEquipped = false;
                }
              }
            }

            fortification.attachedTo = targetLandId;
            (targetLand as any).attachedEquipment = (targetLand as any).attachedEquipment || [];
            if (!(targetLand as any).attachedEquipment.includes(fortificationId)) {
              (targetLand as any).attachedEquipment.push(fortificationId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(fortifyPermanent): failed', err);
        }
        break;
      }

      case "reconfigurePermanent": {
        const reconfigureId = (e as any).reconfigureId;
        const targetCreatureId = (e as any).targetCreatureId;

        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === reconfigureId);
          const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);

          if (equipment && targetCreature) {
            if (equipment.attachedTo) {
              const prevTarget = battlefield.find((p: any) => p.id === equipment.attachedTo);
              if (prevTarget) {
                (prevTarget as any).attachedEquipment = ((prevTarget as any).attachedEquipment || []).filter((id: string) => id !== reconfigureId);
                if (((prevTarget as any).attachedEquipment || []).length === 0) {
                  (prevTarget as any).isEquipped = false;
                }
              }
            }

            equipment.attachedTo = targetCreatureId;
            stampAttachmentTimestamp(ctx.state, equipment);
            (targetCreature as any).attachedEquipment = (targetCreature as any).attachedEquipment || [];
            if (!(targetCreature as any).attachedEquipment.includes(reconfigureId)) {
              (targetCreature as any).attachedEquipment.push(reconfigureId);
            }
            (targetCreature as any).isEquipped = true;
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reconfigurePermanent): failed', err);
        }
        break;
      }

      case "reconfigureUnattachPermanent": {
        const reconfigureId = (e as any).reconfigureId;
        const targetCreatureId = (e as any).targetCreatureId;
        const restoredBasePower = (e as any).restoredBasePower;
        const restoredBaseToughness = (e as any).restoredBaseToughness;

        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === reconfigureId);
          if (equipment) {
            const attachedTargetId = String((equipment as any).attachedTo || targetCreatureId || '').trim();
            if (attachedTargetId) {
              const prevTarget = battlefield.find((p: any) => p?.id === attachedTargetId);
              if (prevTarget) {
                (prevTarget as any).attachedEquipment = ((prevTarget as any).attachedEquipment || []).filter((id: string) => id !== reconfigureId);
                if (((prevTarget as any).attachedEquipment || []).length === 0) {
                  (prevTarget as any).isEquipped = false;
                }
                // Bestow / aura hosts track attachments separately from equipment.
                (prevTarget as any).attachments = ((prevTarget as any).attachments || []).filter((id: string) => id !== reconfigureId);
              }
            }

            delete (equipment as any).attachedTo;

            // SBA bestow/reconfigure unattach may restore printed P/T when missing.
            if (typeof restoredBasePower === 'number' && Number.isFinite(restoredBasePower)) {
              (equipment as any).basePower = restoredBasePower;
            }
            if (typeof restoredBaseToughness === 'number' && Number.isFinite(restoredBaseToughness)) {
              (equipment as any).baseToughness = restoredBaseToughness;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reconfigureUnattachPermanent): failed', err);
        }
        break;
      }

      case "concede": {
        // Mark player as having conceded
        const pid = (e as any).playerId;
        
        try {
          const players = ctx.state.players || [];
          const player = players.find((p: any) => p.id === pid);
          
          if (player) {
            (player as any).conceded = true;
            (player as any).concededAt = Date.now();
            (player as any).departureMode = 'concede';
          }

          const stateAny = ctx.state as any;
          if (!stateAny.autoPassForTurn || typeof stateAny.autoPassForTurn !== 'object') {
            stateAny.autoPassForTurn = {};
          }
          if (pid) {
            stateAny.autoPassForTurn[pid] = true;
          }
          if (stateAny.priorityClaimed instanceof Set) {
            stateAny.priorityClaimed.delete(pid);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(concede): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
