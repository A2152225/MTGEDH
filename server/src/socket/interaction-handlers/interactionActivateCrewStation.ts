/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility families for crew and station.
 *
 * Public entry symbols: tryHandleActivateCrewStation.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { isStationPermanentTypeLine, resolveStationChargeCounterEffectText } from "../../state/modules/oracleIrAbilityExecution.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { broadcastGame, getEffectivePower, getEffectiveToughness } from "../util";
import { crewSaddlePowerBonus } from "../crewSaddlePowerBonus.js";
import { getGrantedVehicleCrewValue, resolveCrewPowerRequirement } from "../crewGrantedVehicleCrew.js";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import { persistQueuedBattlefieldAbilityStepActivation } from "./interactionActivationEventPersistence.js";

export async function tryHandleActivateCrewStation(
  ctx: ActivateBattlefieldAbilityContext,
  parseStationThreshold: (oracleText: string) => number,
): Promise<boolean> {
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    battlefield,
    permanent,
    card,
    cardName,
    oracleText,
    typeLine,
    scopedAbilityFullText,
  } = ctx;

  // Handle Crew abilities (Vehicle cards)
  // Crew N: Tap creatures with total power N or more to make this Vehicle an artifact creature
  const isVehicle = typeLine.includes("vehicle");
  const hasExplicitCrewAbilityId = /-crew-(\d+)$/i.test(abilityId) || abilityId === 'crew';
  const crewAbilityText = hasExplicitCrewAbilityId ? oracleText : scopedAbilityFullText;
  const isCrewAbility = hasExplicitCrewAbilityId || (isVehicle && /\bcrew\b/i.test(crewAbilityText))
    || (isVehicle && /crew/i.test(String(abilityId || '')) && getGrantedVehicleCrewValue(battlefield, String(pid), permanent) !== null);
  if (isCrewAbility) {
    // Parse crew power requirement from oracle text
    // Own "Crew N" or a granted one ("Vehicles you control have crew N"): use the cheapest.
    const crewPower = resolveCrewPowerRequirement(crewAbilityText, battlefield, String(pid), permanent);
    
    // Get valid creatures that can crew (untapped creatures the player controls)
    const validCrewers = battlefield.filter((p: any) => {
      if (p.controller !== pid) return false;
      if (p.id === permanentId) return false; // Can't crew itself
      const pTypeLine = (p.card?.type_line || "").toLowerCase();
      if (!pTypeLine.includes("creature")) return false;
      if (p.tapped) return false; // Must be untapped
      return true;
    });

    if (validCrewers.length === 0) {
      socket.emit("error", {
        code: "NO_VALID_CREWERS",
        message: "You have no untapped creatures to crew with",
      });
      return true;
    }

    // Calculate total available power (including counters and modifiers)
    const totalAvailablePower = validCrewers.reduce((sum: number, c: any) => {
      return sum + getEffectivePower(c, game.state) + crewSaddlePowerBonus(c, 'crew');
    }, 0);

    if (totalAvailablePower < crewPower) {
      socket.emit("error", {
        code: "INSUFFICIENT_POWER",
        message: `You need creatures with total power ${crewPower}+ to crew ${cardName}. Available: ${totalAvailablePower}`,
      });
      return true;
    }

    // Unified Resolution Queue prompt
    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.crewAbility === true && String(s?.sourceId) === String(permanentId));

    if (!existing) {
      const crewStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: `Crew ${crewPower} — Tap any number of untapped creatures you control with total power ${crewPower} or more.`,
        mandatory: false,
        validTargets: validCrewers.map((c: any) => ({
          id: c.id,
          label: `${c.card?.name || 'Creature'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
          description: c.card?.type_line || 'Creature',
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
        targetTypes: ['crew_creature'],
        minTargets: 1,
        maxTargets: validCrewers.length,
        targetDescription: 'creatures you control to crew',

        // Custom payload consumed by socket/resolution.ts
        crewAbility: true,
        vehicleId: permanentId,
        crewPower,
      } as any);

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        activatedAbilityText: String(crewAbilityText || '').trim(),
        queuedStep: {
          id: String((crewStep as any).id || ''),
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Crew ${crewPower} — Tap any number of untapped creatures you control with total power ${crewPower} or more.`,
          mandatory: false,
          validTargets: validCrewers.map((c: any) => ({
            id: c.id,
            label: `${c.card?.name || 'Creature'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
            description: c.card?.type_line || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: ['crew_creature'],
          minTargets: 1,
          maxTargets: validCrewers.length,
          targetDescription: 'creatures you control to crew',
          crewAbility: true,
          vehicleId: permanentId,
          crewPower,
        },
      });
    }

    debug(2, `[activateBattlefieldAbility] Crew ability on ${cardName}: queued TARGET_SELECTION (need power ${crewPower})`);
    broadcastGame(io, game, gameId);
    return true;
  }

  const isMount = /\bmount\b/i.test(typeLine);
  const hasExplicitSaddleAbilityId = /-saddle-(\d+)$/i.test(abilityId) || abilityId === 'saddle';
  const saddleAbilityText = hasExplicitSaddleAbilityId ? oracleText : scopedAbilityFullText;
  const isSaddleAbility = hasExplicitSaddleAbilityId || (isMount && /\bsaddle\s*\d+/i.test(saddleAbilityText));
  if (isSaddleAbility) {
    const saddleMatch = saddleAbilityText.match(/saddle\s*(\d+)/i);
    const saddlePower = saddleMatch ? parseInt(saddleMatch[1], 10) : 0;
    const validCrewers = battlefield.filter((perm: any) => {
      if (!perm || perm.id === permanentId) return false;
      if (String(perm.controller || '') !== String(pid)) return false;
      if (perm.tapped) return false;
      return /\bcreature\b/i.test(String(perm.card?.type_line || ''));
    });
    const totalAvailablePower = validCrewers.reduce((sum: number, perm: any) => sum + getEffectivePower(perm, game.state) + crewSaddlePowerBonus(perm, 'saddle'), 0);
    if (totalAvailablePower < saddlePower) {
      socket.emit('error', {
        code: 'INSUFFICIENT_POWER',
        message: `You need creatures with total power ${saddlePower}+ to saddle ${cardName}. Available: ${totalAvailablePower}`,
      });
      return true;
    }
    const existingSaddle = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && s?.saddleAbility === true && String(s?.sourceId) === String(permanentId));
    if (!existingSaddle) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        description: `Saddle ${saddlePower} — Tap any number of other untapped creatures you control with total power ${saddlePower} or more.`,
        mandatory: false,
        validTargets: validCrewers.map((c: any) => ({
          id: c.id,
          label: `${c.card?.name || 'Creature'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
          description: c.card?.type_line || 'Creature',
        })),
        targetTypes: ['crew_creature'],
        minTargets: 1,
        maxTargets: validCrewers.length,
        targetDescription: 'creatures you control to saddle',
        saddleAbility: true,
        vehicleId: permanentId,
        crewPower: saddlePower,
      } as any);
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
    }
    debug(2, `[activateBattlefieldAbility] Saddle ability on ${cardName}: queued TARGET_SELECTION (need power ${saddlePower})`);
    broadcastGame(io, game, gameId);
    return true;
  }
  
  // Handle Station abilities (Spacecraft / Planet permanents)
  // Station N (Rule 702.184a): "Tap another untapped creature you control: Put a number of 
  // charge counters on this permanent equal to the tapped creature's power."
  const isStationPermanent = isStationPermanentTypeLine(typeLine);
  const hasExplicitStationAbilityId = /-station-(\d+)$/i.test(abilityId) || abilityId === 'station';
  const isNonStationActivatedAbilityId = /-ability-\d+$/i.test(abilityId) && !hasExplicitStationAbilityId;
  const stationAbilityText = hasExplicitStationAbilityId ? oracleText : scopedAbilityFullText;
  const isStationAbility = hasExplicitStationAbilityId
    || (
      !isNonStationActivatedAbilityId
      && isStationPermanent
      && /\bstation\b/i.test(stationAbilityText)
    );
  if (isStationAbility) {
    // Parse station threshold from oracle text
    const stationThreshold = parseStationThreshold(stationAbilityText);
    const stationEffectText = resolveStationChargeCounterEffectText({
      typeLine,
      stationAbilityOracleText: stationAbilityText,
    });
    
    // Per Rule 702.184a, station is activated at sorcery speed
    // Check if it's the player's turn and main phase
    const phase = (game.state as any).phase || '';
    const isMainPhase = phase.toLowerCase().includes('main');
    const stack = game.state?.stack || [];
    const activePlayer = (game.state as any).turnPlayer || (game.state as any).activePlayer;
    
    if (activePlayer !== pid) {
      socket.emit("error", {
        code: "NOT_YOUR_TURN",
        message: "Station can only be activated on your turn (sorcery speed)",
      });
      return true;
    }
    
    if (!isMainPhase || stack.length > 0) {
      socket.emit("error", {
        code: "SORCERY_SPEED_ONLY",
        message: "Station can only be activated at sorcery speed (main phase, empty stack)",
      });
      return true;
    }
    
    // Find untapped creatures the player controls (excluding the station itself)
    const untappedCreatures = battlefield.filter((p: any) => {
      if (!p || p.controller !== pid) return false;
      if (p.id === permanentId) return false; // Can't tap itself
      if (p.tapped) return false;
      const pTypeLine = (p.card?.type_line || '').toLowerCase();
      return pTypeLine.includes('creature');
    });
    
    if (untappedCreatures.length === 0) {
      socket.emit("error", {
        code: "NO_VALID_TARGETS",
        message: "No untapped creatures to tap for station ability",
      });
      return true;
    }

    // Queue creature selection via Resolution Queue
    const creatureOptions = untappedCreatures.map((c: any) => {
      const creaturePower = getEffectivePower(c, game.state);
      return {
        id: c.id,
        name: c.card?.name || 'Unknown',
        power: creaturePower,
        toughness: getEffectiveToughness(c, game.state),
        imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
      };
    });

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.STATION_CREATURE_SELECTION,
      playerId: pid as PlayerID,
      sourceId: permanentId,
      sourceName: cardName,
      sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
      description: `Tap another untapped creature you control. Put charge counters on ${cardName} equal to that creature's power.`,
      mandatory: false,
      stationEffectText,
      station: {
        id: permanentId,
        name: cardName,
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        threshold: stationThreshold,
        currentCounters: (permanent as any).counters?.charge || 0,
      },
      creatures: creatureOptions,
      tapForCountersSource: {
        id: permanentId,
        name: cardName,
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        threshold: stationThreshold,
        currentCounters: (permanent as any).counters?.charge || 0,
        counterType: 'charge',
        amountFrom: 'power',
        requireAnother: true,
        effectText: stationEffectText,
      },
      tapForCountersCreatures: creatureOptions,
      title: `Station ${stationThreshold}`,
    });
    
    debug(2, `[activateBattlefieldAbility] Station ability on ${cardName}: prompting for creature selection (${untappedCreatures.length} valid targets)`);

    broadcastGame(io, game, gameId);
    return true;
  }

  return false;
}
