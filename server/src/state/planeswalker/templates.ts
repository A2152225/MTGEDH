export * from "./templates/index.js";

/* Legacy implementation moved to ./templates/*.ts.
  export * from "./templates/index.js";
    }

    case "TARGET_PLAYER_MILLS_N": {
      const targets = getTargets(triggerItem);
      const targetPlayer = (targets[0] as PlayerID) || null;
      if (!targetPlayer) return true; // no legal target => fizzles

      const t = normalizeOracleEffectText(effectText).toLowerCase();
      const m = t.match(/target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i);
      const n = parseWordNumber(m?.[1], 1);

      const lib = (ctx as any).libraries?.get(targetPlayer) || [];
      const zones = (ctx as any).state?.zones || ((ctx as any).state.zones = {});
      const z = zones[targetPlayer] || (zones[targetPlayer] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
      const milled: any[] = [];

      for (let i = 0; i < n && Array.isArray(lib) && lib.length > 0; i++) {
        const c = lib.pop();
        if (c) milled.push(c);
      }

      if (milled.length > 0) {
        z.graveyard = z.graveyard || [];
        for (const c of milled) {
          (c as any).zone = "graveyard";
          z.graveyard.push(c);
        }
      }

      (ctx as any).libraries?.set(targetPlayer, lib);
      z.libraryCount = Array.isArray(lib) ? lib.length : 0;
      z.graveyardCount = (z.graveyard || []).length;

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targetPlayer} mills ${milled.length})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_N_THEN_DRAW": {
      const targets = getTargets(triggerItem);
      const targetPlayer = (targets[0] as PlayerID) || null;
      const t = normalizeOracleEffectText(effectText).toLowerCase();
      const m = t.match(/target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.\s*draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i);
      const millN = parseWordNumber(m?.[1], 1);
      const drawN = parseWordNumber(m?.[2], 1);

      if (targetPlayer) {
        // Reuse the mill handler by temporarily resolving into a synthetic effect.
        const synthetic = `Target player mills ${millN} cards.`;
        tryResolvePlaneswalkerLoyaltyTemplate(ctx, controller, sourceName, synthetic, triggerItem);
      }

      drawCardsFromZone(ctx as any, controller, drawN);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (mill ${millN}, draw ${drawN})`);
      return true;
    }

    case "TARGET_PLAYER_MILLS_THREE_TIMES_X": {
      const targets = getTargets(triggerItem);
      const targetPlayer = (targets[0] as PlayerID) || null;
      if (!targetPlayer) return true;

      const x = getPlaneswalkerX(triggerItem);
      if (x === null) return false;
      const millN = 3 * x;

      const synthetic = `Target player mills ${millN} cards.`;
      const handled = tryResolvePlaneswalkerLoyaltyTemplate(ctx, controller, sourceName, synthetic, triggerItem);
      if (!handled) return false;
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (X=${x}, mill ${millN})`);
      return true;
    }

    case "PUT_P1P1_COUNTERS_ON_TARGETS": {
      const targets = getTargets(triggerItem);
      if (targets.length === 0) return true;

      const t = normalizeOracleEffectText(effectText).toLowerCase();
      const m = t.match(/put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1/i);
      const n = parseWordNumber(m?.[1], 1);

      for (const targetId of targets) {
        updateCounters(ctx as any, targetId, { "+1/+1": n });
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${targets.length} target(s), +${n}/+${n} counters)`);
      return true;
    }

    case "TARGET_CREATURE_GETS_PT_EOT": {
      const targets = getTargets(triggerItem);
      if (targets.length === 0) return true;

      const text = normalizeOracleEffectText(effectText);
      const m = text.match(TARGET_CREATURE_GETS_PT_EOT_REGEX);
      if (!m) return false;

      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);
      const gainedAbilities = m[3] ? m[3].trim() : null;

      const battlefield = getBattlefield(ctx);
      for (const targetId of targets) {
        const targetCreature = battlefield.find((p: any) => p?.id === targetId);
        if (!targetCreature) continue;

        targetCreature.temporaryPTMods = targetCreature.temporaryPTMods || [];
        targetCreature.temporaryPTMods.push({
          power: powerMod,
          toughness: toughnessMod,
          source: sourceName,
          expiresAt: "end_of_turn",
          turnApplied: state.turnNumber || 0,
        });

        if (gainedAbilities) {
          targetCreature.temporaryAbilities = targetCreature.temporaryAbilities || [];
          const abilities = gainedAbilities
            .split(/,\s*(?:and\s*)?/)
            .map((a: string) => a.trim().toLowerCase())
            .filter(Boolean);
          for (const ability of abilities) {
            targetCreature.temporaryAbilities.push({
              ability,
              source: sourceName,
              expiresAt: "end_of_turn",
              turnApplied: state.turnNumber || 0,
            });
          }
        }
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${powerMod}/${toughnessMod})`);
      return true;
    }

    case "DESTROY_TARGET_NONCREATURE_PERMANENT": {
      const targets = getTargets(triggerItem);
      const targetId = targets[0];
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;
      const typeLine = String(perm.card?.type_line || "").toLowerCase();
      if (typeLine.includes("creature")) return true; // illegal target

      movePermanentToGraveyard(ctx as any, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_TARGET_CREATURE": {
      const targets = getTargets(triggerItem);
      const targetId = targets[0];
      if (!targetId) return true;
      movePermanentToGraveyard(ctx as any, targetId, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DESTROY_ALL_CREATURES_POWER_GE_N": {
      const text = normalizeOracleEffectText(effectText);
      const m = text.match(DESTROY_ALL_CREATURES_POWER_GE_N_REGEX);
      const threshold = m ? parseInt(m[1], 10) : 0;
      if (!threshold) return false;

      const battlefield = getBattlefield(ctx);
      const toDestroy: string[] = [];
      for (const perm of battlefield) {
        if (!perm?.card) continue;
        const typeLine = String(perm.card.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;
        const power = parseInt(String(perm.card.power ?? perm.basePower ?? "0"), 10);
        if (Number.isFinite(power) && power >= threshold) {
          toDestroy.push(perm.id);
        }
      }

      for (const id of toDestroy) movePermanentToGraveyard(ctx as any, id, true);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (destroyed ${toDestroy.length})`);
      return true;
    }

    case "EXILE_TARGET_NONLAND_PERMANENT": {
      const targets = getTargets(triggerItem);
      const targetId = targets[0];
      if (!targetId) return true;

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;
      const typeLine = String(perm.card?.type_line || "").toLowerCase();
      if (typeLine.includes("land")) return true;

      movePermanentToExile(ctx as any, targetId);
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "DEALS_DAMAGE_TO_ANY_TARGET": {
      const text = normalizeOracleEffectText(effectText);
      const m = text.match(DEALS_DAMAGE_TO_ANY_TARGET_REGEX);
      const amount = m ? parseInt(m[2], 10) : 0;
      if (!amount) return false;

      const targets = getTargets(triggerItem);
      const targetId = targets[0];
      if (!targetId) return true;

      const players = (state.players || []) as any[];
      const targetPlayer = players.find((p: any) => p.id === targetId);
      if (targetPlayer) {
        modifyLifeLikeStack(ctx, targetId, -amount);
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to player)`);
        return true;
      }

      const battlefield = getBattlefield(ctx);
      const targetPerm = battlefield.find((p: any) => p?.id === targetId);
      if (targetPerm) {
        targetPerm.damageMarked = (targetPerm.damageMarked || 0) + amount;
        debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (${amount} to permanent)`);
      }
      return true;
    }

    case "SCRY_N": {
      const text = normalizeOracleEffectText(effectText);
      const m = text.match(SCRY_N_REGEX);
      const scryCount = m ? parseInt(m[1], 10) : 0;
      if (!scryCount) return false;

      const gameId = getGameId(ctx);
      if (!gameId) return false;

      const lib = (ctx as any).libraries?.get(controller) || [];
      const actualCount = Math.min(scryCount, Array.isArray(lib) ? lib.length : 0);
      if (actualCount <= 0) return true;

      const cards = lib.slice(0, actualCount).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId: controller,
        description: `Scry ${actualCount}`,
        mandatory: true,
        cards,
        scryCount: actualCount,
        sourceName,
      } as any);

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (scry ${actualCount})`);
      return true;
    }

    case "YOU_GET_EMBLEM": {
      const text = normalizeOracleEffectText(effectText);
      const m = text.match(YOU_GET_EMBLEM_REGEX);
      const emblemText = m?.[1]?.trim();
      if (!emblemText) return false;

      state.emblems = state.emblems || [];
      state.emblems.push({
        id: uid("emblem"),
        controller,
        sourceName,
        effect: emblemText,
      });

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    case "CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT": {
      const text = normalizeOracleEffectText(effectText);
      const m = text.match(CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT_REGEX);
      if (!m) return false;
      const powerMod = parseInt(m[1], 10);
      const toughnessMod = parseInt(m[2], 10);

      const battlefield = getBattlefield(ctx);
      let affected = 0;
      for (const perm of battlefield) {
        if (!perm || perm.controller !== controller) continue;
        const typeLine = String(perm.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;

        perm.temporaryPTMods = perm.temporaryPTMods || [];
        perm.temporaryPTMods.push({
          power: powerMod,
          toughness: toughnessMod,
          source: sourceName,
          expiresAt: "end_of_turn",
          turnApplied: state.turnNumber || 0,
        });

        perm.temporaryAbilities = perm.temporaryAbilities || [];
        perm.temporaryAbilities.push({
          ability: "haste",
          source: sourceName,
          expiresAt: "end_of_turn",
          turnApplied: state.turnNumber || 0,
        });
        affected++;
      }

      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} (affected ${affected})`);
      return true;
    }

    case "TAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_FREEZE": {
      const targets = getTargets(triggerItem);
      const targetId = targets[0];
      if (!targetId) return true; // up to one

      const battlefield = getBattlefield(ctx);
      const perm = battlefield.find((p: any) => p?.id === targetId);
      if (!perm) return true;

      const typeLine = String(perm.card?.type_line || "").toLowerCase();
      const isArtifact = typeLine.includes("artifact");
      const isCreature = typeLine.includes("creature");
      if (!isArtifact && !isCreature) return true;

      perm.tapped = true;
      perm.doesntUntapNextTurn = true;
      debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id}`);
      return true;
    }

    default:
      return false;
  }
}

*/
