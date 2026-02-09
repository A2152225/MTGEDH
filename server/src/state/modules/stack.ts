import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import { uid, parsePT, addEnergyCounters, addTokenCounters, triggerLifeGainEffects, calculateAllPTBonuses, cardManaValue, calculateVariablePT } from "../utils.js";
import { recalculatePlayerEffects, hasMetalcraft, countArtifacts, detectSpellLandBonus, applyTemporaryLandBonus, processLifeChange, applyMillReplacements } from "./game-state-effects.js";
import { 
  detectKeywords, 
  getAttackTriggerKeywords, 
  getETBKeywords, 
  getDeathTriggerKeywords,
  getCombatDamageTriggerKeywords,
  getSpellCastTriggerKeywords,
  type DetectedKeyword 
} from "./keyword-detection.js";
import { 
  processKeywordTriggers, 
  applyKeywordCounters, 
  applyKeywordPTMod,
  type KeywordTriggerResult,
  type KeywordTriggerContext
} from "./keyword-handlers.js";
import { categorizeSpell, resolveSpell, type EngineEffect, type TargetRef } from "../../rules-engine/targeting.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { 
  getETBTriggersForPermanent, 
  processLinkedExileReturns, 
  registerLinkedExile, 
  detectLinkedExileEffect, 
  type TriggeredAbility, 
  getLandfallTriggers,
  detectControlChangeEffects,
  shouldEnterUnderOpponentControl,
  hasOptionalGiveControlETB,
  shouldGoadOnControlChange,
  mustAttackEachCombat,
  cantAttackOwner,
  checkGraveyardTrigger,
} from "./triggered-abilities.js";
import { processDamageReceivedTriggers } from "./triggers/damage-received.js";
import { detectCombatDamageTriggers } from "./triggers/index.js";
import { isInterveningIfSatisfied } from "./triggers/intervening-if.js";
import { handleElixirShuffle, handleEldraziShuffle } from "./zone-manipulation.js";
import { addExtraTurn, addExtraCombat } from "./turn.js";
import { drawCards as drawCardsFromZone, movePermanentToHand } from "./zones.js";
import { createToken, runSBA, applyCounterModifications, movePermanentToGraveyard, movePermanentToExile } from "./counters_tokens.js";
import { recordCardPutIntoGraveyardThisTurn } from "./turn-tracking.js";
import { applyGoadToCreature } from "./goad-effects.js";
import { getTokenImageUrls } from "../../services/tokens.js";
import { detectETBTappedPattern, evaluateConditionalLandETB, getLandSubtypes } from "../../socket/land-helpers.js";
import { ResolutionQueueManager, ResolutionStepType } from "../resolution/index.js";
import type { ChoiceOption } from "../../../../rules-engine/src/choiceEvents.js";
import { parseOracleTextToIR } from "../../../../rules-engine/src/oracleIRParser.js";
import type { OracleEffectStep, OraclePlayerSelector, OracleQuantity } from "../../../../rules-engine/src/oracleIR.js";
import { updateLandPlayPermissions, updateAllLandPlayPermissions } from "./land-permissions.js";
import { applyDayNightTransforms, ensureInitialDayNightDesignationFromBattlefield, setDayNightState } from "./day-night.js";
import { parseCreateTokenDescriptor } from "../planeswalker/templates/utils.js";

function resolveOracleQuantityToNumber(q: OracleQuantity, xValue?: number): number | null {
  if (!q) return null;
  if (q.kind === 'number') return Number.isFinite(q.value) ? q.value : null;
  if (q.kind === 'x') return typeof xValue === 'number' && Number.isFinite(xValue) ? xValue : null;
  return null;
}

function resolveOracleWhoToPlayerIds(who: OraclePlayerSelector, caster: PlayerID, state: any): PlayerID[] {
  switch (who.kind) {
    case 'you':
      return [caster];
    case 'each_player':
      return Array.isArray(state?.players)
        ? state.players.map((p: any) => p?.id).filter(Boolean)
        : [];
    case 'each_opponent':
      return Array.isArray(state?.players)
        ? state.players
            .map((p: any) => p?.id)
            .filter((id: any) => id && String(id) !== String(caster))
        : [];
    default:
      return [];
  }
}

function parseCommonArtifactTokenOptions(tokenText: string):
  | { name: string; options: any; basePower?: number; baseToughness?: number }
  | null {
  const lower = String(tokenText || '').toLowerCase();
  if (!lower) return null;

  if (lower.includes('treasure')) {
    return {
      name: 'Treasure',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Treasure',
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('clue')) {
    return {
      name: 'Clue',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Clue',
        abilities: ['{2}, Sacrifice this token: Draw a card.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('food')) {
    return {
      name: 'Food',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Food',
        abilities: ['{2}, {T}, Sacrifice this token: You gain 3 life.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('incubator')) {
    return {
      name: 'Incubator',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Incubator',
        abilities: ['{2}: Transform this artifact.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('lander')) {
    return {
      name: 'Lander',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Lander',
        abilities: [
          '{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
        ],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('mutagen')) {
    return {
      name: 'Mutagen',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Mutagen',
        abilities: ['{1}, {T}, Sacrifice this token: Put a +1/+1 counter on target creature. Activate only as a sorcery.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('gold')) {
    return {
      name: 'Gold',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Gold',
        abilities: ['Sacrifice this token: Add one mana of any color.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('stoneforged blade')) {
    return {
      name: 'Stoneforged Blade',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Equipment',
        abilities: ['Indestructible', 'Equipped creature gets +5/+5 and has double strike.', 'Equip {0}'],
        isArtifact: true,
      },
    };
  }

  // This token is commonly created by Toggo, Goblin Weaponsmith.
  if (/\brock\b/i.test(lower)) {
    return {
      name: 'Rock',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Equipment',
        abilities: [
          'Equipped creature has "{1}, {T}, Sacrifice Rock: This creature deals 2 damage to any target."',
          'Equip {1}',
        ],
        isArtifact: true,
      },
    };
  }

  // "Sword" is a common generic Equipment token name.
  if (/\bsword\b/i.test(lower)) {
    return {
      name: 'Sword',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Equipment',
        abilities: ['Equipped creature gets +1/+1', 'Equip {2}'],
        isArtifact: true,
      },
    };
  }

  // Specific named vehicle token (Pia Nalaar, Chief Mechanic).
  if (lower.includes('nalaar aetherjet')) {
    return {
      name: 'Nalaar Aetherjet',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Vehicle',
        abilities: [
          'Flying',
          'Crew 2 (Tap any number of creatures you control with total power 2 or more: This token becomes an artifact creature until end of turn.)',
        ],
        isArtifact: true,
      },
    };
  }

  if (/\bvehicle\b/i.test(lower)) {
    return {
      name: 'Vehicle',
      basePower: 3,
      baseToughness: 2,
      options: {
        colors: [],
        typeLine: 'Token Artifact — Vehicle',
        abilities: ['Crew 1 (Tap any number of creatures you control with total power 1 or more: This token becomes an artifact creature until end of turn.)'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('junk')) {
    return {
      name: 'Junk',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Junk',
        abilities: [
          '{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.',
        ],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('map')) {
    return {
      name: 'Map',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Map',
        abilities: ['{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('powerstone')) {
    return {
      name: 'Powerstone',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Powerstone',
        abilities: ['{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.'],
        isArtifact: true,
      },
    };
  }

  if (lower.includes('blood')) {
    return {
      name: 'Blood',
      options: {
        colors: [],
        typeLine: 'Token Artifact — Blood',
        abilities: ['{1}, {T}, Discard a card, Sacrifice this token: Draw a card.'],
        isArtifact: true,
      },
    };
  }

  return null;
}

function resolveDealDamageTargetToPlayerIds(targetText: string, caster: PlayerID, state: any): PlayerID[] {
  const t = String(targetText || '').trim().toLowerCase();
  if (!t) return [];

  if (t === 'you') return [caster];
  if (t === 'each player') {
    return Array.isArray(state?.players) ? state.players.map((p: any) => p?.id).filter(Boolean) : [];
  }
  if (t === 'each opponent') {
    return Array.isArray(state?.players)
      ? state.players
          .map((p: any) => p?.id)
          .filter((id: any) => id && String(id) !== String(caster))
      : [];
  }

  // Conservatively ignore other targets (e.g., "any target", "target creature", etc.).
  return [];
}

function parseDeterministicManaToPool(manaText: string): { W: number; U: number; B: number; R: number; G: number; C: number } | null {
  const s = String(manaText || '').trim();
  if (!s) return null;
  // Avoid choice/complex symbols like {R/G}, {2/R}, {P}, {S}, etc.
  if (/[\/]|\b(or|either)\b/i.test(s)) return null;

  const out = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(s)) !== null) {
    const sym = String(match[1] || '').trim().toUpperCase();
    if (!sym) continue;
    if (sym === 'W' || sym === 'U' || sym === 'B' || sym === 'R' || sym === 'G' || sym === 'C') {
      (out as any)[sym]++;
      continue;
    }
    if (/^\d+$/.test(sym)) {
      out.C += parseInt(sym, 10);
      continue;
    }
    return null;
  }

  const total = out.W + out.U + out.B + out.R + out.G + out.C;
  return total > 0 ? out : null;
}

function applyOracleIRFallbackForUncategorizedSpell(
  ctx: GameContext,
  oracleText: string,
  caster: PlayerID,
  spellName: string,
  xValue?: number,
  sourcePermanentId?: string,
  sourceId?: string
): number {
  try {
    const text = String(oracleText || '').trim();
    if (!text) return 0;

    // Quick prefilter to keep this conservative and cheap.
    const lower = text.toLowerCase();
    const mightHaveSupported =
      lower.includes('draw') ||
      (lower.includes('exile') && lower.includes('top') && lower.includes('library')) ||
      (lower.includes('add') && lower.includes('{')) ||
      lower.includes('scry') ||
      lower.includes('surveil') ||
      lower.includes('gain') ||
      lower.includes('lose') ||
      lower.includes('discard') ||
      lower.includes('mill') ||
      lower.includes('damage') ||
      lower.includes('deal') ||
      lower.includes('sacrifice') ||
      lower.includes('destroy') ||
      (lower.includes('create') && lower.includes('token'));
    if (!mightHaveSupported) return 0;

    const ir = parseOracleTextToIR(text);
    const steps: OracleEffectStep[] = [];
    for (const ab of ir.abilities || []) {
      for (const s of ab.steps || []) steps.push(s as any);
    }

    let applied = 0;
    for (const step of steps) {
      if (!step || step.kind === 'unknown') continue;
      // If this step is optional, it requires a player choice. Skip for now.
      if ((step as any).optional) continue;

      switch (step.kind) {
        case 'impulse_exile_top': {
          const count = resolveOracleQuantityToNumber((step as any).amount, xValue);
          if (!count || count <= 0) break;

          // For now, only support "you" (the caster/controller). Other selectors could be ambiguous.
          if ((step as any)?.who?.kind && (step as any).who.kind !== 'you') break;

          const duration = (step as any).duration as 'this_turn' | 'until_end_of_next_turn' | undefined;
          if (!duration) break;

          const permission = (step as any).permission as 'play' | 'cast' | undefined;
          if (!permission) break;
          const condition = (step as any).condition as
            | { kind: 'color'; color: 'W' | 'U' | 'B' | 'R' | 'G' }
            | { kind: 'type'; type: 'land' | 'nonland' }
            | undefined;

          const stateAny: any = (ctx as any).state;
          const libraries: any = (ctx as any).libraries;
          if (!libraries || typeof libraries.get !== 'function' || typeof libraries.set !== 'function') break;

          const playerIds = resolveOracleWhoToPlayerIds({ kind: 'you' } as any, caster, stateAny);
          if (playerIds.length === 0) break;

          for (const pid of playerIds) {
            const lib = libraries.get(pid);
            if (!Array.isArray(lib) || lib.length === 0) continue;

            const take = Math.min(count, lib.length);
            const exiledCards: any[] = [];
            for (let i = 0; i < take; i++) {
              const topCard = lib.shift();
              if (topCard) exiledCards.push(topCard);
            }
            libraries.set(pid, lib);

            const zones = stateAny.zones?.[pid];
            if (zones) {
              zones.libraryCount = lib.length;
            }

            if (zones) {
              zones.exile = Array.isArray((zones as any).exile) ? (zones as any).exile : ((zones as any).exile = []);
            }

            stateAny.playableFromExile = stateAny.playableFromExile || {};
            stateAny.playableFromExile[pid] = stateAny.playableFromExile[pid] || {};

            stateAny.pendingImpulseDraws = stateAny.pendingImpulseDraws || {};
            stateAny.pendingImpulseDraws[pid] = stateAny.pendingImpulseDraws[pid] || [];

            const playableUntilTurn =
              duration === 'this_turn'
                ? (stateAny.turnNumber || 0)
                : (stateAny.turnNumber || 0) + 1;

            let grantedCount = 0;

            for (const c of exiledCards) {
              const typeLineLower = String((c as any)?.type_line || '').toLowerCase();
              const isLand = typeLineLower.includes('land');
              const colors = Array.isArray((c as any)?.colors)
                ? (c as any).colors.map((x: any) => String(x || '').toUpperCase())
                : [];

              const passesPermissionGate = permission === 'play' ? true : !isLand;
              let passesConditionGate = true;
              if (condition) {
                if (condition.kind === 'type') {
                  passesConditionGate = condition.type === 'land' ? isLand : !isLand;
                } else if (condition.kind === 'color') {
                  passesConditionGate = colors.includes(condition.color);
                }
              }

              const grantPermission = passesPermissionGate && passesConditionGate;

              const exiledCard = {
                ...c,
                zone: 'exile',
                exiledBy: spellName,
                ...(grantPermission ? { canBePlayedBy: pid, playableUntilTurn } : {}),
              };
              if (zones && Array.isArray((zones as any).exile)) {
                (zones as any).exile.push(exiledCard);
                (zones as any).exileCount = (zones as any).exile.length;
              }

              if (grantPermission) {
                // Gate play/cast permissions (impulse draw) by turn number.
                stateAny.playableFromExile[pid][String(c?.id)] = playableUntilTurn;
                grantedCount++;
              }

              stateAny.pendingImpulseDraws[pid].push({
                cardId: c?.id,
                cardName: c?.name,
                exiledBy: spellName,
                ...(grantPermission ? { playableUntilTurn } : {}),
              });
              // Exiling itself is an applied effect, even if no permission was granted.
              applied += 1;
            }

            if (typeof (ctx as any).bumpSeq === 'function') {
              (ctx as any).bumpSeq();
            }

            debug(
              2,
              `[oracleIR] ${spellName}: exiled ${exiledCards.length} top card(s) from ${pid}'s library (impulse, ${duration}, granted=${grantedCount})`
            );
          }
          break;
        }
        case 'add_mana': {
          const manaPoolDelta = parseDeterministicManaToPool((step as any).mana);
          if (!manaPoolDelta) break;
          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          if (playerIds.length === 0) break;

          for (const pid of playerIds) {
            const stateAny: any = (ctx as any).state;
            stateAny.manaPool = stateAny.manaPool || {};
            stateAny.manaPool[pid] = stateAny.manaPool[pid] || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
            const pool = stateAny.manaPool[pid];
            for (const k of ['W', 'U', 'B', 'R', 'G', 'C']) {
              const delta = Math.max(0, Number((manaPoolDelta as any)?.[k] ?? 0));
              if (!delta) continue;
              if (typeof pool[k] !== 'number') pool[k] = 0;
              pool[k] += delta;
            }
            if (typeof (ctx as any).bumpSeq === 'function') {
              (ctx as any).bumpSeq();
            }
            debug(2, `[oracleIR] ${spellName}: added mana to ${pid}'s pool`);
            applied++;
          }
          break;
        }
        case 'draw': {
          const count = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!count || count <= 0) break;
          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          for (const pid of playerIds) {
            executeSpellEffect(
              ctx,
              { kind: 'DrawCards', playerId: pid, count } as any,
              caster,
              spellName,
              sourcePermanentId
            );
            applied++;
          }
          break;
        }
        case 'scry': {
          const count = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!count || count <= 0) break;
          const gameId = (ctx as any).gameId as string | undefined;
          const isReplaying = !!(ctx as any).isReplaying;
          if (!gameId || gameId === 'unknown' || isReplaying) break;

          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          for (const pid of playerIds) {
            // Avoid duplicates for the same source.
            try {
              const existing = ResolutionQueueManager
                .getStepsForPlayer(gameId, pid as any)
                .find(s => s.type === ResolutionStepType.SCRY && (s as any)?.sourceId && sourceId && String((s as any).sourceId) === String(sourceId));
              if (existing) continue;
            } catch {
              // ignore
            }

            executeSpellEffect(
              ctx,
              { kind: 'QueueScry', playerId: pid, count, sourceId } as any,
              caster,
              spellName,
              sourcePermanentId
            );
            applied++;
          }
          break;
        }
        case 'surveil': {
          const count = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!count || count <= 0) break;
          const gameId = (ctx as any).gameId as string | undefined;
          const isReplaying = !!(ctx as any).isReplaying;
          if (!gameId || gameId === 'unknown' || isReplaying) break;

          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          for (const pid of playerIds) {
            // Avoid duplicates for the same source.
            try {
              const existing = ResolutionQueueManager
                .getStepsForPlayer(gameId, pid as any)
                .find(s => s.type === ResolutionStepType.SURVEIL && (s as any)?.sourceId && sourceId && String((s as any).sourceId) === String(sourceId));
              if (existing) continue;
            } catch {
              // ignore
            }

            executeSpellEffect(
              ctx,
              { kind: 'QueueSurveil', playerId: pid, count, sourceId } as any,
              caster,
              spellName,
              sourcePermanentId
            );
            applied++;
          }
          break;
        }
        case 'gain_life': {
          const amount = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!amount || amount <= 0) break;
          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          for (const pid of playerIds) {
            executeSpellEffect(
              ctx,
              { kind: 'GainLife', playerId: pid, amount } as any,
              caster,
              spellName,
              sourcePermanentId
            );
            applied++;
          }
          break;
        }
        case 'lose_life': {
          const amount = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!amount || amount <= 0) break;
          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          for (const pid of playerIds) {
            executeSpellEffect(
              ctx,
              { kind: 'LoseLife', playerId: pid, amount } as any,
              caster,
              spellName,
              sourcePermanentId
            );
            applied++;
          }
          break;
        }
        case 'sacrifice': {
          // Sacrifice is almost always a player choice; support only the common edict template "sacrifice a creature".
          const whatText = String((step.what as any)?.text || '').trim().toLowerCase();
          if (!whatText) break;
          if (!(whatText === 'a creature' || whatText === 'one creature' || whatText === 'a creature you control')) break;

          const gameId = (ctx as any).gameId as string | undefined;
          const isReplaying = !!(ctx as any).isReplaying;
          if (!gameId || gameId === 'unknown' || isReplaying) break;

          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          if (playerIds.length === 0) break;

          const battlefield = (ctx as any).state?.battlefield || [];
          const players = (ctx as any).state?.players || [];
          const turnOrder: PlayerID[] = Array.isArray(players) ? players.map((p: any) => p?.id).filter((id: any) => typeof id === 'string') : [];
          const activePlayerId: PlayerID =
            (ctx as any).state?.turnPlayer ||
            (ctx as any).state?.activePlayerId ||
            turnOrder[(ctx as any).state?.activePlayerIndex || 0] ||
            caster;

          const configs: any[] = [];
          for (const pid of playerIds) {
            // Avoid duplicates for the same source.
            try {
              const existing = ResolutionQueueManager
                .getStepsForPlayer(gameId, pid as any)
                .find(s => s.type === ResolutionStepType.UPKEEP_SACRIFICE && (s as any)?.sourceId && sourceId && String((s as any).sourceId) === String(sourceId));
              if (existing) continue;
            } catch {
              // ignore
            }

            const creatures = Array.isArray(battlefield)
              ? battlefield
                  .filter((p: any) =>
                    p &&
                    String(p.controller || '') === String(pid) &&
                    String(p.card?.type_line || '').toLowerCase().includes('creature')
                  )
                  .map((p: any) => ({
                    id: p.id,
                    name: p.card?.name || p.id,
                    imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                    typeLine: p.card?.type_line,
                    power: p.basePower,
                    toughness: p.baseToughness,
                  }))
              : [];

            if (creatures.length === 0) continue;

            configs.push({
              type: ResolutionStepType.UPKEEP_SACRIFICE,
              playerId: pid,
              sourceId,
              sourceName: spellName,
              description: `${spellName}: Choose a creature to sacrifice.`,
              mandatory: true,
              hasCreatures: true,
              creatures,
              allowSourceSacrifice: false,
              edictSacrifice: true,
              sourceController: caster,
              reason: 'spell_effect',
            });
          }

          if (configs.length === 0) break;

          try {
            if (turnOrder.length > 0) {
              ResolutionQueueManager.addStepsWithAPNAP(gameId, configs as any, turnOrder as any, activePlayerId as any);
            } else {
              for (const cfg of configs) ResolutionQueueManager.addStep(gameId, cfg);
            }
            applied += configs.length;
          } catch (err) {
            debugWarn(1, `[oracleIR] Failed to queue sacrifice step(s) for ${spellName}:`, err);
          }
          break;
        }
        case 'deal_damage': {
          const dmg = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!dmg || dmg <= 0) break;

          const targetText = (step.target as any)?.text;
          const playerIds = resolveDealDamageTargetToPlayerIds(String(targetText || ''), caster, (ctx as any).state);
          if (playerIds.length === 0) break;

          for (const pid of playerIds) {
            executeSpellEffect(
              ctx,
              { kind: 'DamagePlayer', playerId: pid, amount: dmg } as any,
              caster,
              spellName,
              sourcePermanentId
            );
            applied++;
          }
          break;
        }
        case 'discard': {
          // Discard requires user selection, so use the Resolution Queue.
          const count = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!count || count <= 0) break;

          const gameId = (ctx as any).gameId as string | undefined;
          const isReplaying = !!(ctx as any).isReplaying;
          if (!gameId || gameId === 'unknown' || isReplaying) break;

          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          if (playerIds.length === 0) break;

          const zonesByPlayer = (ctx as any).state?.zones || {};
          for (const pid of playerIds) {
            const zones = zonesByPlayer?.[pid];
            const handCards = Array.isArray(zones?.hand) ? (zones.hand as any[]) : [];
            const handOptions = handCards
              .filter((c: any) => c && c.id)
              .map((c: any) => ({
                id: String(c.id),
                label: String(c.name || 'Unknown'),
                imageUrl: c.imageUrl || c.image_url || c.image_uris?.normal,
              }));

            if (handOptions.length === 0) continue;

            // Avoid duplicates for the same source.
            try {
              const existing = ResolutionQueueManager
                .getStepsForPlayer(gameId, pid as any)
                .find(s => s.type === ResolutionStepType.DISCARD_SELECTION && (s as any)?.sourceId && sourceId && String((s as any).sourceId) === String(sourceId));
              if (existing) continue;
            } catch {
              // ignore
            }

            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.DISCARD_SELECTION,
              playerId: pid as any,
              sourceId: sourceId,
              sourceName: spellName,
              description: `${spellName}: Discard ${count} card(s).`,
              mandatory: true,
              hand: handOptions,
              discardCount: Math.min(count, handOptions.length),
              currentHandSize: handOptions.length,
              maxHandSize: Math.max(0, handOptions.length - count),
              reason: 'spell_effect',
            } as any);

            applied++;
          }
          break;
        }
        case 'mill': {
          const count = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!count || count <= 0) break;

          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          if (playerIds.length === 0) break;

          for (const pid of playerIds) {
            executeSpellEffect(
              ctx,
              { kind: 'MillCards', playerId: pid, count } as any,
              caster,
              spellName,
              sourcePermanentId
            );
            applied++;
          }
          break;
        }
        case 'create_token': {
          const count = resolveOracleQuantityToNumber(step.amount, xValue);
          if (!count || count <= 0) break;

          const rawToken = String((step as any).token || '').trim();
          if (!rawToken) break;

          // Parse common artifact tokens first (Treasure/Clue/Food/etc.).
          const tokenInfo = parseCommonArtifactTokenOptions(rawToken);
          const creatureMatch = !tokenInfo
            ? rawToken.match(/^\s*(\d+)\s*\/\s*(\d+)\s+([\s\S]+?)\s*$/i)
            : null;

          // If we can't confidently parse, skip (avoid wrong tokens).
          if (!tokenInfo && !creatureMatch) break;

          const playerIds = resolveOracleWhoToPlayerIds(step.who, caster, (ctx as any).state);
          if (playerIds.length === 0) break;

          // Compute delayed-trigger fire turn number (match existing planeswalker-template semantics).
          const stateAny = (ctx as any).state as any;
          const currentTurn = Number(stateAny?.turnNumber ?? 0) || 0;
          const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
          const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
          const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
          const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

          // Compute end-of-combat delayed-trigger fire turn number.
          // "At end of combat" means "at the beginning of the end of combat step"; if that step is already
          // reached/passed for the current turn, the delayed trigger should wait for the next turn's end of combat.
          const afterEndCombat =
            inEnding ||
            currentStepUpper === 'END_COMBAT' ||
            currentStepUpper === 'MAIN2' ||
            currentStepUpper === 'END' ||
            currentStepUpper === 'CLEANUP';
          const fireAtCombatTurnNumber = afterEndCombat ? currentTurn + 1 : currentTurn;

          const grantsHaste = (step as any).grantsHaste as ('permanent' | 'until_end_of_turn' | undefined);
          const grantsAbilitiesUntilEndOfTurn = (step as any).grantsAbilitiesUntilEndOfTurn as (string[] | undefined);
          const atNextEndStep = (step as any).atNextEndStep as ('sacrifice' | 'exile' | undefined);
          const atEndOfCombat = (step as any).atEndOfCombat as ('sacrifice' | 'exile' | undefined);

          for (const pid of playerIds) {
            let createdIds: string[] = [];

            if (tokenInfo) {
              createdIds = createToken(
                ctx,
                pid,
                tokenInfo.name,
                count,
                (tokenInfo as any).basePower,
                (tokenInfo as any).baseToughness,
                {
                  ...(tokenInfo.options || {}),
                  ...((step as any).entersTapped ? { entersTapped: true } : {}),
                  ...((step as any).withCounters ? { withCounters: (step as any).withCounters } : {}),
                }
              ) as any;
            } else if (creatureMatch) {
              const power = parseInt(String(creatureMatch[1] || ''), 10);
              const toughness = parseInt(String(creatureMatch[2] || ''), 10);
              if (!Number.isFinite(power) || !Number.isFinite(toughness)) continue;

              const descriptor = String(creatureMatch[3] || '').trim();
              const { name, colors, creatureTypes, abilities } = parseCreateTokenDescriptor(descriptor);
              const typeLine = `Token Creature — ${creatureTypes.length ? creatureTypes.join(' ') : name}`;

              createdIds = createToken(ctx, pid, name, count, power, toughness, {
                colors,
                abilities,
                typeLine,
                ...((step as any).entersTapped ? { entersTapped: true } : {}),
                ...((step as any).withCounters ? { withCounters: (step as any).withCounters } : {}),
              }) as any;
            }

            if (!Array.isArray(createdIds) || createdIds.length === 0) {
              continue;
            }

            // Apply haste grants to created tokens.
            if (grantsHaste) {
              const battlefield = (ctx as any).state?.battlefield || [];
              for (const permId of createdIds) {
                const perm = battlefield.find((p: any) => p?.id === permId);
                if (!perm) continue;

                if (grantsHaste === 'until_end_of_turn') {
                  (perm as any).tempAbilities = Array.isArray((perm as any).tempAbilities) ? (perm as any).tempAbilities : [];
                  if (!(perm as any).tempAbilities.some((a: any) => String(a).toLowerCase() === 'haste')) {
                    (perm as any).tempAbilities.push('haste');
                  }
                } else {
                  (perm as any).grantedAbilities = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
                  if (!(perm as any).grantedAbilities.some((a: any) => String(a).toLowerCase() === 'haste')) {
                    (perm as any).grantedAbilities.push('Haste');
                  }
                }
              }
            }

            // Apply other keyword abilities until end of turn.
            if (Array.isArray(grantsAbilitiesUntilEndOfTurn) && grantsAbilitiesUntilEndOfTurn.length > 0) {
              const battlefield = (ctx as any).state?.battlefield || [];
              for (const permId of createdIds) {
                const perm = battlefield.find((p: any) => p?.id === permId);
                if (!perm) continue;

                (perm as any).tempAbilities = Array.isArray((perm as any).tempAbilities) ? (perm as any).tempAbilities : [];
                for (const rawAbility of grantsAbilitiesUntilEndOfTurn) {
                  const ability = String(rawAbility || '').trim().toLowerCase();
                  if (!ability) continue;
                  if (!(perm as any).tempAbilities.some((a: any) => String(a).trim().toLowerCase() === ability)) {
                    (perm as any).tempAbilities.push(ability);
                  }
                }
              }
            }

            // Schedule delayed sacrifice/exile at next end step for created tokens.
            if (atNextEndStep) {
              if (atNextEndStep === 'sacrifice') {
                stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
                  ? stateAny.pendingSacrificeAtNextEndStep
                  : [];
                for (const id of createdIds) {
                  stateAny.pendingSacrificeAtNextEndStep.push({
                    permanentId: id,
                    fireAtTurnNumber,
                    maxManaValue: 0,
                    sourceName: spellName,
                    createdBy: pid,
                  });
                }
              } else {
                stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
                  ? stateAny.pendingExileAtNextEndStep
                  : [];
                for (const id of createdIds) {
                  stateAny.pendingExileAtNextEndStep.push({
                    permanentId: id,
                    fireAtTurnNumber,
                    sourceName: spellName,
                    createdBy: pid,
                  });
                }
              }
            }

            // Schedule delayed sacrifice/exile at end of combat for created tokens.
            if (atEndOfCombat) {
              if (atEndOfCombat === 'sacrifice') {
                stateAny.pendingSacrificeAtEndOfCombat = Array.isArray(stateAny.pendingSacrificeAtEndOfCombat)
                  ? stateAny.pendingSacrificeAtEndOfCombat
                  : [];
                for (const id of createdIds) {
                  stateAny.pendingSacrificeAtEndOfCombat.push({
                    permanentId: id,
                    fireAtTurnNumber: fireAtCombatTurnNumber,
                    maxManaValue: 0,
                    sourceName: spellName,
                    createdBy: pid,
                  });
                }
              } else {
                stateAny.pendingExileAtEndOfCombat = Array.isArray(stateAny.pendingExileAtEndOfCombat)
                  ? stateAny.pendingExileAtEndOfCombat
                  : [];
                for (const id of createdIds) {
                  stateAny.pendingExileAtEndOfCombat.push({
                    permanentId: id,
                    fireAtTurnNumber: fireAtCombatTurnNumber,
                    sourceName: spellName,
                    createdBy: pid,
                  });
                }
              }
            }

            applied++;
          }
          break;
        }
        case 'destroy': {
          const targetText = String((step as any)?.target?.text || (step as any)?.target?.raw || '').trim().toLowerCase();
          if (!targetText) break;

          // Skip anything with targeting/choice/relative qualifiers.
          // NOTE: We *do* allow some controller filters (see below).
          if (/\b(?:target|chosen|choose|each|other|another)\b/.test(targetText)) break;

          // Optional controller filter suffixes we can deterministically support.
          let controllerFilter: 'any' | 'you' | 'opponents' = 'any';
          let filteredTargetText = targetText;

          if (/\s+you\s+(?:don'?t|do not)\s+control\b$/.test(filteredTargetText)) {
            controllerFilter = 'opponents';
            filteredTargetText = filteredTargetText.replace(/\s+you\s+(?:don'?t|do not)\s+control\b$/, '').trim();
          } else if (/\s+you\s+control\b$/.test(filteredTargetText)) {
            controllerFilter = 'you';
            filteredTargetText = filteredTargetText.replace(/\s+you\s+control\b$/, '').trim();
          } else if (/\s+your\s+opponents\s+control\b$/.test(filteredTargetText)) {
            controllerFilter = 'opponents';
            filteredTargetText = filteredTargetText.replace(/\s+your\s+opponents\s+control\b$/, '').trim();
          } else if (/\s+opponents\s+control\b$/.test(filteredTargetText)) {
            controllerFilter = 'opponents';
            filteredTargetText = filteredTargetText.replace(/\s+opponents\s+control\b$/, '').trim();
          } else if (/\s+an?\s+opponent\s+controls\b$/.test(filteredTargetText)) {
            controllerFilter = 'opponents';
            filteredTargetText = filteredTargetText.replace(/\s+an?\s+opponent\s+controls\b$/, '').trim();
          }

          // Conservative: only support simple mass-wipe templates ("destroy all <type(s)>" or "destroy all nonland permanents").
          if (!/^all\s+/.test(filteredTargetText)) break;

          const controllerAllows = (perm: any) => {
            const controller = String(perm?.controller || '');
            if (!controller) return false;
            if (controllerFilter === 'you') return controller === caster;
            if (controllerFilter === 'opponents') return controller !== caster;
            return true;
          };

          const targetRemainder = filteredTargetText.replace(/^all\s+/, '').trim();
          const battlefield = (ctx as any).state?.battlefield || [];
          if (!Array.isArray(battlefield) || battlefield.length === 0) break;

          let predicate: ((perm: any) => boolean) | null = null;

          if (/^nonland\s+permanents?\b/.test(targetRemainder)) {
            predicate = (perm: any) => {
              if (!controllerAllows(perm)) return false;
              return !String(perm?.card?.type_line || '').toLowerCase().includes('land');
            };
          } else {
            const cleaned = targetRemainder.replace(/\bpermanents?\b/, '').trim();
            if (!cleaned) break;

            const parts = cleaned.split(/\s*(?:,|and\/or|and|or)\s*/i).filter(Boolean);
            if (parts.length === 0) break;

            const allowed = new Set(['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle']);
            const types: string[] = [];

            for (const part of parts) {
              let t = part.trim().toLowerCase();
              if (t.endsWith('s')) t = t.slice(0, -1);
              if (!allowed.has(t)) {
                types.length = 0;
                break;
              }
              types.push(t);
            }

            if (types.length === 0) break;

            predicate = (perm: any) => {
              if (!controllerAllows(perm)) return false;
              const tl = String(perm?.card?.type_line || '').toLowerCase();
              return types.some(t => tl.includes(t));
            };
          }

          if (!predicate) break;

          const toDestroy = battlefield.filter(predicate);
          if (toDestroy.length === 0) break;

          for (const perm of toDestroy) {
            if (!perm?.id) continue;
            movePermanentToGraveyard(ctx, String(perm.id), true);
            applied++;
          }
          break;
        }
        default:
          break;
      }
    }

    if (applied > 0) {
      debug(2, `[oracleIR] Fallback applied ${applied} step(s) for ${spellName}`);
    }
    return applied;
  } catch (err) {
    debugWarn(2, `[oracleIR] Fallback failed for ${spellName}:`, err);
    return 0;
  }
}

/**
 * Mapping of irregular plural creature types to their singular forms.
 * Used when counting creatures of a specific type (e.g., Myrel counting Soldiers).
 * Type lines use singular forms (e.g., "Creature - Elf") but oracle text often uses
 * plural forms (e.g., "number of Elves you control").
 */
const IRREGULAR_PLURALS: Record<string, string> = {
  'elves': 'elf',
  'wolves': 'wolf',
  'dwarves': 'dwarf',
  'halves': 'half',
  'leaves': 'leaf',
  'knives': 'knife',
  'lives': 'life',
  'selves': 'self',
  'calves': 'calf',
};

/**
 * Convert number words to numeric values.
 * Handles common patterns in MTG oracle text.
 */
const WORD_TO_NUMBER: Record<string, number> = {
  'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
};

function applyExplicitDayNightChangeFromText(state: any, rawText: string): void {
  if (!state || !rawText) return;
  try {
    // Normalize curly apostrophes and lowercase for matching.
    const text = String(rawText).replace(/\u2019/g, "'").toLowerCase();

    // Avoid false positives from daybound/nightbound reminder text (often contains "it becomes night/day next turn").
    if (text.includes('daybound') || text.includes('nightbound')) return;

    // Common toggle templates (e.g., The Celestus).
    const toggleNightToDay = /if\s+(?:it'?s|it\s+is)\s+night\s*,\s*it\s+becomes\s+day\b[\s\S]*?otherwise\s*,\s*it\s+becomes\s+night\b/.test(text);
    const toggleDayToNight = /if\s+(?:it'?s|it\s+is)\s+day\s*,\s*it\s+becomes\s+night\b[\s\S]*?otherwise\s*,\s*it\s+becomes\s+day\b/.test(text);
    if (toggleNightToDay) {
      setDayNightState(state, state.dayNight === 'night' ? 'day' : 'night');
      return;
    }
    if (toggleDayToNight) {
      setDayNightState(state, state.dayNight === 'day' ? 'night' : 'day');
      return;
    }

    // Conditional-only templates (no explicit "Otherwise" clause).
    // These must respect the current day/night state; if it's neither day nor night, do nothing.
    const conditionalDayToNight = /\bif\s+(?:it'?s|it\s+is)\s+day\s*,?\s*it\s+becomes\s+night\b/.test(text);
    const conditionalNightToDay = /\bif\s+(?:it'?s|it\s+is)\s+night\s*,?\s*it\s+becomes\s+day\b/.test(text);
    if (conditionalDayToNight) {
      if (state.dayNight === 'day') setDayNightState(state, 'night');
      return;
    }
    if (conditionalNightToDay) {
      if (state.dayNight === 'night') setDayNightState(state, 'day');
      return;
    }

    if (/\bit\s+becomes\s+day\b/.test(text)) {
      setDayNightState(state, 'day');
      return;
    }
    if (/\bit\s+becomes\s+night\b/.test(text)) {
      setDayNightState(state, 'night');
      return;
    }
  } catch {
    // best-effort
  }
}

/**
 * Parse a number from a word or numeric string.
 * @param word The word or number string to parse
 * @param defaultValue Value to return if parsing fails (default: 1)
 */
function parseNumberWord(word: string | undefined, defaultValue: number = 1): number {
  if (!word) return defaultValue;
  const lower = word.toLowerCase();
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  const num = parseInt(lower, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Add a creature type to a permanent's type line.
 * Handles the parsing and formatting of the type line correctly.
 * @param creature The creature permanent to modify
 * @param typeToAdd The creature type to add (e.g., "Angel", "Zombie")
 */
function addCreatureType(creature: any, typeToAdd: string): void {
  if (!creature?.card) {
    creature.card = creature.card || {};
  }
  const currentTypeLine = creature.card.type_line || '';
  const typeToAddLower = typeToAdd.toLowerCase();
  
  // Check if type already exists
  if (currentTypeLine.toLowerCase().includes(typeToAddLower)) {
    return;
  }
  
  // Format: "Creature — Human Soldier" -> "Creature — Human Soldier Angel"
  if (currentTypeLine.includes('—')) {
    creature.card.type_line = currentTypeLine + ' ' + typeToAdd;
  } else {
    creature.card.type_line = currentTypeLine + ' — ' + typeToAdd;
  }
  
  // Track added types
  creature.addedTypes = creature.addedTypes || [];
  if (!creature.addedTypes.includes(typeToAdd)) {
    creature.addedTypes.push(typeToAdd);
  }
}

/**
 * Detect "enters with counters" patterns from a card's oracle text.
 * Handles patterns like:
 * - "~ enters the battlefield with N +1/+1 counter(s) on it"
 * - "~ enters with N +1/+1 counter(s)"
 * - Saga cards entering with lore counters
 * - Creatures with fabricate, modular, etc.
 * 
 * @param card - The card to analyze
 * @returns Object with counter types and amounts to add on ETB
 */
export function detectEntersWithCounters(card: any): Record<string, number> {
  const counters: Record<string, number> = {};
  if (!card) return counters;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  
  // Pattern: "enters the battlefield with N +1/+1 counter(s) on it"
  // Also matches: "~ enters with N +1/+1 counters"
  // Also matches: "This creature enters with N +1/+1 counter(s)"
  // Combined pattern to avoid duplicate matches
  // Note: We already lowercased oracleText, so all text is lowercase
  const counterPattern = /(?:~|this creature)\s+(?:enters|comes into play)(?: the battlefield)? with (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s*([+\-\d\/]+|\w+)\s*counters?\s*(?:on it)?/gi;
  
  // Track matched positions to avoid duplicates
  const matchedRanges = new Set<string>();
  let match;
  counterPattern.lastIndex = 0;
  while ((match = counterPattern.exec(oracleText)) !== null) {
    const matchKey = `${match.index}-${match[0].length}`;
    if (matchedRanges.has(matchKey)) continue;
    matchedRanges.add(matchKey);
    
    let countStr = match[1].toLowerCase();
    let counterType = match[2].trim();
    
    // Convert word numbers to digits
    const wordToNum: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
    };
    const count = wordToNum[countStr] !== undefined ? wordToNum[countStr] : parseInt(countStr, 10);
    
    if (!isNaN(count) && count > 0) {
      counters[counterType] = (counters[counterType] || 0) + count;
    }
  }
  
  // Saga cards enter with 1 lore counter (Rule 714.3a)
  // Check for Saga in type line
  if (typeLine.includes('saga')) {
    counters['lore'] = (counters['lore'] || 0) + 1;
  }
  
  // Modular N - enters with N +1/+1 counters (Rule 702.43a)
  const modularMatch = oracleText.match(/modular\s+(\d+)/i);
  if (modularMatch) {
    const n = parseInt(modularMatch[1], 10);
    if (!isNaN(n) && n > 0) {
      counters['+1/+1'] = (counters['+1/+1'] || 0) + n;
    }
  }
  
  // Fabricate N - may be distributed (simplified - puts on self if creature)
  const fabricateMatch = oracleText.match(/fabricate\s+(\d+)/i);
  if (fabricateMatch && typeLine.includes('creature')) {
    const n = parseInt(fabricateMatch[1], 10);
    if (!isNaN(n) && n > 0) {
      // For simplicity, default to +1/+1 counters on self
      // (Real implementation would ask player)
      counters['+1/+1'] = (counters['+1/+1'] || 0) + n;
    }
  }
  
  // Unleash - may enter with +1/+1 counter (simplified - always add)
  if (oracleText.includes('unleash')) {
    counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
  }
  
  // Undying creatures returning (handled by death trigger, not here)
  
  // Ravenous - if X >= 5 (handled separately with X value)
  return counters;
}

/**
 * Handle Dispatch and similar metalcraft-conditional spells.
 * Dispatch: "Tap target creature. Metalcraft — If you control three or more artifacts, exile that creature instead."
 * 
 * @returns true if the spell was handled
 */
function handleDispatch(
  ctx: GameContext, 
  card: any, 
  controller: PlayerID, 
  targets: any[], 
  state: any
): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  
  // Check for Dispatch specifically or similar patterns
  // Pattern: "Tap target creature. Metalcraft — ... exile that creature instead"
  const isDispatchPattern = 
    cardName.includes('dispatch') ||
    (oracleText.includes('tap target creature') && 
     oracleText.includes('metalcraft') && 
     oracleText.includes('exile'));
  
  if (!isDispatchPattern || targets.length === 0) {
    return false;
  }
  
  const battlefield = state.battlefield || [];
  const targetPerm = battlefield.find((p: any) => p?.id === targets[0] || p?.id === targets[0]?.id);
  
  if (!targetPerm) {
    debug(2, `[handleDispatch] Target not found on battlefield`);
    return false;
  }
  
  // Check metalcraft using the centralized function
  const metalcraftActive = hasMetalcraft(ctx, controller);
  
  if (metalcraftActive) {
    // Exile the creature instead of tapping
    const permIndex = battlefield.indexOf(targetPerm);
    if (permIndex !== -1) {
      battlefield.splice(permIndex, 1);
      
      // Tokens cease to exist when they leave the battlefield - don't add to exile zone
      if (targetPerm.isToken || targetPerm.card?.isToken) {
        debug(2, `[handleDispatch] Metalcraft active - ${targetPerm.card?.name || targetPerm.id} token ceases to exist (not added to exile)`);
      } else {
        // Move non-token to exile zone
        const owner = targetPerm.owner || targetPerm.controller;
        const zones = state.zones || {};
        zones[owner] = zones[owner] || { hand: [], graveyard: [], exile: [] };
        zones[owner].exile = zones[owner].exile || [];
        zones[owner].exile.push({ ...targetPerm.card, zone: 'exile' });
        zones[owner].exileCount = zones[owner].exile.length;
        
        debug(2, `[handleDispatch] Metalcraft active (${countArtifacts(ctx, controller)} artifacts) - exiled ${targetPerm.card?.name || targetPerm.id}`);
      }
    }
  } else {
    // Just tap the creature
    targetPerm.tapped = true;
    debug(1, `[handleDispatch] Metalcraft inactive (${countArtifacts(ctx, controller)} artifacts) - tapped ${targetPerm.card?.name || targetPerm.id}`);
  }
  
  return true;
}

/**
 * Check if a card's metalcraft ability is active and apply appropriate effects.
 * This handles both spells and permanents with metalcraft.
 * Uses the centralized hasMetalcraft/countArtifacts from game-state-effects.
 * 
 * @param ctx - The game context
 * @param oracleText - The card's oracle text
 * @param controllerId - The controller's ID
 * @returns Object with metalcraft status and any special effects
 */
function evaluateMetalcraft(
  ctx: GameContext,
  oracleText: string, 
  controllerId: string
): { isActive: boolean; artifactCount: number; effects: string[] } {
  const text = oracleText.toLowerCase();
  
  // Check if the card even has metalcraft
  if (!text.includes('metalcraft')) {
    return { isActive: false, artifactCount: 0, effects: [] };
  }
  
  const artifactCount = countArtifacts(ctx, controllerId);
  const isActive = hasMetalcraft(ctx, controllerId);
  const effects: string[] = [];
  
  if (isActive) {
    // Parse metalcraft effects
    // Common patterns:
    // "Metalcraft — [effect]" or "Metalcraft — As long as you control three or more artifacts, [effect]"
    
    // Equipment equip cost reduction (Puresteel Paladin)
    if (text.includes('equip costs') && (text.includes('{0}') || text.includes('cost {0}'))) {
      effects.push('equip_cost_zero');
    }
    
    // Draw on artifact ETB (Puresteel Paladin)
    if (text.includes('whenever an equipment enters') && text.includes('draw a card')) {
      effects.push('draw_on_equipment_etb');
    }
    
    // Indestructible (Darksteel Juggernaut has no metalcraft but similar)
    if (text.includes('indestructible')) {
      effects.push('indestructible');
    }
    
    // +2/+2 bonus (Carapace Forger)
    if (text.match(/gets?\s+\+(\d+)\/\+(\d+)/)) {
      effects.push('power_toughness_bonus');
    }
    
    // Exile instead of other effect (Dispatch)
    if (text.includes('exile') && text.includes('instead')) {
      effects.push('exile_instead');
    }
  }
  
  return { isActive, artifactCount, effects };
}

/**
 * Helper function to check if any opponent controls more lands than the controller.
 * Used for conditional triggers like Knight of the White Orchid, Land Tax, Gift of Estates.
 * 
 * @param state - Game state
 * @param controller - Player ID to check lands for
 * @returns Object with myLandCount and anyOpponentHasMoreLands boolean
 */
function checkOpponentHasMoreLands(state: any, controller: PlayerID): { myLandCount: number; anyOpponentHasMoreLands: boolean } {
  const battlefield = state.battlefield || [];
  const players = state.players || [];
  
  const myLandCount = battlefield.filter((p: any) => 
    p.controller === controller && 
    (p.card?.type_line || '').toLowerCase().includes('land')
  ).length;
  
  const opponentIds = players
    .filter((p: any) => p.id !== controller && !p.hasLost)
    .map((p: any) => p.id);
  
  const anyOpponentHasMoreLands = opponentIds.some((oppId: string) => {
    const oppLandCount = battlefield.filter((p: any) => 
      p.controller === oppId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    ).length;
    return oppLandCount > myLandCount;
  });
  
  return { myLandCount, anyOpponentHasMoreLands };
}

/**
 * Stack / resolution helpers (extracted).
 *
 * Exports:
 * - pushStack
 * - resolveTopOfStack
 * - playLand
 * - castSpell
 * - exileEntireStack
 *
 * exileEntireStack moves all items from the stack into controller exile zones
 * (ctx.state.zones[controller].exile). It returns the number of items exiled and bumps seq.
 * It is conservative and defensive about shapes so it won't throw on unexpected input.
 */

/**
 * Check if a spell is a tutor (search library effect) and return search details.
 * This handles cards like Demonic Tutor, Vampiric Tutor, Diabolic Tutor, etc.
 */
function detectTutorSpell(oracleText: string): { 
  isTutor: boolean; 
  searchCriteria?: string; 
  destination?: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split';
  optional?: boolean;
  maxSelections?: number;
  /** For split-destination effects like Kodama's Reach/Cultivate */
  splitDestination?: boolean;
  /** Number of cards to put on battlefield for split effects */
  toBattlefield?: number;
  /** Number of cards to put in hand for split effects */
  toHand?: number;
  /** Whether cards enter battlefield tapped */
  entersTapped?: boolean;
} {
  if (!oracleText) return { isTutor: false };
  
  const text = oracleText.toLowerCase();
  
  // Must have "search your library" pattern
  if (!text.includes('search your library')) {
    return { isTutor: false };
  }
  
  let searchCriteria = '';
  let destination: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split' = 'hand';
  let optional = false;
  let maxSelections = 1;
  
  // Detect what type of card to search for and how many
  const forMatch = text.match(/search your library for (?:a|an|up to (\w+)) ([^,.]+)/i);
  if (forMatch) {
    // Check for "up to N" pattern
    if (forMatch[1]) {
      const num = forMatch[1].toLowerCase();
      if (num === 'two') maxSelections = 2;
      else if (num === 'three') maxSelections = 3;
      else if (num === 'four') maxSelections = 4;
      else {
        const parsed = parseInt(num, 10);
        if (!isNaN(parsed)) maxSelections = parsed;
      }
    }
    searchCriteria = forMatch[2].trim();
  }
  
  // Check for optional search (contains "may")
  if (text.includes('you may search')) {
    optional = true;
  }
  
  // SPECIAL CASE: Kodama's Reach / Cultivate pattern
  // "put one onto the battlefield tapped and the other into your hand"
  if (text.includes('put one onto the battlefield') && text.includes('the other into your hand')) {
    const entersTapped = text.includes('battlefield tapped') || text.includes('enters tapped');
    return {
      isTutor: true,
      searchCriteria,
      destination: 'split',
      optional,
      maxSelections: 2,
      splitDestination: true,
      toBattlefield: 1,
      toHand: 1,
      entersTapped,
    };
  }
  
  // Detect destination - order matters! More specific patterns first
  
  // Top of library patterns (Vampiric Tutor, Mystical Tutor, Worldly Tutor, Enlightened Tutor)
  if (text.includes('put it on top of your library') || 
      text.includes('put that card on top of your library') ||
      text.includes('put it on top') ||
      text.includes('put that card on top')) {
    destination = 'top';
  }
  // Battlefield patterns (Green Sun's Zenith, Chord of Calling, Natural Order)
  else if (text.includes('put it onto the battlefield') || 
           text.includes('put that card onto the battlefield') ||
           text.includes('put onto the battlefield') ||
           text.includes('enters the battlefield') ||
           text.includes('enters tapped')) {
    destination = 'battlefield';
  }
  // Graveyard patterns (Entomb, Buried Alive)
  else if (text.includes('put it into your graveyard') || 
           text.includes('put that card into your graveyard') ||
           text.includes('put into your graveyard')) {
    destination = 'graveyard';
  }
  // Hand patterns (Demonic Tutor, Diabolic Tutor, Grim Tutor)
  // Default is hand
  
  return { isTutor: true, searchCriteria, destination, optional, maxSelections };
}

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();
  
  // Check for creature types after "—" or "-"
  const dashIndex = lower.indexOf("—") !== -1 ? lower.indexOf("—") : lower.indexOf("-");
  if (dashIndex !== -1) {
    const subtypes = lower.slice(dashIndex + 1).trim().split(/\s+/);
    types.push(...subtypes.filter(t => t.length > 0));
  }
  
  return types;
}

/**
 * Check if a creature entering the battlefield would have haste
 * from effects already on the battlefield.
 * 
 * This is used when determining if a creature should have summoning sickness.
 * Rule 702.10: Haste allows a creature to attack and use tap abilities immediately.
 */
export function creatureWillHaveHaste(
  card: any,
  controller: string,
  battlefield: any[]
): boolean {
  try {
    const cardTypeLine = (card?.type_line || "").toLowerCase();
    const cardOracleText = (card?.oracle_text || "").toLowerCase();
    
    // 1. Check if the creature itself has haste
    if (cardOracleText.includes('haste')) {
      return true;
    }
    
    // 2. Check battlefield for permanents that grant haste
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      
      // Check for "creatures you control have haste" effects
      if (grantorController === controller) {
        if (grantorOracle.includes('creatures you control have haste') ||
            grantorOracle.includes('other creatures you control have haste')) {
          return true;
        }
        
        // Check for "activate abilities... as though... had haste" effects
        // This covers Thousand-Year Elixir: "You may activate abilities of creatures 
        // you control as though those creatures had haste."
        if (grantorOracle.includes('as though') && 
            grantorOracle.includes('had haste') &&
            (grantorOracle.includes('creatures you control') || 
             grantorOracle.includes('activate abilities'))) {
          return true;
        }
        
        // Check for tribal haste grants (e.g., "Goblin creatures you control have haste")
        // Optimization: Use indexOf instead of creating RegExp for each creature type
        const creatureTypes = extractCreatureTypes(cardTypeLine);
        for (const creatureType of creatureTypes) {
          const typeIndex = grantorOracle.indexOf(creatureType);
          const hasteIndex = grantorOracle.indexOf('have haste');
          // Check if creature type appears before "have haste" with no period between them
          if (typeIndex !== -1 && hasteIndex !== -1 && typeIndex < hasteIndex) {
            const textBetween = grantorOracle.slice(typeIndex, hasteIndex);
            if (!textBetween.includes('.')) {
              return true;
            }
          }
        }
      }
      
      // Check for effects that grant haste to all creatures
      if (grantorOracle.includes('all creatures have haste') ||
          grantorOracle.includes('each creature has haste')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, '[creatureWillHaveHaste] Error checking haste:', err);
    return false;
  }
}

function enqueueLibrarySearchStep(
  ctx: GameContext,
  controller: PlayerID,
  options: {
    description?: string;
    searchFor?: string;
    destination?: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split';
    tapped?: boolean;
    optional?: boolean;
    source?: string;
    shuffleAfter?: boolean;
    filter?: any;
    maxSelections?: number;
    minSelections?: number;
    reveal?: boolean;
    remainderDestination?: string;
    splitDestination?: boolean;
    toBattlefield?: number;
    toHand?: number;
    entersTapped?: boolean;
    lifeLoss?: number;
  }
): void {
  const gameId = (ctx as any).gameId || 'unknown';
  const lib = ctx.libraries?.get(controller) || [];
  if (!lib.length) {
    debug(2, `[enqueueLibrarySearchStep] Player ${controller} has empty library, skipping search`);
    return;
  }

  const {
    description = options.searchFor || 'Search your library',
    searchFor = 'a card',
    destination = 'hand',
    tapped = false,
    optional = false,
    source = 'Library Search',
    shuffleAfter = true,
    filter = {},
    maxSelections = 1,
    minSelections = optional ? 0 : 1,
    reveal = true,
    remainderDestination = 'shuffle',
    splitDestination = false,
    toBattlefield = 0,
    toHand = 0,
    entersTapped = tapped,
    lifeLoss,
  } = options;

  // Map all library cards with full data
  const allCards = lib.map((card: any) => ({
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: (card as any).power,
    toughness: (card as any).toughness,
    loyalty: (card as any).loyalty,
  }));
  
  // Apply filter to get available cards that match criteria
  // Build a game state context for calculating variable P/T
  const gameStateForCDA = {
    battlefield: (ctx as any).state?.battlefield || [],
    zones: (ctx as any).state?.zones || {},
    players: (ctx as any).state?.players || [],
    life: (ctx as any).state?.life || {},
    manaPool: (ctx as any).state?.manaPool || {},
  };
  
  const availableCards = allCards.filter((card: any) => {
    let matches = true;
    
    // Check types
    if (filter.types && filter.types.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = filter.types.some((type: string) => typeLine.includes(type.toLowerCase()));
    }
    
    // Check subtypes
    if (matches && filter.subtypes && filter.subtypes.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = filter.subtypes.some((subtype: string) => typeLine.includes(subtype.toLowerCase()));
    }
    
    // Check max power (e.g., "power 2 or less" - Imperial Recruiter)
    // Handle both numeric and variable (*) power via CDA calculation
    if (matches && typeof filter.maxPower === 'number') {
      if (card.power !== undefined && card.power !== null) {
        const powerStr = String(card.power);
        const powerNum = parseInt(powerStr, 10);
        if (!isNaN(powerNum)) {
          // Standard numeric power
          matches = powerNum <= filter.maxPower;
        } else if (powerStr.includes('*')) {
          // Variable power - calculate via CDA
          // Set owner/controller for CDA calculation
          const cardWithOwner = { ...card, owner: controller, controller: controller };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.power <= filter.maxPower;
          }
          // If CDA returns undefined, allow the card (can't determine)
        }
        // Other non-numeric formats: allow the card
      }
      // If power is undefined (non-creature), don't filter based on power
    }
    
    // Check max toughness (e.g., "toughness 2 or less" - Recruiter of the Guard)
    // Handle both numeric and variable (*) toughness via CDA calculation
    if (matches && typeof filter.maxToughness === 'number') {
      if (card.toughness !== undefined && card.toughness !== null) {
        const toughnessStr = String(card.toughness);
        const toughnessNum = parseInt(toughnessStr, 10);
        if (!isNaN(toughnessNum)) {
          // Standard numeric toughness
          matches = toughnessNum <= filter.maxToughness;
        } else if (toughnessStr.includes('*')) {
          // Variable toughness - calculate via CDA
          // Set owner/controller for CDA calculation
          const cardWithOwner = { ...card, owner: controller, controller: controller };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.toughness <= filter.maxToughness;
          }
          // If CDA returns undefined, allow the card (can't determine)
        }
        // Other non-numeric formats: allow the card
      }
      // If toughness is undefined (non-creature), don't filter based on toughness
    }
    
    // Check max CMC
    if (matches && typeof filter.maxCmc === 'number') {
      matches = (card.cmc || 0) <= filter.maxCmc;
    }
    
    // Check min CMC (e.g., "mana value 6 or greater" - Fierce Empath)
    if (matches && typeof filter.minCmc === 'number') {
      matches = (card.cmc || 0) >= filter.minCmc;
    }
    
    return matches;
  });

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: controller as PlayerID,
    description,
    mandatory: !optional,
    sourceName: source,
    searchCriteria: searchFor,
    minSelections,
    maxSelections,
    destination,
    reveal,
    shuffleAfter,
    availableCards,
    entersTapped,
    remainderDestination,
    remainderRandomOrder: true,
    splitDestination,
    toBattlefield,
    toHand,
    filter,
    lifeLoss,
  });
}

/**
 * Check if a creature should enter the battlefield tapped due to effects on the battlefield.
 * This handles cards like:
 * - Authority of the Consuls: "Creatures your opponents control enter the battlefield tapped."
 * - Blind Obedience: "Artifacts and creatures your opponents control enter the battlefield tapped."
 * - Urabrask the Hidden: "Creatures your opponents control enter the battlefield tapped."
 * - Imposing Sovereign: "Creatures your opponents control enter the battlefield tapped."
 * - Thalia, Heretic Cathar: "Creatures and nonbasic lands your opponents control enter the battlefield tapped."
 * - Frozen Aether: "Permanents your opponents control enter the battlefield tapped."
 * - Kismet: "Artifacts, creatures, and lands your opponents play come into play tapped."
 * 
 * @param battlefield - All permanents on the battlefield
 * @param creatureController - The player who controls the entering creature
 * @param creatureCard - The creature card entering
 * @returns true if the creature should enter tapped
 */
export function checkCreatureEntersTapped(
  battlefield: any[],
  creatureController: string,
  creatureCard: any
): boolean {
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    const permController = perm.controller;
    
    // Skip if this is controlled by the same player (these effects affect opponents)
    if (permController === creatureController) continue;
    
    // Authority of the Consuls: "Creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('authority of the consuls') ||
        (oracleText.includes('creatures your opponents control enter') && oracleText.includes('tapped'))) {
      debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Blind Obedience: "Artifacts and creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('blind obedience') ||
        (oracleText.includes('artifacts and creatures your opponents control enter') && oracleText.includes('tapped'))) {
      debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Urabrask the Hidden: "Creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('urabrask the hidden') ||
        cardName.includes('urabrask,')) {
      if (oracleText.includes('creatures your opponents control enter') && oracleText.includes('tapped')) {
        debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
        return true;
      }
    }
    
    // Imposing Sovereign: "Creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('imposing sovereign')) {
      debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Thalia, Heretic Cathar: "Creatures and nonbasic lands your opponents control enter the battlefield tapped."
    if (cardName.includes('thalia, heretic cathar') ||
        (oracleText.includes('creatures') && oracleText.includes('your opponents control enter') && oracleText.includes('tapped'))) {
      debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Frozen Aether: "Permanents your opponents control enter the battlefield tapped."
    if (cardName.includes('frozen aether') ||
        (oracleText.includes('permanents your opponents control enter') && oracleText.includes('tapped'))) {
      debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Kismet: "Artifacts, creatures, and lands your opponents play come into play tapped."
    if (cardName.includes('kismet') ||
        (oracleText.includes('creatures') && oracleText.includes('your opponents') && oracleText.includes('play') && oracleText.includes('tapped'))) {
      debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Generic pattern detection: "creatures your opponents control enter the battlefield tapped"
    // This catches future cards with similar text
    if (oracleText.includes('creatures') && 
        oracleText.includes('opponents') && 
        oracleText.includes('control') &&
        oracleText.includes('enter') && 
        oracleText.includes('battlefield') &&
        oracleText.includes('tapped')) {
      debug(2, `[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'} (generic pattern)`);
      return true;
    }
  }
  
  return false;
}

/* Push an item onto the stack */
export function pushStack(
  ctx: GameContext,
  item: {
    id: string;
    controller: PlayerID;
    card: any;
    targets?: string[];
  }
) {
  const { state } = ctx;

  // Turn-tracking for intervening-if templates like "if you've committed a crime this turn".
  // Conservative: only record `true` when we have positive evidence.
  try {
    const controllerId = String((item as any)?.controller ?? '');
    const targets = Array.isArray((item as any)?.targets) ? ((item as any).targets as any[]) : [];
    if (controllerId && targets.length > 0) {
      const playerIds = new Set(
        Array.isArray((state as any).players) ? ((state as any).players as any[]).map((p: any) => String(p?.id ?? '')).filter(Boolean) : []
      );
      const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
      let committed = false;
      for (const t of targets) {
        const tid = String(typeof t === 'string' ? t : (t as any)?.id ?? '');
        if (!tid) continue;
        if (playerIds.has(tid)) {
          if (tid !== controllerId) {
            committed = true;
            break;
          }
          continue;
        }
        const perm = battlefield.find((p: any) => String(p?.id ?? '') === tid);
        const permController = perm?.controller ? String(perm.controller) : '';
        if (permController && permController !== controllerId) {
          committed = true;
          break;
        }
      }
      if (committed) {
        const stateAny = state as any;
        stateAny.committedCrimeThisTurn = stateAny.committedCrimeThisTurn || {};
        stateAny.committedCrimeThisTurn[controllerId] = true;
        stateAny.crimeCommittedThisTurn = stateAny.crimeCommittedThisTurn || {};
        stateAny.crimeCommittedThisTurn[controllerId] = true;
        stateAny.hasCommittedCrimeThisTurn = stateAny.hasCommittedCrimeThisTurn || {};
        stateAny.hasCommittedCrimeThisTurn[controllerId] = true;
      }
    }
  } catch {
    // best-effort only
  }

  state.stack = state.stack || [];
  state.stack.push(item as any);
  ctx.bumpSeq();
}

/* Pop and return the top stack item (internal helper) */
function popStackItem(ctx: GameContext) {
  const s = ctx.state;
  if (!s.stack || s.stack.length === 0) return null;
  return s.stack.pop()!;
}

/**
 * Check if a card type line represents a permanent (not instant/sorcery)
 */
/**
 * Check if a card's colors match a color restriction string.
 * Used for color-restricted ETB triggers (e.g., "whenever another white or black creature enters")
 * 
 * @param restriction - The color restriction text (e.g., "white or black", "red", "nonwhite")
 * @param cardColors - The entering card's colors array (e.g., ['W', 'B'] or ['white', 'black'])
 * @returns true if the card matches the color restriction
 */
function matchesColorRestriction(restriction: string, cardColors: string[]): boolean {
  const lowerRestriction = restriction.toLowerCase();
  const colors = cardColors || [];
  
  // Handle "nonX" restrictions first (e.g., "nonwhite", "nonblack")
  if (lowerRestriction.startsWith('non')) {
    const excludedColor = lowerRestriction.slice(3);
    const colorMap: Record<string, string> = { 'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G' };
    const excludedColorCode = colorMap[excludedColor];
    return excludedColorCode ? !colors.includes(excludedColorCode) : true;
  }
  
  // Parse color restriction (e.g., "white or black", "red")
  // Card matches if it has ANY of the mentioned colors
  let matchesColor = false;
  if (lowerRestriction.includes('white') && (colors.includes('W') || colors.includes('white'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('black') && (colors.includes('B') || colors.includes('black'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('blue') && (colors.includes('U') || colors.includes('blue'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('red') && (colors.includes('R') || colors.includes('red'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('green') && (colors.includes('G') || colors.includes('green'))) {
    matchesColor = true;
  }
  
  return matchesColor;
}

function isPermanentTypeLine(typeLine?: string): boolean {
  if (!typeLine) return false;
  const tl = typeLine.toLowerCase();
  // Instants and sorceries are not permanents
  if (/\binstant\b/.test(tl) || /\bsorcery\b/.test(tl)) return false;
  // Everything else that can be cast is a permanent (creature, artifact, enchantment, planeswalker, battle)
  return /\b(creature|artifact|enchantment|planeswalker|battle)\b/.test(tl);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTypeLineForMatching(typeLine: string): string {
  // Replace em dash separators and normalize to spaces so word-boundary matching works.
  return String(typeLine || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/—/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function typeLineHasAllWords(typeLine: string, phrase: string): boolean {
  const tl = normalizeTypeLineForMatching(typeLine);
  const tokens = String(phrase || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((tok) => new RegExp(`\\b${escapeRegExp(tok)}\\b`, 'i').test(tl));
}

function matchesRequiredTypePhrase(typeLine: string, requiredPhrase: string, isToken: boolean): boolean {
  let phrase = String(requiredPhrase || '').toLowerCase().trim();
  if (!phrase) return true;

  const hasNontoken = /\b(?:nontoken|non-token)\b/i.test(phrase);
  const hasTokenWord = /\btoken\b/i.test(phrase);

  if (hasNontoken && isToken) return false;
  if (!hasNontoken && hasTokenWord && !isToken) return false;

  // Strip token qualifiers from the phrase so the remaining words match the actual type line.
  phrase = phrase
    .replace(/\b(?:nontoken|non-token)\b/gi, '')
    .replace(/\btoken\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return typeLineHasAllWords(typeLine, phrase);
}

/**
 * Check for ETB triggers from other permanents when a token enters the battlefield.
 * This handles effects like Cathars' Crusade, Soul Warden, etc. that trigger
 * when creatures enter the battlefield (including tokens).
 * 
 * @param ctx - Game context
 * @param token - The token permanent that just entered
 * @param controller - Controller of the token
 */
export function triggerETBEffectsForToken(
  ctx: GameContext,
  token: any,
  controller: PlayerID
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;
  
  const isCreature = (token.card?.type_line || '').toLowerCase().includes('creature');
  const isLand = (token.card?.type_line || '').toLowerCase().includes('land');
  const isArtifact = (token.card?.type_line || '').toLowerCase().includes('artifact');
  const isEnchantment = (token.card?.type_line || '').toLowerCase().includes('enchantment');
  const isPlaneswalker = (token.card?.type_line || '').toLowerCase().includes('planeswalker');
  const isBattle = (token.card?.type_line || '').toLowerCase().includes('battle');
  const isToken = true; // By definition, this is a token

  // Track "entered this turn" counters for intervening-if templates.
  // (Tokens can matter here: e.g. Treasures for artifact ETBs.)
  if (!isLand) {
    (state as any).nonlandPermanentsEnteredBattlefieldThisTurn = (state as any).nonlandPermanentsEnteredBattlefieldThisTurn || {};
    const key = String(controller);
    (state as any).nonlandPermanentsEnteredBattlefieldThisTurn[key] =
      ((state as any).nonlandPermanentsEnteredBattlefieldThisTurn[key] || 0) + 1;
  }
  if (isLand) {
    (state as any).landsEnteredBattlefieldThisTurn = (state as any).landsEnteredBattlefieldThisTurn || {};
    const key = String(controller);
    (state as any).landsEnteredBattlefieldThisTurn[key] = ((state as any).landsEnteredBattlefieldThisTurn[key] || 0) + 1;
  }
  if (isCreature) {
    (state as any).creaturesEnteredBattlefieldThisTurnByController = (state as any).creaturesEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).creaturesEnteredBattlefieldThisTurnByController[key] =
      ((state as any).creaturesEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    // Track creature ETB ids this turn (used for "another creature" intervening-if templates).
    (state as any).creaturesEnteredBattlefieldThisTurnIdsByController =
      (state as any).creaturesEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).creaturesEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(token.id)] = true;
  }
  if (isArtifact) {
    (state as any).artifactsEnteredBattlefieldThisTurnByController = (state as any).artifactsEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).artifactsEnteredBattlefieldThisTurnByController[key] =
      ((state as any).artifactsEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).artifactsEnteredBattlefieldThisTurnIdsByController =
      (state as any).artifactsEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).artifactsEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(token.id)] = true;
  }
  if (isEnchantment) {
    (state as any).enchantmentsEnteredBattlefieldThisTurnByController =
      (state as any).enchantmentsEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).enchantmentsEnteredBattlefieldThisTurnByController[key] =
      ((state as any).enchantmentsEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).enchantmentsEnteredBattlefieldThisTurnIdsByController =
      (state as any).enchantmentsEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).enchantmentsEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(token.id)] = true;
  }
  if (isPlaneswalker) {
    (state as any).planeswalkersEnteredBattlefieldThisTurnByController = (state as any).planeswalkersEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).planeswalkersEnteredBattlefieldThisTurnByController[key] =
      ((state as any).planeswalkersEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).planeswalkersEnteredBattlefieldThisTurnIdsByController =
      (state as any).planeswalkersEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).planeswalkersEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(token.id)] = true;
  }
  if (isBattle) {
    (state as any).battlesEnteredBattlefieldThisTurnByController = (state as any).battlesEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).battlesEnteredBattlefieldThisTurnByController[key] =
      ((state as any).battlesEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).battlesEnteredBattlefieldThisTurnIdsByController = (state as any).battlesEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).battlesEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(token.id)] = true;
  }
  
  // Check all other permanents for triggers that fire when creatures/permanents enter
  for (const perm of state.battlefield) {
    if (!perm || perm.id === token.id) continue;
    
    const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      if (trigger.triggerType === 'creature_etb' && isCreature) {
        // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
        if ((trigger as any).nontokenOnly && isToken) {
          continue; // Skip - this trigger only fires for nontoken creatures
        }

        // Check if this trigger requires token creatures.
        if ((trigger as any).tokenOnly && !isToken) {
          continue;
        }
        
        // Check if this trigger requires the entering creature to be controlled by the trigger's controller
        // (e.g., Aura Shards: "Whenever a creature you control enters")
        if ((trigger as any).controlledOnly) {
          const triggerController = perm.controller || controller;
          if (controller !== triggerController) {
            continue; // Skip - entering creature is not controlled by trigger's controller
          }
        }
        
        // Check if this trigger requires a specific type phrase (e.g., "token creature", "artifact creature", "Bear").
        const requiredTypeRaw = typeof (trigger as any).requiredTypePhrase === 'string' ? String((trigger as any).requiredTypePhrase) : '';
        const requiredType = requiredTypeRaw.replace(/\bcreatures\b/gi, 'creature').replace(/\bartifacts\b/gi, 'artifact').trim();
        if (requiredType) {
          const enteringTypeLine = String(token.card?.type_line || '');
          if (!matchesRequiredTypePhrase(enteringTypeLine, requiredType, isToken)) {
            continue;
          }
        }
        
        // Determine trigger controller
        const triggerController = perm.controller || controller;

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        // These ETB triggers come from OTHER permanents (not the entering token), so we must filter here.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            const controlledOnly = !!(trigger as any).controlledOnly;
            textForEval = controlledOnly
              ? `Whenever a creature you control enters the battlefield, ${textForEval}`
              : `Whenever a creature enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            perm,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        // Push trigger onto the stack
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any);
        
        debug(2, `[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // another_permanent_etb triggers
      if (trigger.triggerType === 'another_permanent_etb') {
        // Check if this trigger only fires on creatures (creatureOnly flag)
        if ((trigger as any).creatureOnly && !isCreature) {
          continue; // Skip - this trigger only fires on creatures
        }
        
        const triggerController = perm.controller || controller;

                const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
                const needsThatPlayerRef = /\bthat player\b/i.test(desc);
                const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;
        
        // For another_permanent_etb, check if the entering permanent is controlled by the trigger's controller
        // This is the "under your control" restriction
        if (controller !== triggerController) {
          continue; // Skip - entering permanent is not controlled by trigger's controller
        }

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever another permanent enters the battlefield under your control, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            perm,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any);
        
        debug(2, `[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // permanent_etb triggers (Altar of the Brood style - triggers on ANY permanent)
      if (trigger.triggerType === 'permanent_etb') {
        const triggerController = perm.controller || controller;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever a permanent enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            perm,
            /\bthat player\b/i.test(textForEval) && String(controller || '')
              ? {
                  thatPlayerId: String(controller),
                  referencedPlayerId: String(controller),
                  theirPlayerId: String(controller),
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
        } as any);
        
        debug(2, `[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // opponent_creature_etb triggers (Suture Priest, Authority of the Consuls)
      // These trigger when a creature enters under an OPPONENT's control
      if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
        const triggerController = perm.controller;
        // Only fire if the entering creature is controlled by an opponent of the trigger controller
        if (triggerController && triggerController !== controller) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          try {
            const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
            let textForEval = desc;
            if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
              textForEval = `Whenever a creature enters the battlefield under an opponent's control, ${textForEval}`;
            }
            const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
            const satisfied = isInterveningIfSatisfied(
              ctx as any,
              String(triggerController),
              textForEval,
              perm,
              needsThatPlayerRef && String(controller || '')
                ? {
                    thatPlayerId: String(controller),
                    referencedPlayerId: String(controller),
                    theirPlayerId: String(controller),
                  }
                : undefined
            );
            if (satisfied === false) {
              debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
              continue;
            }
          } catch {
            // Conservative fallback: keep the trigger if evaluation fails.
          }

          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: perm.id,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            // Store the entering creature's controller for effects like "that player loses 1 life"
            targetPlayer: controller,
          } as any);
          
          debug(2, `[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
        }
      }
    }
  }
}

/**
 * Trigger ETB effects when a permanent enters the battlefield.
 * This is used for flickered permanents returning, as well as other ETB scenarios.
 * Note: The permanent's own ETB trigger (if any) is handled separately when the 
 * permanent resolves from the stack.
 */
export function triggerETBEffectsForPermanent(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;

  // Day/Night: ensure the game gains a designation when a daybound/nightbound permanent is present.
  try {
    ensureInitialDayNightDesignationFromBattlefield(state as any);
  } catch {}

  // Daybound replacement effect: if it's night, daybound permanents enter transformed.
  try {
    const dn = (state as any).dayNight;
    if (dn === 'night') {
      const card: any = permanent?.card;
      const oracle = String(card?.oracle_text || '').toLowerCase();
      const layout = card?.layout;
      if ((layout === 'transform' || layout === 'double_faced_token') && Array.isArray(card?.card_faces) && oracle.includes('daybound')) {
        // Apply transforms for the current designation (this will flip eligible daybound permanents).
        applyDayNightTransforms(state as any);
      }
    }
  } catch {}
  
  const isCreature = (permanent.card?.type_line || '').toLowerCase().includes('creature');
  const isLand = (permanent.card?.type_line || '').toLowerCase().includes('land');
  const isArtifact = (permanent.card?.type_line || '').toLowerCase().includes('artifact');
  const isEnchantment = (permanent.card?.type_line || '').toLowerCase().includes('enchantment');
  const isPlaneswalker = (permanent.card?.type_line || '').toLowerCase().includes('planeswalker');
  const isBattle = (permanent.card?.type_line || '').toLowerCase().includes('battle');
  const isToken = permanent.isToken === true;

  // Track nonland-permanent entries for "this turn" oracle checks.
  if (!isLand) {
    (state as any).nonlandPermanentsEnteredBattlefieldThisTurn = (state as any).nonlandPermanentsEnteredBattlefieldThisTurn || {};
    const key = String(controller);
    (state as any).nonlandPermanentsEnteredBattlefieldThisTurn[key] =
      ((state as any).nonlandPermanentsEnteredBattlefieldThisTurn[key] || 0) + 1;
  }

  // Track land entries for "this turn" oracle checks.
  if (isLand) {
    (state as any).landsEnteredBattlefieldThisTurn = (state as any).landsEnteredBattlefieldThisTurn || {};
    const key = String(controller);
    (state as any).landsEnteredBattlefieldThisTurn[key] = ((state as any).landsEnteredBattlefieldThisTurn[key] || 0) + 1;
  }

  // Track creature entries for "this turn" oracle checks.
  if (isCreature) {
    (state as any).creaturesEnteredBattlefieldThisTurnByController = (state as any).creaturesEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).creaturesEnteredBattlefieldThisTurnByController[key] = ((state as any).creaturesEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    // Track face-down creature ETBs this turn (for intervening-if templates like "if a face-down creature entered ... under your control this turn").
    try {
      const isFaceDown =
        (permanent as any)?.faceDown === true || (permanent as any)?.isFaceDown === true || (permanent as any)?.faceDownCreature === true;
      if (isFaceDown) {
        (state as any).faceDownCreaturesEnteredBattlefieldThisTurnByController =
          (state as any).faceDownCreaturesEnteredBattlefieldThisTurnByController || {};
        (state as any).faceDownCreaturesEnteredBattlefieldThisTurnByController[key] =
          ((state as any).faceDownCreaturesEnteredBattlefieldThisTurnByController[key] || 0) + 1;
      }
    } catch {
      // best-effort tracking only
    }

    // Track creature ETB ids this turn (used for "another creature" intervening-if templates).
    (state as any).creaturesEnteredBattlefieldThisTurnIdsByController =
      (state as any).creaturesEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).creaturesEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(permanent.id)] = true;

    // Track creature subtype ETBs this turn (for templates like "if an Elf entered the battlefield under your control this turn").
    try {
      const typeLineRaw = String(permanent?.card?.type_line || '');
      const typeLineLower = typeLineRaw.toLowerCase();
      const dashSplit = typeLineLower.split(/—|\s-\s/);
      const subtypePart = dashSplit.length > 1 ? dashSplit.slice(1).join(' ') : '';
      const subtypeTokens = subtypePart
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9-]/g, '').trim())
        .filter(Boolean);

      if (subtypeTokens.length) {
        (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype =
          (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype || {};
        const byController = (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype;
        byController[key] = byController[key] || {};
        for (const st of subtypeTokens) {
          byController[key][st] = (byController[key][st] || 0) + 1;
        }
      }
    } catch {
      // best-effort tracking only
    }
  }

  // Track artifact entries for "this turn" oracle checks.
  if (isArtifact) {
    (state as any).artifactsEnteredBattlefieldThisTurnByController = (state as any).artifactsEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).artifactsEnteredBattlefieldThisTurnByController[key] =
      ((state as any).artifactsEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).artifactsEnteredBattlefieldThisTurnIdsByController =
      (state as any).artifactsEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).artifactsEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(permanent.id)] = true;
  }

  // Track enchantment entries for "this turn" oracle checks.
  if (isEnchantment) {
    (state as any).enchantmentsEnteredBattlefieldThisTurnByController =
      (state as any).enchantmentsEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).enchantmentsEnteredBattlefieldThisTurnByController[key] =
      ((state as any).enchantmentsEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).enchantmentsEnteredBattlefieldThisTurnIdsByController =
      (state as any).enchantmentsEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).enchantmentsEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(permanent.id)] = true;
  }

  // Track planeswalker entries for "this turn" oracle checks.
  if (isPlaneswalker) {
    (state as any).planeswalkersEnteredBattlefieldThisTurnByController = (state as any).planeswalkersEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).planeswalkersEnteredBattlefieldThisTurnByController[key] =
      ((state as any).planeswalkersEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).planeswalkersEnteredBattlefieldThisTurnIdsByController =
      (state as any).planeswalkersEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).planeswalkersEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(permanent.id)] = true;
  }

  // Track battle entries for "this turn" oracle checks.
  if (isBattle) {
    (state as any).battlesEnteredBattlefieldThisTurnByController = (state as any).battlesEnteredBattlefieldThisTurnByController || {};
    const key = String(controller);
    (state as any).battlesEnteredBattlefieldThisTurnByController[key] =
      ((state as any).battlesEnteredBattlefieldThisTurnByController[key] || 0) + 1;

    (state as any).battlesEnteredBattlefieldThisTurnIdsByController = (state as any).battlesEnteredBattlefieldThisTurnIdsByController || {};
    const byController = (state as any).battlesEnteredBattlefieldThisTurnIdsByController;
    byController[key] = byController[key] || {};
    byController[key][String(permanent.id)] = true;
  }
  
  // Check all other permanents for triggers that fire when creatures/permanents enter
  for (const perm of state.battlefield) {
    if (!perm || perm.id === permanent.id) continue;
    
    const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      if (trigger.triggerType === 'creature_etb' && isCreature) {
        // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
        if ((trigger as any).nontokenOnly && isToken) {
          continue;
        }

        // Check if this trigger requires token creatures.
        if ((trigger as any).tokenOnly && !isToken) {
          continue;
        }
        
        // Check if this trigger requires the entering creature to be controlled by the trigger's controller
        // (e.g., Aura Shards: "Whenever a creature you control enters")
        if ((trigger as any).controlledOnly) {
          const triggerController = perm.controller || controller;
          if (controller !== triggerController) {
            continue; // Skip - entering creature is not controlled by trigger's controller
          }
        }
        
        // Check if this trigger requires a specific type phrase (e.g., "token creature", "artifact creature", "Bear").
        const requiredTypeRaw = typeof (trigger as any).requiredTypePhrase === 'string' ? String((trigger as any).requiredTypePhrase) : '';
        const requiredType = requiredTypeRaw.replace(/\bcreatures\b/gi, 'creature').replace(/\bartifacts\b/gi, 'artifact').trim();
        if (requiredType) {
          const enteringTypeLine = String(permanent.card?.type_line || '');
          if (!matchesRequiredTypePhrase(enteringTypeLine, requiredType, isToken)) {
            continue;
          }
        }
        
        const triggerController = perm.controller || controller;
        state.stack = state.stack || [];
        const triggerId = uid("trigger");

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        // These ETB triggers come from OTHER permanents (not the entering permanent), so we must filter here.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            const controlledOnly = !!(trigger as any).controlledOnly;
            textForEval = controlledOnly
              ? `Whenever a creature you control enters the battlefield, ${textForEval}`
              : `Whenever a creature enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            perm,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any);
        
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // another_permanent_etb triggers
      if (trigger.triggerType === 'another_permanent_etb') {
        // Check if this trigger only fires on creatures (creatureOnly flag)
        if ((trigger as any).creatureOnly && !isCreature) {
          continue; // Skip - this trigger only fires on creatures
        }
        
        const triggerController = perm.controller || controller;

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;
        
        // For another_permanent_etb, check if the entering permanent is controlled by the trigger's controller
        // This is the "under your control" restriction
        if (controller !== triggerController) {
          continue; // Skip - entering permanent is not controlled by trigger's controller
        }

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever another permanent enters the battlefield under your control, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            perm,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any);
        
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // permanent_etb triggers (Altar of the Brood style)
      if (trigger.triggerType === 'permanent_etb') {
        const triggerController = perm.controller || controller;

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever a permanent enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            perm,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any);
        
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // opponent_creature_etb triggers (Suture Priest, Authority of the Consuls)
      // These trigger when a creature enters under an OPPONENT's control
      if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
        const triggerController = perm.controller;
        // Only fire if the entering creature is controlled by an opponent of the trigger controller
        if (triggerController && triggerController !== controller) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          try {
            const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
            let textForEval = desc;
            if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
              textForEval = `Whenever a creature enters the battlefield under an opponent's control, ${textForEval}`;
            }
            const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
            const satisfied = isInterveningIfSatisfied(
              ctx as any,
              String(triggerController),
              textForEval,
              perm,
              needsThatPlayerRef && String(controller || '')
                ? {
                    thatPlayerId: String(controller),
                    referencedPlayerId: String(controller),
                    theirPlayerId: String(controller),
                  }
                : undefined
            );
            if (satisfied === false) {
              debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
              continue;
            }
          } catch {
            // Conservative fallback: keep the trigger if evaluation fails.
          }

          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: perm.id,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            // Store the entering creature's controller for effects like "that player loses 1 life"
            targetPlayer: controller,
          } as any);
          
          debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
        }
      }
    }
  }
  
  // Also check if the permanent itself has ETB triggers
  const selfTriggers = getETBTriggersForPermanent(permanent.card, permanent);
  for (const trigger of selfTriggers) {
    if (trigger.triggerType === 'etb') {
      const triggerController = controller;
      state.stack = state.stack || [];
      const triggerId = uid("trigger");

      // Intervening-if triggers (e.g., "When ... enters..., if ...").
      // If the condition is recognized and false at trigger time, do not create the trigger.
      try {
        const desc = String((trigger as any)?.description || "").trim();
        let textForEval = desc;
        if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
          textForEval = `When ~ enters the battlefield, ${textForEval}`;
        }
        const satisfied = isInterveningIfSatisfied(
          ctx as any,
          String(triggerController),
          textForEval,
          permanent,
          /\bthat player\b/i.test(textForEval)
            ? {
                thatPlayerId: String(triggerController),
                referencedPlayerId: String(triggerController),
                theirPlayerId: String(triggerController),
              }
            : undefined
        );
        if (satisfied === false) {
          debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
          continue;
        }
      } catch {
        // Conservative fallback: if we can't evaluate, keep the trigger.
      }
      
      // Build the trigger object with proper structure
      // The stack doesn't have strict typing, but we define the expected shape here
      const triggerObj = {
        id: triggerId,
        type: 'triggered_ability' as const,
        controller: triggerController,
        source: permanent.id,
        sourceName: trigger.cardName,
        description: trigger.description,
        triggerType: trigger.triggerType,
        mandatory: trigger.mandatory,
        // Targeting properties (optional)
        requiresTarget: trigger.requiresTarget || false,
        targetType: trigger.targetType,
        targetConstraint: trigger.targetConstraint,
        needsTargetSelection: trigger.requiresTarget || false,
      };
      
      state.stack.push(triggerObj);
      
      debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s own ETB trigger: ${trigger.description}${trigger.requiresTarget ? ` (requires ${trigger.targetType} target)` : ''}`);
    }
  }
  
  // Check for pending control change effects (Vislor Turlough, Xantcha, Akroan Horse)
  if ((permanent as any).pendingControlChange) {
    const controlChangeInfo = (permanent as any).pendingControlChange;
    debug(2, `[triggerETBEffectsForPermanent] ${permanent.card?.name} has pending control change: ${controlChangeInfo.type}`);
    
    // Queue a resolution step for the control change
    const gameId = (ctx as any).gameId || 'unknown';
    const { ResolutionQueueManager, ResolutionStepType } = require('../resolution/index.js');
    
    if (controlChangeInfo.type === 'may_give_opponent' || controlChangeInfo.type === 'enters_under_opponent_control') {
      const isOptional = controlChangeInfo.type === 'may_give_opponent';
      
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: controller,
        description: isOptional 
          ? `${permanent.card?.name}: You may have an opponent gain control of it`
          : `${permanent.card?.name}: Choose an opponent to control this permanent`,
        mandatory: !isOptional,
        sourceId: permanent.id,
        sourceName: permanent.card?.name,
        sourceImage: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
        promptTitle: isOptional ? "Control Change (Optional)" : "Choose Opponent",
        promptDescription: isOptional
          ? `Do you want to give control of ${permanent.card?.name} to an opponent? If you do, it will be goaded.`
          : `Choose which opponent will control ${permanent.card?.name}.`,
        options: [], // Will be filled with opponent list by the resolution handler
        controlChangeData: {
          permanentId: permanent.id,
          isOptional,
          goadsOnChange: controlChangeInfo.goadsOnChange || false,
          mustAttackEachCombat: controlChangeInfo.mustAttackEachCombat || false,
          cantAttackOwner: controlChangeInfo.cantAttackOwner || false,
        },
      });
      debug(2, `[triggerETBEffectsForPermanent] Queued control change step for ${permanent.card?.name} (optional: ${isOptional})`);
    }
  }
}

/**
 * Execute a triggered ability effect based on its description.
 * Handles common trigger effects like life gain/loss, counters, draw, etc.
 */
function executeTriggerEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any
): void {
  const state = (ctx as any).state;
  if (!state) return;

  let desc = String(description || "").replace(/[’]/g, "'").toLowerCase();

  // Many trigger detectors store the comma-delimited fragment starting with an intervening-if clause
  // (e.g. "if that player has two or fewer cards in hand, that player loses 3 life.").
  // For effect execution, strip a leading "if <cond>," prefix (but never strip the common effect-only
  // conditional template "If you do, ...").
  if (/^if\s+/.test(desc) && desc.includes(',') && !/^if\s+you\s+do\b/.test(desc)) {
    const commaIndex = desc.indexOf(',');
    if (commaIndex > 0) {
      const maybeClause = desc.slice(0, commaIndex);
      // Avoid stripping effect-only conditionals we intentionally *don't* treat as intervening-if.
      if (!/^if\s+you\s+do\b/.test(maybeClause)) {
        desc = desc.slice(commaIndex + 1).trim();
      }
    }
  }

  // ===== DELAYED CLEANUP TRIGGERS (NEXT END STEP / END OF COMBAT) =====
  // These are synthetic triggers created by the engine to deterministically perform
  // token cleanup like "Exile them at end of combat" / "Sacrifice them at the beginning
  // of the next end step".
  try {
    const action = (triggerItem as any)?.delayedAction as ('exile' | 'sacrifice' | undefined);
    const permanentIds = (triggerItem as any)?.delayedPermanentIds as (string[] | undefined);
    const delayedSourceName = String((triggerItem as any)?.delayedSourceName || sourceName || 'Delayed trigger');

    if ((action === 'exile' || action === 'sacrifice') && Array.isArray(permanentIds) && permanentIds.length > 0) {
      const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];

      for (const rawId of permanentIds) {
        const permanentId = String(rawId || '').trim();
        if (!permanentId) continue;

        const perm = battlefield.find((p: any) => p?.id === permanentId);
        if (!perm) continue;

        if (action === 'exile') {
          movePermanentToExile(ctx, permanentId, {
            exiledWithSourceName: delayedSourceName,
          });
          continue;
        }

        // Sacrifice: you can only sacrifice permanents you control.
        const permController = String((perm as any)?.controller || (perm as any)?.owner || '').trim();
        if (permController && String(controller) && permController !== String(controller)) {
          continue;
        }

        // Best-effort tracking used by some intervening-if templates.
        try {
          const stateAny = state as any;
          const key = String(controller || permController || '').trim();
          if (key) {
            stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
            stateAny.permanentsSacrificedThisTurn[key] = (stateAny.permanentsSacrificedThisTurn[key] || 0) + 1;

            const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
            const nm = String((perm as any)?.card?.name || '').toLowerCase();
            const isFood = tl.includes('food') && (tl.includes('artifact') || tl.includes('token'));
            if (isFood && (nm === 'food' || tl.includes('— food') || tl.includes('- food') || tl.includes('food'))) {
              stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
              stateAny.foodsSacrificedThisTurn[key] = (stateAny.foodsSacrificedThisTurn[key] || 0) + 1;
            }
          }
        } catch {
          // best-effort only
        }

        movePermanentToGraveyard(ctx, permanentId, true);
      }

      return;
    }
  } catch {
    // Fall through to normal effect parsing.
  }
  const startingLife = state.startingLife || 40;

  // ===== GENERIC ORACLE-TEXT HOOKS =====
  // These are common stateful effects referenced by intervening-if clauses.
  // They are intentionally lightweight and run before other pattern matching.
  if (desc.includes('become the monarch') || desc.includes('you become the monarch')) {
    (state as any).monarch = controller;
  }

  if (desc.includes('take the initiative') || desc.includes('you take the initiative')) {
    (state as any).initiative = controller;
  }

  if (desc.includes("you get the city's blessing")) {
    (state as any).cityBlessing = (state as any).cityBlessing || {};
    (state as any).cityBlessing[String(controller)] = true;
  }

  if (desc.includes('you win the game') && !(state as any).gameOver) {
    (state as any).winner = controller;
    (state as any).gameOver = true;
    (state as any).winCondition = `${sourceName}: you win the game`;
  }
  
  // Ensure life dictionary exists
  if (!state.life) {
    state.life = {};
  }
  
  // Get all players for "each opponent" effects
  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  
  // Helper to modify life and sync to player object
  const modifyLife = (playerId: string, delta: number) => {
    const currentLife = state.life[playerId] ?? startingLife;
    state.life[playerId] = currentLife + delta;
    
    // Sync to player object
    const player = players.find((p: any) => p.id === playerId);
    if (player) {
      player.life = state.life[playerId];
    }
    
    const action = delta > 0 ? 'gained' : 'lost';
    const amount = Math.abs(delta);
    debug(2, `[executeTriggerEffect] ${playerId} ${action} ${amount} life (${currentLife} -> ${state.life[playerId]})`);
  };
  
  // ===== SPECIAL HANDLERS =====
  // These need to be checked before general pattern matching
  
  // ===== REBOUND TRIGGER HANDLING =====
  // When a rebound trigger resolves, create a modal choice for the player
  // The player may cast the spell from exile without paying its mana cost
  const triggerTypeFromTrigger = (triggerItem as any).triggerType;
  if (triggerTypeFromTrigger === 'rebound') {
    const reboundCardId = (triggerItem as any).reboundCardId;
    const reboundCard = (triggerItem as any).card;
    const gameId = (ctx as any).gameId || 'unknown';
    const isReplaying = !!(ctx as any).isReplaying;
    
    if (isReplaying) {
      debug(2, `[executeTriggerEffect] Rebound: skipping resolution steps during replay`);
      return;
    }
    
    // Create a resolution step for the player to choose whether to cast
    const stepConfig = {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: controller,
      description: `Rebound: You may cast ${sourceName} from exile without paying its mana cost.`,
      mandatory: false,
      sourceId: reboundCardId,
      sourceName: sourceName,
      sourceImage: reboundCard?.image_uris?.small || reboundCard?.image_uris?.normal,
      reboundCard: reboundCard,
      reboundCardId: reboundCardId,
      options: [
        { id: 'cast', label: `Cast ${sourceName}` },
        { id: 'decline', label: 'Decline (goes to graveyard)' },
      ],
      minSelections: 1,
      maxSelections: 1,
    };
    
    ResolutionQueueManager.addStep(gameId, stepConfig);
    
    debug(2, `[executeTriggerEffect] Rebound: Created choice step for ${sourceName}`);
    return;
  }
  
  // Handle Elixir of Immortality - "You gain 5 life. Shuffle this artifact and your graveyard into their owner's library."
  if (sourceName.toLowerCase().includes('elixir of immortality') ||
      (desc.includes('shuffle') && desc.includes('graveyard') && desc.includes('into') && desc.includes('library'))) {
    // Gain 5 life
    modifyLife(controller, 5);
    debug(2, `[executeTriggerEffect] Elixir of Immortality: ${controller} gained 5 life`);
    
    // Trigger life gain effects
    triggerLifeGainEffects(state, controller, 5);
    
    // Shuffle graveyard and the artifact into library using the utility
    const sourceId = (triggerItem as any).source; // The permanent ID of the elixir
    const shuffledCount = handleElixirShuffle(ctx, controller, sourceId);
    
    debug(1, `[executeTriggerEffect] Elixir of Immortality: shuffled ${shuffledCount} cards into ${controller}'s library`);
    
    return; // Early return, effect is fully handled
  }
  
  // ========================================================================
  // UPKEEP SACRIFICE TRIGGERS
  // Handle "sacrifice a creature or sacrifice [this]" style triggers
  // Examples: Eldrazi Monument, Demonic Appetite, Jinxed Idol
  // Pattern: "Sacrifice a creature. If you can't, sacrifice ~" or
  //          "Sacrifice a creature or sacrifice ~"
  // 
  // This handles both:
  // 1. triggerType === 'sacrifice_creature_or_self' (from dynamic detection)
  // 2. Description-based detection for legacy/fallback
  // ========================================================================
  const triggerTypeFromItem = (triggerItem as any).triggerType;
  const isUpkeepSacrificeTrigger = (
    triggerTypeFromItem === 'sacrifice_creature_or_self' ||
    (desc.includes('sacrifice a creature') && 
     (desc.includes("or sacrifice") || desc.includes("if you can't") || desc.includes("if you cannot")))
  );
  
  if (isUpkeepSacrificeTrigger) {
    const gameId = (ctx as any).gameId || (ctx as any).id || triggerItem?.gameId || 'unknown';
    const isReplaying = !!(ctx as any).isReplaying;
    
    if (isReplaying) {
      debug(2, `[executeTriggerEffect] Upkeep sacrifice: skipping resolution steps during replay`);
      return;
    }
    
    // Get creatures controlled by this player
    const battlefield = state.battlefield || [];
    const controllerCreatures = battlefield.filter((perm: any) => {
      if (perm.controller !== controller) return false;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });
    
    // Get the source permanent (e.g., Eldrazi Monument)
    const sourceId = (triggerItem as any).source || (triggerItem as any).permanentId || (triggerItem as any).sourceId;
    const sourcePermanent = battlefield.find((p: any) => p.id === sourceId);
    const sourceTypeLine = (sourcePermanent?.card?.type_line || '').toLowerCase();
    
    // Determine what type of permanent to sacrifice if no creature available
    // "sacrifice Eldrazi Monument" -> artifact
    // "sacrifice ~" -> this artifact/enchantment/etc
    let alternativeSacrificeType = 'this permanent';
    if (sourceTypeLine.includes('artifact')) {
      alternativeSacrificeType = 'this artifact';
    } else if (sourceTypeLine.includes('enchantment')) {
      alternativeSacrificeType = 'this enchantment';
    }
    
    // Create a resolution step for the sacrifice choice
    const stepConfig = {
      type: ResolutionStepType.UPKEEP_SACRIFICE,
      playerId: controller,
      description: `${sourceName}: Sacrifice a creature${controllerCreatures.length === 0 ? ` (you must sacrifice ${alternativeSacrificeType})` : ` or sacrifice ${alternativeSacrificeType}`}`,
      mandatory: true,
      sourceId: sourceId,
      sourceName,
      sourceImage: sourcePermanent?.card?.image_uris?.small || triggerItem?.card?.image_uris?.small,
      // Custom data for the sacrifice choice
      hasCreatures: controllerCreatures.length > 0,
      creatures: controllerCreatures.map((perm: any) => ({
        id: perm.id,
        name: perm.card?.name || 'Creature',
        imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        power: perm.card?.power || perm.basePower,
        toughness: perm.card?.toughness || perm.baseToughness,
      })),
      sourceToSacrifice: {
        id: sourceId,
        name: sourceName,
        imageUrl: sourcePermanent?.card?.image_uris?.small || sourcePermanent?.card?.image_uris?.normal,
      },
      alternativeSacrificeType,
    };
    
    if (gameId !== 'unknown') {
      ResolutionQueueManager.addStep(gameId, stepConfig);
      debug(2, `[executeTriggerEffect] ${sourceName}: Created upkeep sacrifice resolution step (${controllerCreatures.length} creatures available)`);
    } else {
      debugWarn(2, `[executeTriggerEffect] ${sourceName}: gameId is unknown, cannot create resolution step`);
      // Fallback: if no creatures, sacrifice the source
      if (controllerCreatures.length === 0 && sourcePermanent) {
        debug(2, `[executeTriggerEffect] ${sourceName}: No creatures available, sacrificing source`);
        const idx = battlefield.findIndex((p: any) => p.id === sourceId);
        if (idx !== -1) {
          const [removed] = battlefield.splice(idx, 1);
          // Move to graveyard (non-token)
          if (!removed.isToken) {
            const zones = state.zones || {};
            const ownerZones = zones[removed.owner || controller] || {};
            ownerZones.graveyard = ownerZones.graveyard || [];
            ownerZones.graveyard.push({ ...removed.card, zone: 'graveyard' });
            recordCardPutIntoGraveyardThisTurn(ctx, String(removed.owner || controller), removed.card, {
              fromBattlefield: true,
              controllerId: String((removed as any).controller || controller),
            });
            ownerZones.graveyardCount = ownerZones.graveyard.length;
          }
        }
      }
    }
    
    return; // Effect handled
  }
  
  // ========================================================================
  // ATTACK TRIGGER TOKEN CREATION
  // Handle "whenever ~ attacks, create X Y/Z tokens that are attacking" 
  // Examples: Brimaz, King of Oreskos; Hero of Bladehold; Hanweir Garrison
  // ========================================================================
  const triggerType = (triggerItem as any).triggerType;
  debug(2, `[executeTriggerEffect] triggerType=${triggerType}, sourceName=${sourceName}`);
  if (triggerType === 'attacks' || triggerType === 'creature_attacks') {
    // Check if this is a token creation effect
    // Pattern: "create a X/Y [type] creature token" or "create X X/Y [type] creature tokens"
    const createTokenMatch = desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (\d+)\/(\d+) ([^\.]+?)(?:\s+creature)?\s+tokens?/i);
    debug(2, `[executeTriggerEffect] ATTACK TRIGGER: createTokenMatch=${!!createTokenMatch}`);
    
    if (createTokenMatch) {
      // Parse count from word or number
      const countWord = desc.match(/create (a|an|one|two|three|four|five|\d+)/i)?.[1]?.toLowerCase() || 'a';
      const wordToCount: Record<string, number> = {
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
      };
      const tokenCount = wordToCount[countWord] || (createTokenMatch[1] ? parseInt(createTokenMatch[1], 10) : 1);
      const power = parseInt(createTokenMatch[2], 10);
      const toughness = parseInt(createTokenMatch[3], 10);
      const tokenDescription = createTokenMatch[4].trim();
      
      // Apply token doubling effects (Anointed Procession, Doubling Season, Elspeth, etc.)
      const tokensToCreate = tokenCount * getTokenDoublerMultiplier(controller, state);
      debug(2, `[executeTriggerEffect] Creating ${tokensToCreate} tokens (base: ${tokenCount}, multiplier: ${getTokenDoublerMultiplier(controller, state)})`);
      
      // Determine if tokens enter attacking
      // Patterns: "tapped and attacking", "that's attacking", "that is attacking", "attacking"
      const entersAttacking = desc.includes('attacking') || desc.includes('that\'s attacking') || desc.includes('that is attacking');
      
      // Determine if tokens should be tapped
      // Brimaz tokens have vigilance and enter attacking but NOT tapped
      // Hero of Bladehold tokens enter "tapped and attacking"
      const shouldBeTapped = desc.includes('tapped and attacking') && !desc.includes('vigilance');
      
      // Extract color and creature type
      const parts = tokenDescription.split(/\s+/);
      const colors: string[] = [];
      const creatureTypes: string[] = [];
      
      const colorMap: Record<string, string> = {
        'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G', 'colorless': ''
      };
      
      for (const part of parts) {
        const lowerPart = part.toLowerCase();
        if (colorMap[lowerPart] !== undefined) {
          if (colorMap[lowerPart]) colors.push(colorMap[lowerPart]);
        } else if (lowerPart !== 'creature' && lowerPart !== 'token' && lowerPart !== 'and' && lowerPart !== 'with' && 
                   lowerPart !== 'that' && lowerPart !== 'are' && lowerPart !== 'tapped' && lowerPart !== 'attacking' &&
                   lowerPart !== 'that\'s' && lowerPart !== 'is') {
          creatureTypes.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
        }
      }
      
      // Check for abilities
      const abilities: string[] = [];
      if (desc.includes('vigilance')) abilities.push('Vigilance');
      if (desc.includes('haste')) abilities.push('Haste');
      if (desc.includes('lifelink')) abilities.push('Lifelink');
      if (desc.includes('deathtouch')) abilities.push('Deathtouch');
      if (desc.includes('flying')) abilities.push('Flying');
      if (desc.includes('first strike')) abilities.push('First strike');
      if (desc.includes('trample')) abilities.push('Trample');
      if (desc.includes('menace')) abilities.push('Menace');
      if (desc.includes('reach')) abilities.push('Reach');
      
      // Get the attacking creature to find out who it's attacking
      const sourceId = triggerItem.source || triggerItem.permanentId;
      const battlefield = state.battlefield || [];
      const attackingCreature = battlefield.find((p: any) => p?.id === sourceId);
      
      // Determine who the token should be attacking (same target as the source creature)
      let attackTarget: string | undefined;
      if (entersAttacking && attackingCreature?.attacking) {
        attackTarget = attackingCreature.attacking;
        debug(2, `[executeTriggerEffect] Attack trigger tokens will attack ${attackTarget}`);
      }
      
      // Create the tokens
      for (let i = 0; i < tokensToCreate; i++) {
        const tokenId = uid("token");
        const tokenName = creatureTypes.length > 0 ? creatureTypes.join(' ') : 'Token';
        const typeLine = `Token Creature — ${creatureTypes.join(' ')}`;
        
        // Get token image from Scryfall data
        const tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
        
        const token = {
          id: tokenId,
          controller,
          owner: controller,
          // Tokens with vigilance that enter attacking should NOT be tapped
          // Tokens that enter "tapped and attacking" without vigilance SHOULD be tapped
          tapped: shouldBeTapped,
          counters: {},
          basePower: power,
          baseToughness: toughness,
          // Tokens entering attacking don't have summoning sickness
          summoningSickness: !entersAttacking && !abilities.includes('Haste'),
          isToken: true,
          // Set attacking property if entering attacking
          ...(attackTarget ? { attacking: attackTarget } : {}),
          card: {
            id: tokenId,
            name: tokenName,
            type_line: typeLine,
            power: String(power),
            toughness: String(toughness),
            colors,
            oracle_text: abilities.join(', '),
            keywords: abilities,
            zone: 'battlefield',
            image_uris: tokenImageUrls,
          },
        } as any;
        
        battlefield.push(token);
        debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token for ${controller}${entersAttacking ? ' (attacking' + (shouldBeTapped ? ', tapped' : '') + ')' : ''}`);
        
        // Trigger ETB effects from other permanents
        triggerETBEffectsForToken(ctx, token, controller);
      }
      
      return; // Attack trigger token creation handled
    }
    
    // ========================================================================
    // COUNT-BASED TOKEN CREATION (Myrel, Shield of Argive)
    // Create X tokens where X is based on counting permanents
    // ========================================================================
    // Note: Check both .value and .effectData as combat.ts stores object values in .effectData
    const triggerValue = (triggerItem as any).value || (triggerItem as any).effectData;
    debug(2, `[executeTriggerEffect] COUNT-BASED CHECK: value=${JSON.stringify((triggerItem as any).value)}, effectData=${JSON.stringify((triggerItem as any).effectData)}, triggerValue.countType=${triggerValue?.countType}`);
    if (triggerValue && typeof triggerValue === 'object' && triggerValue.countType) {
      const { countType, power, toughness, type, color, isArtifact } = triggerValue;
      
      // Count permanents of the specified type controlled by the player
      const battlefield = state.battlefield || [];
      const count = battlefield.filter((p: any) => {
        if (p.controller !== controller) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        return typeLine.includes(countType.toLowerCase());
      }).length;
      
      if (count > 0) {
        const colors: string[] = color === 'colorless' ? [] : 
                                color === 'white' ? ['W'] : color === 'red' ? ['R'] : 
                                color === 'blue' ? ['U'] : color === 'black' ? ['B'] : 
                                color === 'green' ? ['G'] : [];
        
        // Create the tokens
        for (let i = 0; i < count; i++) {
          const tokenId = uid("token");
          const tokenName = type;
          let typeLine = `Token ${isArtifact ? 'Artifact ' : ''}Creature — ${type}`;
          
          // Get token image
          const tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
          
          const token = {
            id: tokenId,
            controller,
            owner: controller,
            tapped: false,
            counters: {},
            basePower: power,
            baseToughness: toughness,
            summoningSickness: true,
            isToken: true,
            card: {
              id: tokenId,
              name: tokenName,
              type_line: typeLine,
              power: String(power),
              toughness: String(toughness),
              colors,
              oracle_text: '',
              keywords: [],
              zone: 'battlefield',
              image_uris: tokenImageUrls,
            },
          } as any;
          
          battlefield.push(token);
          debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token (${i+1}/${count}) for ${controller}`);
          
          triggerETBEffectsForToken(ctx, token, controller);
        }
        
        debug(1, `[executeTriggerEffect] ${sourceName}: Created ${count} ${type} tokens based on ${countType} count`);
        return; // Count-based token creation handled
      } else {
        debug(2, `[executeTriggerEffect] ${sourceName}: No ${countType}s to count, no tokens created`);
        return;
      }
    }
  }
  
  // ========================================================================
  // BLOCK TRIGGER TOKEN CREATION
  // Handle "whenever ~ blocks, create X Y/Z tokens that are blocking"
  // Examples: Brimaz, King of Oreskos
  // ========================================================================
  if (triggerType === 'blocks') {
    // Check if this trigger has token creation data in its value
    const triggerValue = (triggerItem as any).value || {};
    const createTokens = triggerValue.createTokens;
    const blockedCreatureId = triggerValue.blockedCreatureId;
    
    if (createTokens) {
      const { count, power, toughness, type, color, abilities } = createTokens;
      
      // Find the blocking creature to get who it's blocking
      const sourceId = triggerItem.source || triggerItem.permanentId;
      const battlefield = state.battlefield || [];
      const blockingCreature = battlefield.find((p: any) => p?.id === sourceId);
      
      // Determine which attacker the token should block (same as source creature)
      let blockingTarget: string | undefined;
      if (blockingCreature?.blocking && Array.isArray(blockingCreature.blocking)) {
        blockingTarget = blockingCreature.blocking[0]; // Block the same attacker
      } else if (blockedCreatureId) {
        blockingTarget = blockedCreatureId;
      }
      
      const colors: string[] = color === 'white' ? ['W'] : color === 'red' ? ['R'] : 
                              color === 'blue' ? ['U'] : color === 'black' ? ['B'] : 
                              color === 'green' ? ['G'] : [];
      
      // Create the tokens
      for (let i = 0; i < count; i++) {
        const tokenId = uid("token");
        const tokenName = type;
        const typeLine = `Token Creature — ${type}`;
        
        // Get token image from Scryfall data
        const tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
        
        const token = {
          id: tokenId,
          controller,
          owner: controller,
          // Block tokens don't need to be tapped
          tapped: false,
          counters: {},
          basePower: power,
          baseToughness: toughness,
          // Tokens entering blocking don't have summoning sickness
          summoningSickness: false,
          isToken: true,
          // Set blocking property if there's a target
          ...(blockingTarget ? { blocking: [blockingTarget] } : {}),
          card: {
            id: tokenId,
            name: tokenName,
            type_line: typeLine,
            power: String(power),
            toughness: String(toughness),
            colors,
            oracle_text: (abilities || []).join(', '),
            keywords: abilities || [],
            zone: 'battlefield',
            image_uris: tokenImageUrls,
          },
        } as any;
        
        // Also need to update the attacker's blockedBy array
        if (blockingTarget) {
          const attackingCreature = battlefield.find((p: any) => p?.id === blockingTarget);
          if (attackingCreature) {
            attackingCreature.blockedBy = attackingCreature.blockedBy || [];
            attackingCreature.blockedBy.push(tokenId);
          }
        }
        
        battlefield.push(token);
        debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token for ${controller} (blocking${blockingTarget ? ` ${blockingTarget}` : ''})`);
        
        // Trigger ETB effects from other permanents
        triggerETBEffectsForToken(ctx, token, controller);
      }
      
      return; // Block trigger token creation handled
    }
    
    // Fall through to generic pattern matching if no createTokens data
    // This handles block triggers detected from oracle text parsing
    const createTokenMatch = desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (\d+)\/(\d+) ([^\.]+?)(?:\s+creature)?\s+tokens?/i);
    if (createTokenMatch) {
      // Similar token creation logic as attack triggers
      const countWord = desc.match(/create (a|an|one|two|three|four|five|\d+)/i)?.[1]?.toLowerCase() || 'a';
      const wordToCount: Record<string, number> = {
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
      };
      const tokenCount = wordToCount[countWord] || (createTokenMatch[1] ? parseInt(createTokenMatch[1], 10) : 1);
      const power = parseInt(createTokenMatch[2], 10);
      const toughness = parseInt(createTokenMatch[3], 10);
      const tokenDescription = createTokenMatch[4].trim();
      
      // Apply token doubling effects (Anointed Procession, Doubling Season, Elspeth, etc.)
      const tokensToCreate = tokenCount * getTokenDoublerMultiplier(controller, state);
      debug(2, `[executeTriggerEffect] Block trigger creating ${tokensToCreate} tokens (base: ${tokenCount}, multiplier: ${getTokenDoublerMultiplier(controller, state)})`);
      
      // Check for "blocking that creature" pattern
      const entersBlocking = desc.includes('blocking that creature') || desc.includes('that\'s blocking');
      
      // Extract abilities
      const abilities: string[] = [];
      if (desc.includes('vigilance')) abilities.push('Vigilance');
      if (desc.includes('haste')) abilities.push('Haste');
      if (desc.includes('lifelink')) abilities.push('Lifelink');
      
      // Parse colors from token description
      const parts = tokenDescription.split(/\s+/);
      const colors: string[] = [];
      const creatureTypes: string[] = [];
      
      const colorMap: Record<string, string> = {
        'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G', 'colorless': ''
      };
      
      for (const part of parts) {
        const lowerPart = part.toLowerCase();
        if (colorMap[lowerPart] !== undefined) {
          if (colorMap[lowerPart]) colors.push(colorMap[lowerPart]);
        } else if (lowerPart !== 'creature' && lowerPart !== 'token' && lowerPart !== 'that' && 
                   lowerPart !== 'that\'s' && lowerPart !== 'blocking') {
          creatureTypes.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
        }
      }
      
      // Get the blocking creature and attacker
      const sourceId = triggerItem.source || triggerItem.permanentId;
      const battlefield = state.battlefield || [];
      const blockingCreature = battlefield.find((p: any) => p?.id === sourceId);
      
      let blockingTarget: string | undefined;
      if (entersBlocking && blockingCreature?.blocking && Array.isArray(blockingCreature.blocking)) {
        blockingTarget = blockingCreature.blocking[0];
      }
      
      // Create tokens
      for (let i = 0; i < tokensToCreate; i++) {
        const tokenId = uid("token");
        const tokenName = creatureTypes.length > 0 ? creatureTypes.join(' ') : 'Token';
        const typeLine = `Token Creature — ${creatureTypes.join(' ')}`;
        
        const tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
        
        const token = {
          id: tokenId,
          controller,
          owner: controller,
          tapped: false,
          counters: {},
          basePower: power,
          baseToughness: toughness,
          summoningSickness: false,
          isToken: true,
          ...(blockingTarget ? { blocking: [blockingTarget] } : {}),
          card: {
            id: tokenId,
            name: tokenName,
            type_line: typeLine,
            power: String(power),
            toughness: String(toughness),
            colors,
            oracle_text: abilities.join(', '),
            keywords: abilities,
            zone: 'battlefield',
            image_uris: tokenImageUrls,
          },
        } as any;
        
        if (blockingTarget) {
          const attackingCreature = battlefield.find((p: any) => p?.id === blockingTarget);
          if (attackingCreature) {
            attackingCreature.blockedBy = attackingCreature.blockedBy || [];
            attackingCreature.blockedBy.push(tokenId);
          }
        }
        
        battlefield.push(token);
        debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} block token for ${controller}`);
        
        triggerETBEffectsForToken(ctx, token, controller);
      }
      
      return; // Block trigger token creation handled
    }
  }
  
  // Handle Agent of the Shadow Thieves commander attack trigger
  // "Whenever this creature attacks a player, if no opponent has more life than that player, 
  //  put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."
  if (desc.includes('whenever this creature attacks a player') && 
      desc.includes('if no opponent has more life') &&
      desc.includes('+1/+1 counter')) {
    const sourceId = triggerItem.source || triggerItem.permanentId;
    const battlefield = state.battlefield || [];
    const perm = battlefield.find((p: any) => p?.id === sourceId);
    
    if (perm) {
      // Get the defending player from the trigger context
      const effectData = (triggerItem as any).effectData || (triggerItem as any).value || {};
      const defendingPlayerId = effectData.defendingPlayer;
      
      if (defendingPlayerId) {
        // Check if no opponent has more life than the defending player
        const defendingPlayerLife = state.life[defendingPlayerId] ?? (state.startingLife || 40);
        const players = state.players || [];
        const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
        
        const noOpponentHasMoreLife = opponents.every((opponent: any) => {
          const opponentLife = state.life[opponent.id] ?? (state.startingLife || 40);
          return opponentLife <= defendingPlayerLife;
        });
        
        if (noOpponentHasMoreLife) {
          // Add +1/+1 counter
          perm.counters = perm.counters || {};
          perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
          debug(2, `[executeTriggerEffect] Agent trigger: Added +1/+1 counter to ${perm.card?.name || perm.id}`);
          
          // Grant deathtouch and indestructible until end of turn
          perm.temporaryAbilities = perm.temporaryAbilities || [];
          if (!perm.temporaryAbilities.includes('deathtouch')) {
            perm.temporaryAbilities.push('deathtouch');
          }
          if (!perm.temporaryAbilities.includes('indestructible')) {
            perm.temporaryAbilities.push('indestructible');
          }
          
          // Track that these abilities should be removed at end of turn
          state.endOfTurnEffects = state.endOfTurnEffects || [];
          state.endOfTurnEffects.push({
            type: 'remove_temporary_abilities',
            permanentId: sourceId,
            abilities: ['deathtouch', 'indestructible'],
          });
          
          debug(2, `[executeTriggerEffect] Agent trigger: ${perm.card?.name || perm.id} gained deathtouch and indestructible until end of turn`);
        } else {
          debug(2, `[executeTriggerEffect] Agent trigger: Condition not met (opponent has more life than defending player)`);
        }
      }
    }
    
    return; // Early return, effect is fully handled
  }
  
  // Handle Join Forces triggered abilities (Mana-Charged Dragon)
  // These require all players to contribute mana
  // Uses the unified ResolutionQueueManager for proper APNAP ordering
  if (triggerItem.triggerType === 'join_forces_attack' || 
      (desc.includes('join forces') && desc.includes('each player may pay'))) {
    // Get turn order for APNAP ordering
    const turnOrder = players.map((p: any) => p.id);
    const gameId = (ctx as any).gameId || 'unknown';
    
    // Skip adding resolution steps during replay to prevent infinite loops
    const isReplaying = !!(ctx as any).isReplaying;
    if (isReplaying) {
      debug(2, `[executeTriggerEffect] Join Forces: skipping resolution steps during replay`);
      return;
    }
    
    // Create resolution steps for each player using APNAP ordering
    // "Starting with you" means the controller goes first, then others in turn order
    const stepConfigs = players.map((p: any) => {
      const playerId = p.id;
      const isInitiator = playerId === controller;
      
      // Calculate available mana for this player
      const battlefield = state.battlefield || [];
      const untappedLands = battlefield.filter((perm: any) => 
        perm.controller === playerId && 
        !perm.tapped &&
        (perm.card?.type_line || '').toLowerCase().includes('land')
      ).length;
      
      return {
        type: ResolutionStepType.JOIN_FORCES,
        playerId,
        description: `${sourceName}: You may pay any amount of mana to contribute to this effect`,
        mandatory: false,
        sourceId: triggerItem.permanentId || triggerItem.sourceId,
        sourceName: sourceName || 'Join Forces Ability',
        sourceImage: triggerItem.value?.imageUrl || triggerItem.card?.image_uris?.small,
        cardName: sourceName || 'Join Forces Ability',
        effectDescription: description,
        cardImageUrl: triggerItem.value?.imageUrl,
        initiator: controller,
        availableMana: untappedLands,
        isInitiator,
      };
    });
    
    // Add steps with APNAP ordering, starting with the controller
    ResolutionQueueManager.addStepsWithAPNAP(
      gameId,
      stepConfigs,
      turnOrder,
      controller
    );
    
    debug(1, `[executeTriggerEffect] Join Forces attack trigger from ${sourceName} - created ${players.length} resolution steps`);
    return;
  }
  
  // ===== COMBINED EFFECT HANDLERS =====
  // These handle triggers with multiple effects in one description (like Phyrexian Arena)
  // Process ALL matching effects, not just the first one
  
  let handled = false;
  
  // Pattern: "Draw a card" (standalone or as part of combined effect)
  if (desc.includes('draw a card') || desc.includes('draw 1 card') || desc.match(/draw \d+ cards?/i)) {
    const drawCountMatch = desc.match(/draw (\d+) cards?/i);
    const drawCount = drawCountMatch ? parseInt(drawCountMatch[1], 10) : 1;
    
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[controller] = (state.pendingDraws[controller] || 0) + drawCount;
    debug(2, `[executeTriggerEffect] ${controller} will draw ${drawCount} card(s) from ${sourceName}`);
    handled = true;
  }
  
  // Pattern: "you lose X life" (combined effect)
  const youLoseLifeMatch = desc.match(/you lose (\d+) life/i);
  if (youLoseLifeMatch) {
    const amount = parseInt(youLoseLifeMatch[1], 10);
    modifyLife(controller, -amount);
    debug(2, `[executeTriggerEffect] ${controller} loses ${amount} life from ${sourceName}`);
    handled = true;
  }
  
  // Pattern: "you gain X life" (combined effect)
  const youGainLifeMatch = desc.match(/you gain (\d+) life/i);
  if (youGainLifeMatch) {
    const amount = parseInt(youGainLifeMatch[1], 10);
    modifyLife(controller, amount);
    debug(2, `[executeTriggerEffect] ${controller} gains ${amount} life from ${sourceName}`);
    handled = true;
  }
  
  // If we handled any combined effects, we're done
  if (handled) {
    return;
  }
  
  // ===== SINGLE EFFECT HANDLERS =====
  // These are for triggers that have only one effect
  
  // Pattern: "You gain X life"
  const gainLifeMatch = desc.match(/you gain (\d+) life/i);
  if (gainLifeMatch) {
    const amount = parseInt(gainLifeMatch[1], 10);
    modifyLife(controller, amount);
    return;
  }
  
  // Pattern: "You may gain X life" (for optional triggers that were accepted)
  const mayGainLifeMatch = desc.match(/you may gain (\d+) life/i);
  if (mayGainLifeMatch) {
    const amount = parseInt(mayGainLifeMatch[1], 10);
    modifyLife(controller, amount);
    return;
  }
  
  // Pattern: "Each opponent loses X life"
  const opponentsLoseMatch = desc.match(/each opponent loses (\d+) life/i);
  if (opponentsLoseMatch) {
    const amount = parseInt(opponentsLoseMatch[1], 10);
    for (const opp of opponents) {
      modifyLife(opp.id, -amount);
    }
    // Check for "you gain X life" in same trigger (like Zulaport Cutthroat)
    const alsoGainMatch = desc.match(/you gain (\d+) life/i);
    if (alsoGainMatch) {
      const gainAmount = parseInt(alsoGainMatch[1], 10);
      modifyLife(controller, gainAmount);
    }
    return;
  }
  
  // Pattern: "[Source] deals X damage to each opponent" (Chandra, common planeswalker pattern)
  const dealsToEachOpponentMatch = desc.match(/deals? (\d+) damage to each opponent/i);
  if (dealsToEachOpponentMatch) {
    const damage = parseInt(dealsToEachOpponentMatch[1], 10);
    for (const opp of opponents) {
      modifyLife(opp.id, -damage);
      debug(2, `[executeTriggerEffect] ${sourceName} deals ${damage} damage to ${opp.id}`);

      // Queue "Whenever ~ deals damage to a player" triggers from the damage source.
      try {
        const sourcePermanentId = String((triggerItem as any)?.source || (triggerItem as any)?.permanentId || '');
        if (sourcePermanentId) {
          queueDealsDamageToPlayerTriggersFromPermanent(ctx, sourcePermanentId, String(opp.id));
        }
      } catch {
        // Defensive: do not block resolution on trigger queue failure.
      }
    }
    return;
  }
  
  // Pattern: "Target player loses X life, you gain X life" (Blood Artist)
  const targetLosesYouGainMatch = desc.match(/target player loses (\d+) life.*you gain (\d+) life/i);
  if (targetLosesYouGainMatch) {
    const loseAmount = parseInt(targetLosesYouGainMatch[1], 10);
    const gainAmount = parseInt(targetLosesYouGainMatch[2], 10);
    
    // If we have a target, use it; otherwise target a random opponent
    const targets = triggerItem.targets || [];
    const targetPlayer = targets[0] || (opponents[0]?.id);
    
    if (targetPlayer) {
      modifyLife(targetPlayer, -loseAmount);
    }
    modifyLife(controller, gainAmount);
    return;
  }
  
  // Pattern: "Creature's controller loses X life" (Blood Seeker)
  const creatureControllerLosesMatch = desc.match(/creature's controller loses (\d+) life/i);
  if (creatureControllerLosesMatch) {
    const amount = parseInt(creatureControllerLosesMatch[1], 10);
    // The triggering creature's controller - stored in triggerItem for ETB triggers
    const triggeringController = (triggerItem as any).triggeringController;
    if (triggeringController && triggeringController !== controller) {
      modifyLife(triggeringController, -amount);
    }
    return;
  }
  
  // Pattern: "you gain X life and get {E}" - Combined life gain + energy (Guide of Souls)
  // This must be checked BEFORE separate life/energy patterns
  const lifeAndEnergyMatch = desc.match(/you gain (\d+) life and get (?:(\d+|one|two|three|four|five) )?(?:\{e\}|energy)/i);
  if (lifeAndEnergyMatch) {
    const lifeAmount = parseInt(lifeAndEnergyMatch[1], 10);
    const wordToNum: Record<string, number> = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
    let energyAmount = 1;
    if (lifeAndEnergyMatch[2]) {
      energyAmount = wordToNum[lifeAndEnergyMatch[2].toLowerCase()] || parseInt(lifeAndEnergyMatch[2], 10) || 1;
    }
    
    // Apply life gain
    modifyLife(controller, lifeAmount);
    debug(2, `[executeTriggerEffect] ${sourceName}: ${controller} gains ${lifeAmount} life`);
    
    // Apply energy gain
    addEnergyCounters(state, controller, energyAmount, sourceName);
    
    handled = true;
    // Don't return - Guide of Souls also has a second ability about paying energy
  }
  
  // Pattern: "you get {E}" or "you get X {E}" - Energy counters (Guide of Souls, etc.)
  // Matches: "you get {E}", "you get two {E}", "you get 2 {E}"
  // Skip if already handled by lifeAndEnergyMatch above
  if (!handled) {
    const energyMatch = desc.match(/you get (?:(\d+|one|two|three|four|five) )?(?:\{e\}|energy)/i);
    if (energyMatch) {
      const wordToNum: Record<string, number> = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
      let amount = 1;
      if (energyMatch[1]) {
        amount = wordToNum[energyMatch[1].toLowerCase()] || parseInt(energyMatch[1], 10) || 1;
      }
      
      addEnergyCounters(state, controller, amount, sourceName);
      handled = true;
      // Don't return - there might be more effects after energy gain
    }
  }

  // Pattern: "you get N token counter(s)" (The Tokenator, etc.)
  // Keep this separate from generic "counter" logic; token counters are on players.
  if (!handled) {
    const tokenMatch = desc.match(/you get (?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten) )?token counters?/i);
    if (tokenMatch) {
      const wordToNum: Record<string, number> = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
      };
      let amount = 1;
      if (tokenMatch[1]) {
        amount = wordToNum[tokenMatch[1].toLowerCase()] || parseInt(tokenMatch[1], 10) || 1;
      }

      addTokenCounters(state, controller, amount, sourceName);
      handled = true;
      // Don't return - there may be follow-up effects (e.g., "Then create ...")
    }
  }
  
  // ========================================================================
  // ELSPETH RESPLENDENT +1 PATTERN
  // "Put a +1/+1 counter and a counter from among flying, first strike, lifelink, or vigilance on it."
  // This requires a choice modal for the keyword counter type
  // ========================================================================
  const counterFromAmongMatch = desc.match(/\+1\/\+1 counter and a counter from among ([^.]+) on it/i);
  if (counterFromAmongMatch) {
    const gameId = (ctx as any).gameId || 'unknown';
    const isReplaying = !!(ctx as any).isReplaying;
    const targets = (triggerItem as any).targets || [];
    
    // Parse the counter options from the text (e.g., "flying, first strike, lifelink, or vigilance")
    const counterOptionsText = counterFromAmongMatch[1];
    const counterOptions = counterOptionsText
      .replace(/,?\s*or\s+/g, ', ')  // Replace "or" with comma
      .split(/,\s*/)
      .map((opt: string) => opt.trim())
      .filter((opt: string) => opt.length > 0);
    
    debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Counter options: ${JSON.stringify(counterOptions)}, targets: ${JSON.stringify(targets)}`);
    
    if (targets.length === 0) {
      // "up to one target creature" with 0 targets chosen - nothing happens
      debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: No targets selected, effect fizzles`);
      return;
    }
    
    if (isReplaying) {
      debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Skipping resolution step during replay`);
      return;
    }
    
    // Find the target creature
    const battlefield = state.battlefield || [];
    const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
    const targetCreature = battlefield.find((p: any) => p.id === targetId);
    
    if (!targetCreature) {
      debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Target creature ${targetId} not found`);
      return;
    }
    
    // Create a resolution step for the counter choice
    if (gameId !== 'unknown') {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MODAL_CHOICE,
        playerId: controller,
        description: `${sourceName}: Choose a counter type to put on ${targetCreature.card?.name || 'the creature'}`,
        mandatory: true,
        sourceName: sourceName,
        sourceImage: triggerItem?.card?.image_uris?.small || triggerItem?.card?.image_uris?.normal,
        promptTitle: 'Choose Counter Type',
        promptDescription: `Put a +1/+1 counter and which keyword counter on ${targetCreature.card?.name || 'the creature'}?`,
        options: counterOptions.map((opt: string) => ({
          id: opt.toLowerCase().replace(/\s+/g, '_'),
          label: opt.charAt(0).toUpperCase() + opt.slice(1),
        })),
        minSelections: 1,
        maxSelections: 1,
        // Store data for resolution handler
        elspethCounterData: {
          targetCreatureId: targetId,
          targetCreatureName: targetCreature.card?.name,
          counterOptions,
        },
      });
      
      debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Created counter choice modal for ${targetCreature.card?.name}`);
    } else {
      // Fallback: just add +1/+1 and first option if no gameId
      targetCreature.counters = targetCreature.counters || {};
      targetCreature.counters['+1/+1'] = (targetCreature.counters['+1/+1'] || 0) + 1;
      if (counterOptions.length > 0) {
        const defaultCounter = counterOptions[0].toLowerCase();
        targetCreature.counters[defaultCounter] = (targetCreature.counters[defaultCounter] || 0) + 1;
      }
      debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Fallback - added counters to ${targetCreature.card?.name}`);
    }
    
    return;
  }
  
  // ========================================================================
  // TWO +1/+1 COUNTERS ON TARGET CREATURE (Archangel Elspeth -2)
  // "Put two +1/+1 counters on target creature. It becomes an Angel in addition to its other types and gains flying."
  // ========================================================================
  const twoCountersMatch = desc.match(/put two \+1\/\+1 counters on (?:target creature|it)/i);
  if (twoCountersMatch && (triggerItem as any).targets?.length > 0) {
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];
    const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
    const targetCreature = battlefield.find((p: any) => p.id === targetId);
    
    if (targetCreature) {
      // Add two +1/+1 counters
      targetCreature.counters = targetCreature.counters || {};
      targetCreature.counters['+1/+1'] = (targetCreature.counters['+1/+1'] || 0) + 2;
      
      // Check if it becomes an Angel and gains flying (case-insensitive)
      const descLower = desc.toLowerCase();
      if (descLower.includes('becomes an angel') || descLower.includes('angel in addition')) {
        // Add Angel type using shared utility
        addCreatureType(targetCreature, 'Angel');
        
        // Grant flying (add to oracle text or keywords)
        const currentOracle = targetCreature.card?.oracle_text || '';
        if (!currentOracle.toLowerCase().includes('flying')) {
          targetCreature.card.oracle_text = currentOracle ? `Flying\n${currentOracle}` : 'Flying';
        }
        targetCreature.card.keywords = targetCreature.card.keywords || [];
        if (!targetCreature.card.keywords.includes('Flying')) {
          targetCreature.card.keywords.push('Flying');
        }
        
        // Mark that this creature has been modified
        targetCreature.grantedAbilities = targetCreature.grantedAbilities || [];
        if (!targetCreature.grantedAbilities.includes('flying')) {
          targetCreature.grantedAbilities.push('flying');
        }
        
        debug(2, `[executeTriggerEffect] Archangel Elspeth -2: Added 2 +1/+1 counters, Angel type, and Flying to ${targetCreature.card?.name}`);
      } else {
        debug(2, `[executeTriggerEffect] Put two +1/+1 counters on ${targetCreature.card?.name}`);
      }
    }
    return;
  }

  // Pattern: "+1/+1 counter on each creature you control" (Cathar's Crusade)
  if (desc.includes('+1/+1 counter') && desc.includes('each creature you control')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      // Add +1/+1 counter
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
      debug(2, `[executeTriggerEffect] Added +1/+1 counter to ${perm.card?.name || perm.id}`);
    }
    return;
  }
  
  // Pattern: "+1/+1 counter on each other [creature type] you control" (Thalia's Lieutenant, Champion of the Parish, etc.)
  // Matches: "put a +1/+1 counter on each other Human you control"
  const counterOnEachOtherTypeMatch = desc.match(/\+1\/\+1 counter on each other (\w+) you control/i);
  if (counterOnEachOtherTypeMatch) {
    const creatureType = counterOnEachOtherTypeMatch[1].toLowerCase();
    const battlefield = state.battlefield || [];
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      // Skip the source permanent (it says "each OTHER")
      if (perm.id === sourcePermId) continue;
      
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      // Check if this creature has the required creature type
      if (!typeLine.includes('creature')) continue;
      if (!typeLine.includes(creatureType)) continue;
      
      // Add +1/+1 counter
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
      debug(2, `[executeTriggerEffect] Added +1/+1 counter to ${perm.card?.name || perm.id} (${creatureType})`);
    }
    return;
  }
  
  // Pattern: "+1/+1 counter on [creature type] you control" without "other" (Thalia's Lieutenant's second ability)
  // Matches: "put a +1/+1 counter on Thalia's Lieutenant" when another Human ETBs
  const counterOnSelfMatch = desc.match(/\+1\/\+1 counter on (?:~|this creature|it)/i);
  if (counterOnSelfMatch) {
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    const battlefield = state.battlefield || [];
    const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);
    
    if (sourcePerm) {
      sourcePerm.counters = sourcePerm.counters || {};
      sourcePerm.counters['+1/+1'] = (sourcePerm.counters['+1/+1'] || 0) + 1;
      debug(2, `[executeTriggerEffect] Added +1/+1 counter to ${sourcePerm.card?.name || sourcePerm.id}`);
    }
    return;
  }
  
  // Pattern: "double the number of +1/+1 counters on [this creature|it|~]" (Mossborn Hydra landfall)
  // Matches: "double the number of +1/+1 counters on this creature", "double the number of +1/+1 counters on Mossborn Hydra"
  if (desc.includes('double') && desc.includes('+1/+1 counter') && 
      (desc.includes('this creature') || desc.includes('on it') || desc.includes('on ~'))) {
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    const battlefield = state.battlefield || [];
    const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);
    
    if (sourcePerm) {
      sourcePerm.counters = sourcePerm.counters || {};
      const currentCounters = sourcePerm.counters['+1/+1'] || 0;
      const newCounters = currentCounters * 2;
      sourcePerm.counters['+1/+1'] = newCounters;
      debug(2, `[executeTriggerEffect] Doubled +1/+1 counters on ${sourcePerm.card?.name || sourcePerm.id}: ${currentCounters} -> ${newCounters}`);
    }
    return;
  }
  
  // Pattern: "put X +1/+1 counters on each creature you control" where X is based on source's power
  // Matches: "put X +1/+1 counters on each creature you control, where X is ~'s power"
  // Also matches: "put a number of +1/+1 counters equal to its power on each creature you control"
  if ((desc.includes('+1/+1 counter') && desc.includes('each creature you control')) && 
      (desc.includes('power') || desc.includes('equal to'))) {
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    const battlefield = state.battlefield || [];
    const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);
    
    if (sourcePerm) {
      // Calculate source's power including counters and modifiers
      // Use effectivePower if pre-calculated (most efficient)
      let sourcePower: number;
      if (typeof sourcePerm.effectivePower === 'number') {
        sourcePower = sourcePerm.effectivePower;
      } else {
        // Fall back to manual calculation using comprehensive P/T bonus calculation
        // This includes equipment, auras, anthems, lords, and special abilities like Omnath's mana pool bonus
        let basePower = sourcePerm.basePower || 0;
        if (!basePower && sourcePerm.card?.power) {
          basePower = parsePT(sourcePerm.card.power) ?? 0;
        }
        
        // Add +1/+1 counters
        const plusCounters = sourcePerm.counters?.['+1/+1'] || 0;
        const minusCounters = sourcePerm.counters?.['-1/-1'] || 0;
        const counterDelta = plusCounters - minusCounters;
        
        // Calculate ALL other bonuses (equipment, auras, anthems, lords, Omnath's mana pool, etc.)
        const allBonuses = calculateAllPTBonuses(sourcePerm, state);
        
        sourcePower = Math.max(0, basePower + counterDelta + allBonuses.power);
      }
      
      debug(2, `[executeTriggerEffect] ${sourcePerm.card?.name || 'Unknown'} has power ${sourcePower}, adding counters to all creatures`);
      
      // Add counters to each creature controller controls
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        
        // Add X +1/+1 counters
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + sourcePower;
        debug(2, `[executeTriggerEffect] Added ${sourcePower} +1/+1 counter(s) to ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // Pattern: "Draw a card" or "Draw X cards"
  const drawMatch = desc.match(/draw (?:a card|(\d+) cards?)/i);
  if (drawMatch && !desc.includes('each player may put a land')) {
    // Skip if this is a Kynaios-style effect (handled below)
    const count = drawMatch[1] ? parseInt(drawMatch[1], 10) : 1;
    // Set up pending draw - actual draw happens through zone management
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[controller] = (state.pendingDraws[controller] || 0) + count;
    debug(2, `[executeTriggerEffect] ${controller} will draw ${count} card(s)`);
    return;
  }
  
  // Pattern: Kynaios and Tiro of Meletis style - "draw a card. Each player may put a land...then each opponent who didn't draws a card"
  // This is a complex multi-step effect that requires player choices
  // Uses the unified Resolution Queue system for proper APNAP ordering
  if (desc.includes('each player may put a land') && desc.includes('opponent') && desc.includes('draws a card')) {
    // First, controller draws a card
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[controller] = (state.pendingDraws[controller] || 0) + 1;
    
    // Get turn order for APNAP ordering
    const turnOrder = players.map((p: any) => p.id);
    const activePlayerId = state.activePlayer || controller;
    
    // Get gameId from context - MUST be present for resolution queue to work
    const gameId = (ctx as any).gameId || (ctx as any).id || triggerItem?.gameId;
    
    if (!gameId || gameId === 'unknown') {
      // If gameId is missing, we cannot use the Resolution Queue
      // This is a critical error that should not happen in normal operation
      debugError(1, `[executeTriggerEffect] Kynaios: CRITICAL - Cannot process without gameId (ctx.gameId=${(ctx as any).gameId}, ctx.id=${(ctx as any).id}, triggerItem.gameId=${triggerItem?.gameId}). Trigger will not function correctly.`);
      return;
    }
    
    debug(1, `[executeTriggerEffect] Kynaios: Creating resolution steps for ${players.length} players, gameId=${gameId}`);
    
    // Create resolution steps for each player using APNAP ordering
    // Tag all steps with a batch id so the socket handler can apply the "then each opponent who didn't draws" clause
    // only after all players have made their choice.
    const kynaiosBatchId = String((triggerItem as any)?.id || `kynaios_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    // Each player gets a step to choose whether to play a land
    const stepConfigs = players.map((p: any) => {
      const playerId = p.id;
      const isController = playerId === controller;
      
      // Get lands in hand for this player
      const playerZones = state.zones?.[playerId];
      const hand = playerZones?.hand || [];
      const landsInHand = hand.filter((card: any) => 
        card && (card.type_line || '').toLowerCase().includes('land')
      );
      
      return {
        type: ResolutionStepType.KYNAIOS_CHOICE,
        playerId,
        description: `${sourceName}: You may put a land card from your hand onto the battlefield${isController ? '' : ', or draw a card'}`,
        mandatory: false, // Player may decline
        sourceId: triggerItem?.permanentId || triggerItem?.sourceId,
        sourceName,
        sourceImage: triggerItem?.card?.image_uris?.small,
        kynaiosBatchId,
        // Custom data for Kynaios choice
        isController,
        sourceController: controller,
        canPlayLand: landsInHand.length > 0,
        landsInHand: landsInHand.map((card: any) => ({
          id: card.id,
          name: card.name,
          imageUrl: card.image_uris?.small || card.image_uris?.normal,
        })),
        options: isController 
          ? ['play_land', 'decline'] as const
          : ['play_land', 'draw_card'] as const,
      };
    });
    
    // Skip adding resolution steps during replay to prevent infinite loops
    const isReplaying = !!(ctx as any).isReplaying;
    if (isReplaying) {
      debug(2, `[executeTriggerEffect] Kynaios: skipping resolution steps during replay`);
      return;
    }
    
    debug(1, `[executeTriggerEffect] Kynaios: Adding ${stepConfigs.length} resolution steps via ResolutionQueueManager`);
    
    ResolutionQueueManager.addStepsWithAPNAP(
      gameId,
      stepConfigs,
      turnOrder,
      activePlayerId
    );
    
    debug(1, `[executeTriggerEffect] ${sourceName}: ${controller} draws 1, created ${players.length} resolution steps for land/draw choices (gameId: ${gameId})`);
    return;
  }
  
  // Pattern: "each player may put two +1/+1 counters on a creature they control"
  // Matches: Agitator Ant (with goad), Orzhov Advokist (with can't attack), and similar effects
  // Scalable regex pattern to detect these effects
  const eachPlayerCountersPattern = /each player may put (?:two|\d+) \+1\/\+1 counters? on a creature (?:they|that player) controls?/i;
  if (eachPlayerCountersPattern.test(desc)) {
    // Get all players
    const turnOrder = players.map((p: any) => p.id);
    const activePlayerId = state.activePlayer || controller;
    const gameId = (ctx as any).gameId || (ctx as any).id || triggerItem?.gameId || 'unknown';
    const battlefield = state.battlefield || [];
    
    // Skip adding resolution steps during replay
    const isReplaying = !!(ctx as any).isReplaying;
    if (isReplaying) {
      debug(2, `[executeTriggerEffect] Agitator Ant: skipping resolution steps during replay`);
      return;
    }
    
    // Create resolution steps for each player
    const stepConfigs = players.map((p: any) => {
      const playerId = p.id;
      
      // Get creatures controlled by this player
      const playerCreatures = battlefield.filter((perm: any) => {
        if (perm.controller !== playerId) return false;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        return typeLine.includes('creature');
      });
      
      return {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        description: `${sourceName}: You may put two +1/+1 counters on a creature you control`,
        mandatory: false, // Player may decline
        sourceId: triggerItem?.permanentId || triggerItem?.sourceId,
        sourceName,
        sourceImage: triggerItem?.card?.image_uris?.small,
        // SCALABLE METADATA for conditional "If a player does" effects
        // This pattern works for many cards: Agitator Ant, Orzhov Advokist, Akroan Horse, etc.
        counterPlacementTrigger: true,
        sourceController: controller, // Who controls the source (for "can't attack you" effects)
        effectType: desc.toLowerCase().includes('goad') ? 'goad' : 
                   desc.toLowerCase().includes("can't attack") ? 'cant_attack' : 'none',
        conditionalEffect: {
          // Store what happens "if a player does" make the choice
          trigger: 'counter_placement', // What choice they made
          onAccept: desc.toLowerCase().includes('goad') ? 'goad' :
                   desc.toLowerCase().includes("can't attack") ? 'cant_attack_controller' : null,
        },
        triggerDescription: desc, // Store full description for context
        availableCreatures: playerCreatures.map((perm: any) => ({
          permanentId: perm.id,
          cardName: perm.card?.name || 'Creature',
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        })),
        options: [
          { id: 'decline', label: 'Decline' },
          ...playerCreatures.map((perm: any) => ({
            id: perm.id,
            label: perm.card?.name || 'Creature',
          })),
        ],
        minSelections: 0,
        maxSelections: 1,
      };
    });
    
    // Add steps with APNAP ordering
    ResolutionQueueManager.addStepsWithAPNAP(
      gameId,
      stepConfigs,
      turnOrder,
      activePlayerId
    );
    
    debug(2, `[executeTriggerEffect] ${sourceName} (counter placement effect): created ${players.length} resolution steps for counter placement (gameId: ${gameId})`);
    return;
  }
  
  // Pattern: "Target player draws X cards" or "that player draws X cards"
  const targetDrawMatch = desc.match(/(?:target|that) player draws? (\d+|a|an|one|two|three) cards?/i);
  if (targetDrawMatch) {
    const wordToNum: Record<string, number> = { 'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3 };
    const count = wordToNum[targetDrawMatch[1].toLowerCase()] || parseInt(targetDrawMatch[1], 10) || 1;
    
    // Use target if available, otherwise controller
    const targets = triggerItem?.targets || [];
    const targetPlayer = targets[0]?.id || targets[0] || controller;
    
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[targetPlayer] = (state.pendingDraws[targetPlayer] || 0) + count;
    debug(2, `[executeTriggerEffect] ${targetPlayer} will draw ${count} card(s)`);
    return;
  }
  
  // Pattern: "each opponent draws a card" 
  const eachOpponentDrawsMatch = desc.match(/each opponent draws? (\d+|a|an|one|two) cards?/i);
  if (eachOpponentDrawsMatch) {
    const wordToNum: Record<string, number> = { 'a': 1, 'an': 1, 'one': 1, 'two': 2 };
    const count = wordToNum[eachOpponentDrawsMatch[1].toLowerCase()] || parseInt(eachOpponentDrawsMatch[1], 10) || 1;
    
    state.pendingDraws = state.pendingDraws || {};
    for (const opp of opponents) {
      state.pendingDraws[opp.id] = (state.pendingDraws[opp.id] || 0) + count;
    }
    debug(2, `[executeTriggerEffect] Each opponent will draw ${count} card(s)`);
    return;
  }
  
  // ============================================================================
  // DYNAMIC PATTERN RECOGNITION: Search library effects
  // This regex-based approach handles ALL cards with "search your library" patterns,
  // not just hardcoded card names. Works for any of the 27,000+ MTG cards.
  // ============================================================================
  const searchLibraryMatch = desc.match(/(?:you may )?search your library for (?:a|an|up to (?:one|two|three|\d+)) ([^,\.]+)/i);
  if (searchLibraryMatch) {
    const searchFor = searchLibraryMatch[1].trim();
    const isOptional = desc.includes('you may search');
    
    // Determine destination dynamically from text
    let destination = 'hand';
    let entersTapped = false;
    if (desc.includes('put it onto the battlefield') || desc.includes('put that card onto the battlefield') ||
        desc.includes('put it on the battlefield') || desc.includes('battlefield under your control')) {
      destination = 'battlefield';
      // Check if it enters tapped
      if (desc.includes('tapped')) {
        entersTapped = true;
      }
    } else if (desc.includes('put it on top of your library') || desc.includes('put that card on top')) {
      destination = 'top';
    }
    
    // Build filter dynamically based on what we're searching for
    const filter: { 
      types?: string[]; 
      subtypes?: string[]; 
      name?: string; 
      maxPower?: number; 
      maxToughness?: number; 
      maxCmc?: number; 
      minCmc?: number;
    } = {};
    const subtypes: string[] = [];
    
    // Dynamic basic land type detection
    const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
    for (const landType of basicLandTypes) {
      if (searchFor.toLowerCase().includes(landType)) {
        subtypes.push(landType.charAt(0).toUpperCase() + landType.slice(1));
      }
    }
    
    // Dynamic card type detection
    const cardTypes = ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'];
    const types: string[] = [];
    for (const cardType of cardTypes) {
      if (searchFor.toLowerCase().includes(cardType)) {
        types.push(cardType);
      }
    }
    
    // Dynamic power/toughness restriction detection
    // Matches: "power 2 or less", "power 3 or greater", "toughness 2 or less", etc.
    const powerMatch = searchFor.match(/power\s*(\d+)\s*or\s*(less|greater)/i);
    if (powerMatch) {
      const value = parseInt(powerMatch[1], 10);
      const direction = powerMatch[2].toLowerCase();
      if (direction === 'less') {
        filter.maxPower = value;
      }
      // For "or greater" we'd need minPower, but maxPower covers the common case
    }
    
    const toughnessMatch = searchFor.match(/toughness\s*(\d+)\s*or\s*(less|greater)/i);
    if (toughnessMatch) {
      const value = parseInt(toughnessMatch[1], 10);
      const direction = toughnessMatch[2].toLowerCase();
      if (direction === 'less') {
        filter.maxToughness = value;
      }
    }
    
    // Dynamic CMC restriction detection
    // Matches: "mana value 3 or less", "converted mana cost 2 or less"
    const cmcLessMatch = searchFor.match(/(?:mana value|converted mana cost|cmc)\s*(\d+)\s*or\s*(?:less|fewer)/i);
    if (cmcLessMatch) {
      filter.maxCmc = parseInt(cmcLessMatch[1], 10);
    }
    
    // Matches: "mana value 6 or greater", "converted mana cost 6 or more" (Fierce Empath, etc.)
    const cmcGreaterMatch = searchFor.match(/(?:mana value|converted mana cost|cmc)\s*(\d+)\s*or\s*(?:greater|more)/i);
    if (cmcGreaterMatch) {
      filter.minCmc = parseInt(cmcGreaterMatch[1], 10);
    }
    
    if (types.length > 0) filter.types = types;
    if (subtypes.length > 0) filter.subtypes = subtypes;
    
    // Check for conditional triggers: "if an opponent controls more lands than you"
    // (Knight of the White Orchid, etc.)
    const hasLandCondition = desc.match(/if (?:an|any) opponent controls more lands than you/i);
    if (hasLandCondition) {
      const { myLandCount, anyOpponentHasMoreLands } = checkOpponentHasMoreLands(state, controller);
      
      if (!anyOpponentHasMoreLands) {
        debug(2, `[executeTriggerEffect] ${sourceName}: Condition NOT met - ${controller} has ${myLandCount} lands, no opponent has more`);
        return; // Don't set up library search if condition not met
      }
      
      debug(2, `[executeTriggerEffect] ${sourceName}: Condition met - opponent has more lands than ${controller} (${myLandCount} lands)`);
    }
    
    // Create library search resolution step directly
    const gameId = (ctx as any).gameId || 'unknown';
    const lib = ((ctx as any).libraries as Map<string, any[]>)?.get(controller) || [];
    
    if (lib.length === 0) {
      debug(2, `[executeTriggerEffect] ${sourceName}: Player ${controller} has empty library, skipping search`);
      return;
    }
    
    // Filter cards based on search criteria
    const filterAny = filter as any; // Filter can have types, subtypes, supertypes, colors, maxManaValue
    const availableCards: any[] = [];
    for (const card of lib) {
      let matches = true;
      
      // Check types
      if (filterAny.types && filterAny.types.length > 0) {
        const typeLine = (card.type_line || '').toLowerCase();
        matches = filterAny.types.some((type: string) => typeLine.includes(type.toLowerCase()));
      }
      
      // Check subtypes
      if (matches && filterAny.subtypes && filterAny.subtypes.length > 0) {
        const typeLine = (card.type_line || '').toLowerCase();
        matches = filterAny.subtypes.some((subtype: string) => typeLine.includes(subtype.toLowerCase()));
      }
      
      // Check supertypes
      if (matches && filterAny.supertypes && filterAny.supertypes.length > 0) {
        const typeLine = (card.type_line || '').toLowerCase();
        matches = filterAny.supertypes.some((supertype: string) => typeLine.includes(supertype.toLowerCase()));
      }
      
      // Check colors
      if (matches && filterAny.colors && filterAny.colors.length > 0) {
        const cardColors = card.colors || [];
        matches = filterAny.colors.some((color: string) => cardColors.includes(color));
      }
      
      // Check mana value
      if (matches && typeof filterAny.maxManaValue === 'number') {
        matches = (card.cmc || 0) <= filterAny.maxManaValue;
      }
      
      if (matches) {
        availableCards.push({
          id: card.id,
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          image_uris: card.image_uris,  // Include full image_uris object
          imageUrl: card.image_uris?.normal,
          mana_cost: card.mana_cost,
          cmc: card.cmc,
          colors: card.colors,
          power: card.power,
          toughness: card.toughness,
          loyalty: card.loyalty,
        });
      }
    }
    
    debug(2, `[executeTriggerEffect] ${sourceName}: Creating library search for ${controller}, ${availableCards.length} matching cards`);
    
    // Create description
    let stepDescription = searchFor || 'Search your library';
    if (destination === 'battlefield') {
      stepDescription += entersTapped ? ' (enters tapped)' : ' (enters untapped)';
    }
    
    const shuffleAfter = desc.includes('shuffle');
    
    // Skip adding resolution steps during replay to prevent infinite loops
    const isReplaying = !!(ctx as any).isReplaying;
    if (!isReplaying) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: controller,
        description: stepDescription,
        mandatory: !isOptional,
        sourceName: sourceName,
        searchCriteria: searchFor || 'any card',
        minSelections: 0,
        maxSelections: 1,
        destination,
        reveal: true,
        shuffleAfter,
        availableCards,
        entersTapped,
        remainderDestination: 'shuffle',
        remainderRandomOrder: true,
      });
      
      debug(2, `[executeTriggerEffect] ${sourceName} trigger: ${controller} may search for ${searchFor} (destination: ${destination}, filter: ${JSON.stringify(filter)})`);
    } else {
      debug(2, `[executeTriggerEffect] ${sourceName}: skipping library search during replay`);
    }
    
    return;
  }
  
  // ===== GENERIC: Put [type] creature from hand onto battlefield [tapped and attacking] =====
  // This handles patterns like:
  // - "you may put a Soldier creature card from your hand onto the battlefield tapped and attacking"
  // - "put an Angel, Demon, or Dragon creature card from your hand onto the battlefield tapped and attacking"
  // - "put a creature card from your hand onto the battlefield tapped and attacking"
  // Cards: Preeminent Captain (Soldier), Kaalia of the Vast (Angel/Demon/Dragon), Ilharg (creature), etc.
  const putFromHandPattern = desc.match(
    /(?:you may )?put (?:a|an) ([\w,\s]+?) creature card from your hand onto the battlefield(?: tapped and attacking)?/i
  );
  if (putFromHandPattern && !desc.includes('search your library')) {
    const creatureTypeRestriction = putFromHandPattern[1].toLowerCase().trim();
    const isTappedAndAttacking = desc.includes('tapped and attacking');
    const isOptionalPut = desc.toLowerCase().startsWith('you may');
    
    // Parse the creature type restriction - could be "soldier", "angel, demon, or dragon", etc.
    const allowedTypes: string[] = [];
    if (creatureTypeRestriction.includes(',') || creatureTypeRestriction.includes(' or ')) {
      // Multiple types: "angel, demon, or dragon" -> ["angel", "demon", "dragon"]
      const typeList = creatureTypeRestriction
        .replace(/,?\s*or\s+/g, ',')
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      allowedTypes.push(...typeList);
    } else if (creatureTypeRestriction && creatureTypeRestriction !== 'creature') {
      // Single type: "soldier" -> ["soldier"]
      allowedTypes.push(creatureTypeRestriction);
    }
    // If allowedTypes is empty or just "creature", any creature is allowed
    
    const gameId = (ctx as any).gameId || (state as any).gameId;
    const zones = state.zones || {};
    const hand = (zones[controller] as any)?.hand || [];
    
    // Filter hand to find valid creatures
    const validCreatures = hand.filter((card: any) => {
      const typeLine = (card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) return false;
      
      // If no type restriction, any creature is valid
      if (allowedTypes.length === 0) return true;
      
      // Check if creature has any of the allowed types
      return allowedTypes.some(allowedType => typeLine.includes(allowedType));
    });
    
    if (validCreatures.length === 0) {
      debug(2, `[executeTriggerEffect] ${sourceName}: No valid ${allowedTypes.length > 0 ? allowedTypes.join('/') : 'creature'} cards in hand`);
      return;
    }
    
    // Queue a resolution step for the player to select a creature from hand
    const typeDesc = allowedTypes.length > 0 ? allowedTypes.join('/') : 'creature';
    
    if (gameId) {
      const isReplaying = !!(ctx as any).isReplaying;
      if (!isReplaying) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODAL_CHOICE,
          playerId: controller,
          description: `${sourceName}: ${isOptionalPut ? 'You may put' : 'Put'} a ${typeDesc} creature from your hand onto the battlefield${isTappedAndAttacking ? ' tapped and attacking' : ''}`,
          mandatory: !isOptionalPut,
          sourceName: sourceName,
          sourceImage: triggerItem.value?.imageUrl,
          promptTitle: `Put ${typeDesc} onto Battlefield`,
          promptDescription: `Select a ${typeDesc} creature card from your hand to put onto the battlefield${isTappedAndAttacking ? ' tapped and attacking' : ''}.`,
          options: [
            ...(isOptionalPut ? [{ id: 'decline', label: 'Decline' }] : []),
            ...validCreatures.map((card: any) => ({
              id: card.id,
              label: card.name || 'Unknown Card',
              imageUrl: card.image_uris?.small || card.image_uris?.normal,
            })),
          ],
          minSelections: isOptionalPut ? 0 : 1,
          maxSelections: 1,
          // Store additional data for the resolution handler
          putFromHandData: {
            tappedAndAttacking: isTappedAndAttacking,
            validCardIds: validCreatures.map((c: any) => c.id),
          },
        });
        
        debug(2, `[executeTriggerEffect] ${sourceName}: Queued hand selection for ${typeDesc} creature (${validCreatures.length} valid cards)`);
      }
    }
    
    return;
  }
  
  // Pattern: "Create a Food/Treasure/Clue/Map token" (predefined artifact tokens)
  // Food: "{2}, {T}, Sacrifice this artifact: You gain 3 life."
  // Treasure: "{T}, Sacrifice this artifact: Add one mana of any color."
  // Clue: "{2}, Sacrifice this artifact: Draw a card."
  // Map: "{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery."
  // Blood: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card."
  const predefinedTokenTypes: Record<string, { typeLine: string; oracleText: string }> = {
    'food': {
      typeLine: 'Token Artifact — Food',
      oracleText: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    },
    'treasure': {
      typeLine: 'Token Artifact — Treasure',
      oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
    },
    'clue': {
      typeLine: 'Token Artifact — Clue',
      oracleText: '{2}, Sacrifice this artifact: Draw a card.',
    },
    'map': {
      typeLine: 'Token Artifact — Map',
      oracleText: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.',
    },
    'blood': {
      typeLine: 'Token Artifact — Blood',
      oracleText: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
    },
    'gold': {
      typeLine: 'Token Artifact — Gold',
      oracleText: 'Sacrifice this artifact: Add one mana of any color.',
    },
    'powerstone': {
      typeLine: 'Token Artifact — Powerstone',
      oracleText: '{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.',
    },
  };
  
  // Match patterns like "create a Food token", "create two Treasure tokens", "create 3 Clue tokens"
  const predefinedTokenMatch = desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (food|treasure|clue|map|blood|gold|powerstone) tokens?/i);
  if (predefinedTokenMatch) {
    const countWord = desc.match(/create (a|an|one|two|three|four|five|\d+)/i)?.[1]?.toLowerCase() || 'a';
    const wordToCount: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    const tokenCount = wordToCount[countWord] || (predefinedTokenMatch[1] ? parseInt(predefinedTokenMatch[1], 10) : 1);
    const tokenType = predefinedTokenMatch[2].toLowerCase();
    const tokenInfo = predefinedTokenTypes[tokenType];
    
    if (tokenInfo) {
      // Apply token doubling effects (Anointed Procession, Doubling Season, Elspeth, etc.)
      const tokensToCreate = tokenCount * getTokenDoublerMultiplier(controller, state);
      debug(2, `[executeTriggerEffect] Creating ${tokensToCreate} ${tokenType} tokens (base: ${tokenCount}, multiplier: ${getTokenDoublerMultiplier(controller, state)})`);
      
      state.battlefield = state.battlefield || [];
      for (let i = 0; i < tokensToCreate; i++) {
        const tokenId = uid("token");
        const tokenName = tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
        
        state.battlefield.push({
          id: tokenId,
          controller,
          owner: controller,
          tapped: false,
          counters: {},
          isToken: true,
          card: {
            id: tokenId,
            name: tokenName,
            type_line: tokenInfo.typeLine,
            oracle_text: tokenInfo.oracleText,
            zone: 'battlefield',
            colors: [],
          },
        } as any);
        
        debug(2, `[executeTriggerEffect] Created ${tokenName} token for ${controller}`);
      }
      return;
    }
  }
  
  // Pattern: "Create a X/Y [creature type] creature token" (various patterns)
  // Matches: "create a 2/2 green Wolf creature token", "create a 1/1 white Soldier creature token with vigilance"
  // Also matches: "create a 0/1 colorless Eldrazi Spawn creature token"
  // Also matches: "create two 1/1 white Cat creature tokens that are tapped and attacking"
  const createTokenMatch = desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (\d+)\/(\d+) ([^\.]+?)(?:\s+creature)?\s+tokens?/i);
  if (createTokenMatch) {
    // Parse count from word or number
    const countWord = desc.match(/create (a|an|one|two|three|four|five|\d+)/i)?.[1]?.toLowerCase() || 'a';
    const wordToCount: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    const tokenCount = wordToCount[countWord] || (createTokenMatch[1] ? parseInt(createTokenMatch[1], 10) : 1);
    const power = parseInt(createTokenMatch[2], 10);
    const toughness = parseInt(createTokenMatch[3], 10);
    const tokenDescription = createTokenMatch[4].trim();
    
    // Apply token doubling effects (Anointed Procession, Doubling Season, Elspeth, etc.)
    const tokensToCreate = tokenCount * getTokenDoublerMultiplier(controller, state);
    debug(2, `[executeTriggerEffect] Generic trigger creating ${tokensToCreate} tokens (base: ${tokenCount}, multiplier: ${getTokenDoublerMultiplier(controller, state)})`);
    
    // Check for "tapped and attacking" pattern
    const isTappedAndAttacking = desc.includes('tapped and attacking');
    
    // Extract color and creature type from description
    // e.g., "white Soldier" -> color: white, type: Soldier
    const parts = tokenDescription.split(/\s+/);
    const colors: string[] = [];
    const creatureTypes: string[] = [];
    
    const colorMap: Record<string, string> = {
      'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G', 'colorless': ''
    };
    
    for (const part of parts) {
      const lowerPart = part.toLowerCase();
      if (colorMap[lowerPart] !== undefined) {
        if (colorMap[lowerPart]) colors.push(colorMap[lowerPart]);
      } else if (lowerPart !== 'creature' && lowerPart !== 'token' && lowerPart !== 'and' && lowerPart !== 'with' && 
                 lowerPart !== 'that' && lowerPart !== 'are' && lowerPart !== 'tapped' && lowerPart !== 'attacking') {
        creatureTypes.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
      }
    }
    
    // Check for abilities in the description
    const abilities: string[] = [];
    if (desc.includes('vigilance')) abilities.push('Vigilance');
    if (desc.includes('haste')) abilities.push('Haste');
    if (desc.includes('lifelink')) abilities.push('Lifelink');
    if (desc.includes('deathtouch')) abilities.push('Deathtouch');
    if (desc.includes('flying')) abilities.push('Flying');
    if (desc.includes('first strike')) abilities.push('First strike');
    if (desc.includes('trample')) abilities.push('Trample');
    if (desc.includes('menace')) abilities.push('Menace');
    if (desc.includes('reach')) abilities.push('Reach');
    
    // Create the tokens
    state.battlefield = state.battlefield || [];
    debug(2, `[executeTriggerEffect] Creating tokens: tokenName=${creatureTypes.join(' ')}, power=${power}, toughness=${toughness}, colors=${JSON.stringify(colors)}`);
    for (let i = 0; i < tokensToCreate; i++) {
      const tokenId = uid("token");
      const tokenName = creatureTypes.length > 0 ? creatureTypes.join(' ') : 'Token';
      const typeLine = `Token Creature — ${creatureTypes.join(' ')}`;
      
      // Get token image from Scryfall data
      const tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
      debug(2, `[executeTriggerEffect] Token ${i+1}/${tokensToCreate}: imageUrls=${tokenImageUrls ? 'found' : 'NOT FOUND'}, normal=${tokenImageUrls?.normal?.substring(0, 50) || 'none'}...`);
      
      const token = {
        id: tokenId,
        controller,
        owner: controller,
        // Tokens that enter "tapped and attacking" are tapped, have no summoning sickness issue for attacking
        tapped: isTappedAndAttacking,
        counters: {},
        basePower: power,
        baseToughness: toughness,
        // Tokens that enter attacking don't have summoning sickness for the purpose of attacking
        summoningSickness: !abilities.includes('Haste') && !isTappedAndAttacking,
        isToken: true,
        // Mark as attacking if it enters attacking
        isAttacking: isTappedAndAttacking,
        card: {
          id: tokenId,
          name: tokenName,
          type_line: typeLine,
          power: String(power),
          toughness: String(toughness),
          colors,
          oracle_text: abilities.join(', '),
          keywords: abilities,
          zone: 'battlefield',
          image_uris: tokenImageUrls,
        },
      } as any;
      
      state.battlefield.push(token);
      debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token for ${controller}${isTappedAndAttacking ? ' (tapped and attacking)' : ''}`);
      
      // Trigger ETB effects from other permanents (Cathars' Crusade, Soul Warden, etc.)
      triggerETBEffectsForToken(ctx, token, controller);
    }
    return;
  }
  
  // Pattern: "create a token copy of equipped creature" or "create a token that's a copy of equipped creature"
  // Helm of the Host: "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except it's not legendary"
  if (desc.includes('token') && desc.includes('copy') && 
      (desc.includes('equipped creature') || desc.includes('equipped permanent'))) {
    const sourceId = triggerItem.source || triggerItem.permanentId;
    const sourcePerm = (state.battlefield || []).find((p: any) => p?.id === sourceId);
    
    if (!sourcePerm) {
      debug(2, `[executeTriggerEffect] Equipment source not found on battlefield - trigger fizzles`);
      return;
    }
    
    // Find what this equipment is attached to
    const attachedTo = sourcePerm.attachedTo;
    if (!attachedTo) {
      debug(2, `[executeTriggerEffect] Equipment ${sourcePerm.card?.name || 'equipment'} is not attached to anything - trigger fizzles`);
      return;
    }
    
    const equippedCreature = (state.battlefield || []).find((p: any) => p?.id === attachedTo);
    
    if (!equippedCreature || !equippedCreature.card) {
      debug(2, `[executeTriggerEffect] No equipped creature found for copy token creation - trigger fizzles`);
      return;
    }
    
    // Create a token copy
    const tokenId = uid("token");
    const originalCard = equippedCreature.card;
    const originalTypeLine = (originalCard.type_line || '').toLowerCase();
    
    // Remove "Legendary" from the type line (handle all positions)
    let tokenTypeLine = originalCard.type_line || 'Token';
    tokenTypeLine = tokenTypeLine.replace(/\bLegendary\s+/i, '').replace(/\s+Legendary\b/i, '').trim();
    
    // Check if the trigger description says the token gains/has haste
    // Helm of the Host: "That token gains haste" (from second sentence)
    // Check both the original creature's haste AND whether the trigger grants it
    const originalHasHaste = (originalCard.oracle_text || '').toLowerCase().includes('haste') ||
                            (Array.isArray(originalCard.keywords) && 
                             originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste'));
    
    // Check if trigger grants haste (look for "gains haste", "has haste", "with haste" in description)
    const triggerGrantsHaste = /(?:gains|has|with)\s+haste/i.test(desc);
    
    const hasHaste = originalHasHaste || triggerGrantsHaste;
    
    const isCreature = originalTypeLine.includes('creature');
    
    const tokenCopy = {
      id: tokenId,
      controller,
      owner: controller,
      tapped: false,
      counters: { ...equippedCreature.counters },
      basePower: equippedCreature.basePower,
      baseToughness: equippedCreature.baseToughness,
      // Tokens that are copies with haste don't have summoning sickness
      summoningSickness: isCreature && !hasHaste,
      isToken: true,
      card: {
        ...originalCard,
        id: tokenId,
        type_line: tokenTypeLine,
        zone: 'battlefield',
        // Add haste to oracle text if granted by trigger and not already present
        oracle_text: triggerGrantsHaste && !originalHasHaste
          ? (originalCard.oracle_text || '') + (originalCard.oracle_text ? '\n' : '') + 'Haste'
          : originalCard.oracle_text,
        keywords: triggerGrantsHaste && Array.isArray(originalCard.keywords) && !originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste')
          ? [...originalCard.keywords, 'Haste']
          : originalCard.keywords,
      },
    } as any;
    
    state.battlefield = state.battlefield || [];
    state.battlefield.push(tokenCopy);
    
    debug(2, `[executeTriggerEffect] Created token copy of ${originalCard.name || 'creature'} (not legendary${hasHaste ? ', with haste' : ''})`);
    
    // Trigger ETB effects for the copy token (Cathars' Crusade, Soul Warden, etc.)
    triggerETBEffectsForToken(ctx, tokenCopy, controller);
    return;
  }
  
  // Pattern: "each opponent mills X cards" or "each opponent mills a card" (Altar of the Brood)
  const millOpponentsMatch = desc.match(/each opponent mills? (?:a card|(\d+) cards?)/i);
  if (millOpponentsMatch) {
    const millCount = millOpponentsMatch[1] ? parseInt(millOpponentsMatch[1], 10) : 1;
    debug(2, `[executeTriggerEffect] Each opponent mills ${millCount} card(s)`);
    
    // Set up pending mill for each opponent
    state.pendingMill = state.pendingMill || {};
    for (const opp of opponents) {
      state.pendingMill[opp.id] = (state.pendingMill[opp.id] || 0) + millCount;
      
      // Get library from ctx.libraries Map (authoritative source) or fallback to zones
      const ctxLibraries = (ctx as any).libraries as Map<string, any[]> | undefined;
      let oppLib: any[] | undefined;
      if (ctxLibraries && typeof ctxLibraries.get === 'function') {
        oppLib = ctxLibraries.get(opp.id);
      }
      
      // Get opponent zones for graveyard
      const zones = state.zones || {};
      const oppZones = zones[opp.id] = zones[opp.id] || { 
        hand: [], handCount: 0, libraryCount: 0, 
        graveyard: [], graveyardCount: 0 
      };
      
      // Mill cards from library to graveyard
      if (oppLib && Array.isArray(oppLib)) {
        for (let i = 0; i < millCount && oppLib.length > 0; i++) {
          const milledCard = oppLib.shift();
          if (milledCard) {
            oppZones.graveyard = oppZones.graveyard || [];
            milledCard.zone = 'graveyard';
            oppZones.graveyard.push(milledCard);
            recordCardPutIntoGraveyardThisTurn(ctx, String(opp.id), milledCard, { fromBattlefield: false });
            debug(2, `[executeTriggerEffect] Milled ${milledCard.name || 'card'} from ${opp.id}'s library`);
          }
        }
        // Update library in Map
        if (ctxLibraries && typeof ctxLibraries.set === 'function') {
          ctxLibraries.set(opp.id, oppLib);
        }
        // Update library count and graveyard count
        oppZones.libraryCount = oppLib.length;
        oppZones.graveyardCount = (oppZones.graveyard || []).length;
      } else {
        debug(2, `[executeTriggerEffect] No library found for opponent ${opp.id}`);
      }
    }
    return;
  }
  
  // Pattern: "scry X" or "scry 1"
  const scryMatch = desc.match(/scry (\d+)/i);
  if (scryMatch) {
    const scryCount = parseInt(scryMatch[1], 10);
    debug(2, `[executeTriggerEffect] ${controller} scries ${scryCount}`);
    
    // Set up pending scry for the controller
    state.pendingScry = state.pendingScry || {};
    state.pendingScry[controller] = scryCount;
    return;
  }
  
  // Pattern: "each player draws X cards" or "each player draws a card"
  const eachDrawMatch = desc.match(/each player draws? (?:a card|(\d+) cards?)/i);
  if (eachDrawMatch) {
    const count = eachDrawMatch[1] ? parseInt(eachDrawMatch[1], 10) : 1;
    // Actually draw the cards instead of just setting pending
    for (const player of players) {
      if (!player.hasLost) {
        const drawn = drawCardsFromZone(ctx, player.id as PlayerID, count);
        debug(2, `[executeTriggerEffect] ${sourceName}: ${player.id} drew ${drawn.length} card(s)`);
      }
    }
    return;
  }
  
  // Pattern: "each opponent discards a card" or "each opponent discards X cards"
  const discardOpponentsMatch = desc.match(/each opponent discards? (?:a card|(\d+) cards?)/i);
  if (discardOpponentsMatch) {
    const discardCount = discardOpponentsMatch[1] ? parseInt(discardOpponentsMatch[1], 10) : 1;
    debug(2, `[executeTriggerEffect] Each opponent discards ${discardCount} card(s)`);
    
    state.pendingDiscard = state.pendingDiscard || {};
    for (const opp of opponents) {
      state.pendingDiscard[opp.id] = (state.pendingDiscard[opp.id] || 0) + discardCount;
    }
    return;
  }
  
  // Pattern: "put a number of +1/+1 counters on ~ equal to your devotion to [color]" (Reverent Hunter)
  // or "put X +1/+1 counters on ~ equal to [count]" (various scaling effects)
  const devotionCounterMatch = desc.match(/put (?:a number of|x) \+1\/\+1 counters? on (?:~|it|this creature) equal to (?:your devotion to (\w+)|(?:the number of )?([^.]+))/i);
  if (devotionCounterMatch) {
    const sourceId = triggerItem.source || triggerItem.permanentId;
    const devotionColor = devotionCounterMatch[1]?.toLowerCase();
    const otherScaling = devotionCounterMatch[2]?.trim().toLowerCase();
    
    let counterCount = 0;
    
    if (devotionColor) {
      // Calculate devotion to the specified color
      const battlefield = state.battlefield || [];
      const colorSymbol = devotionColor === 'white' ? 'W' :
                          devotionColor === 'blue' ? 'U' :
                          devotionColor === 'black' ? 'B' :
                          devotionColor === 'red' ? 'R' :
                          devotionColor === 'green' ? 'G' : '';
      
      for (const perm of battlefield) {
        if (!perm || perm.controller !== controller) continue;
        const manaCost = perm.card?.mana_cost || '';
        // Count occurrences of the color symbol in mana cost
        const matches = manaCost.match(new RegExp(`\\{${colorSymbol}\\}`, 'g'));
        if (matches) {
          counterCount += matches.length;
        }
      }
      debug(2, `[executeTriggerEffect] ${sourceName}: Devotion to ${devotionColor} = ${counterCount}`);
    } else if (otherScaling) {
      // Handle other scaling patterns (can be extended)
      // Examples: "the number of artifacts you control", "the number of creatures you control"
      const battlefield = state.battlefield || [];
      
      if (otherScaling.includes('artifact') && otherScaling.includes('you control')) {
        counterCount = battlefield.filter((p: any) => 
          p?.controller === controller && (p.card?.type_line || '').toLowerCase().includes('artifact')
        ).length;
      } else if (otherScaling.includes('creature') && otherScaling.includes('you control')) {
        counterCount = battlefield.filter((p: any) => 
          p?.controller === controller && (p.card?.type_line || '').toLowerCase().includes('creature')
        ).length;
      } else if (otherScaling.includes('land') && otherScaling.includes('you control')) {
        counterCount = battlefield.filter((p: any) => 
          p?.controller === controller && (p.card?.type_line || '').toLowerCase().includes('land')
        ).length;
      }
      debug(2, `[executeTriggerEffect] ${sourceName}: Scaling (${otherScaling}) = ${counterCount}`);
    }
    
    if (sourceId && counterCount > 0) {
      const perm = (state.battlefield || []).find((p: any) => p?.id === sourceId);
      if (perm) {
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + counterCount;
        debug(2, `[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${perm.card?.name || perm.id} (scaling effect)`);
      }
    }
    return;
  }
  
  // ========================================================================
  // PUT +1/+1 COUNTER(S) ON TARGET CREATURE(S)
  // Common planeswalker ability pattern
  // Patterns:
  // - "Put a +1/+1 counter on up to one target creature"
  // - "Put a +1/+1 counter on each of up to two target creatures"
  // - "Put X +1/+1 counters on target creature"
  // ========================================================================
  const putCounterOnTargetMatch = desc.match(/put (?:a|an|one|two|three|four|five|(\d+)) \+1\/\+1 counters? on (?:up to (?:one|two|three|\d+) )?(?:target|each of up to \w+ target) creatures?/i);
  if (putCounterOnTargetMatch && (triggerItem as any).targets?.length > 0) {
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];
    
    // Parse counter count using shared utility
    const countMatch = desc.match(/put (a|an|one|two|three|four|five|\d+) \+1\/\+1/i);
    const counterCount = parseNumberWord(countMatch?.[1], 1);
    
    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((p: any) => p.id === targetId);
      
      if (targetCreature) {
        targetCreature.counters = targetCreature.counters || {};
        targetCreature.counters['+1/+1'] = (targetCreature.counters['+1/+1'] || 0) + counterCount;
        debug(2, `[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${targetCreature.card?.name || targetId}`);
      }
    }
    return;
  }
  
  // Pattern: "put a +1/+1 counter on ~" or "put a +1/+1 counter on it"
  const putCounterOnSelfMatch = desc.match(/put (a|an|\d+) \+1\/\+1 counters? on (?:~|it|this creature)/i);
  if (putCounterOnSelfMatch) {
    const counterCount = parseNumberWord(putCounterOnSelfMatch[1], 1);
    const sourceId = triggerItem.source || triggerItem.permanentId;
    
    if (sourceId) {
      const perm = (state.battlefield || []).find((p: any) => p?.id === sourceId);
      if (perm) {
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + counterCount;
        debug(2, `[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // ========================================================================
  // TARGET CREATURE GETS +X/+Y UNTIL END OF TURN
  // Common planeswalker pattern: "Target creature gets +X/+Y until end of turn"
  // Also handles: "Target creature gets +X/+Y and gains [ability] until end of turn"
  // Also handles: "Up to one target creature gets +X/+Y..."
  // Also handles: "Until end of turn, target creature gets +X/+Y..." (Ajani Steadfast pattern)
  // NOTE: If "up to one" and no targets selected, this pattern won't match (targets.length === 0)
  // which is correct behavior - the ability simply doesn't do anything if no target chosen
  // 
  // Regex breakdown:
  // - (?:until end of turn,?\s*)? - Optional "until end of turn" at start (Ajani pattern)
  // - (?:up to (?:one|two|...|\d+) )? - Optional "up to N" targeting
  // - target creatures? gets? - Required targeting phrase
  // - ([+-]\d+)\/([+-]\d+) - Required P/T modification (captured as groups 1 & 2)
  // - (?: and gains ([^.]+?))? - Optional ability granting (captured as group 3)
  // - (?:\.|$| until end of turn) - Must end with period, EOL, or " until end of turn"
  // ========================================================================
  const creatureGetsMatch = desc.match(/(?:until end of turn,?\s*)?(?:up to (?:one|two|three|four|five|\d+) )?target creatures? gets? ([+-]\d+)\/([+-]\d+)(?: and gains ([^.]+?))?(?:\.|$| until end of turn)/i);
  if (creatureGetsMatch && (triggerItem as any).targets?.length > 0) {
    const powerMod = parseInt(creatureGetsMatch[1], 10);
    const toughnessMod = parseInt(creatureGetsMatch[2], 10);
    const gainedAbilities = creatureGetsMatch[3] ? creatureGetsMatch[3].trim() : null;
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];
    
    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((p: any) => p.id === targetId);
      
      if (targetCreature) {
        // Apply temporary P/T modification
        targetCreature.temporaryPTMods = targetCreature.temporaryPTMods || [];
        targetCreature.temporaryPTMods.push({
          power: powerMod,
          toughness: toughnessMod,
          source: sourceName,
          expiresAt: 'end_of_turn',
          turnApplied: state.turnNumber || 0,
        });
        
        // Apply granted abilities until end of turn
        if (gainedAbilities) {
          targetCreature.temporaryAbilities = targetCreature.temporaryAbilities || [];
          const abilities = gainedAbilities.split(/,\s*(?:and\s*)?/).map((a: string) => a.trim().toLowerCase());
          for (const ability of abilities) {
            if (ability) {
              targetCreature.temporaryAbilities.push({
                ability,
                source: sourceName,
                expiresAt: 'end_of_turn',
                turnApplied: state.turnNumber || 0,
              });
            }
          }
          debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} and gains ${gainedAbilities} until end of turn`);
        } else {
          debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} until end of turn`);
        }
      }
    }
    return;
  }
  
  // Pattern: "target player loses X life" (without the you gain part)
  const targetLosesMatch = desc.match(/target (?:player|opponent) loses (\d+) life/i);
  if (targetLosesMatch && !desc.includes('you gain')) {
    const loseAmount = parseInt(targetLosesMatch[1], 10);
    const targets = triggerItem.targets || [];
    const targetPlayer = targets[0] || (opponents[0]?.id);
    
    if (targetPlayer) {
      modifyLife(targetPlayer, -loseAmount);
    }
    return;
  }

  // Pattern: "that player loses X life" (common on opponent-upkeep hand-size punishers, etc.)
  const thatPlayerLosesMatch = desc.match(/that player loses (\d+) life/i);
  if (thatPlayerLosesMatch) {
    const loseAmount = parseInt(thatPlayerLosesMatch[1], 10);
    const thatPlayer =
      String(
        triggerItem?.triggeringPlayer ||
          triggerItem?.targetPlayer ||
          triggerItem?.defendingPlayer ||
          triggerItem?.targets?.[0] ||
          ''
      ) || null;
    if (thatPlayer) {
      modifyLife(thatPlayer, -loseAmount);
    }
    return;
  }
  
  // Pattern: "you lose X life" (Phyrexian Arena style) - LEGACY handler for single effects
  // NOTE: Combined effects are now handled earlier in the function
  const singleYouLoseLifeMatch = desc.match(/you lose (\d+) life/i);
  if (singleYouLoseLifeMatch && !desc.includes('draw')) {
    const amount = parseInt(singleYouLoseLifeMatch[1], 10);
    modifyLife(controller, -amount);
    return;
  }
  
  // Pattern: "deals X damage to target" or "deals X damage to any target"
  const dealsTargetDamageMatch = desc.match(/deals? (\d+) damage to (?:target|any target|that creature|it)/i);
  if (dealsTargetDamageMatch) {
    const damage = parseInt(dealsTargetDamageMatch[1], 10);
    const targets = triggerItem.targets || [];
    
    if (targets.length > 0) {
      const targetId = targets[0];
      // Check if target is a player
      const targetPlayer = players.find((p: any) => p.id === targetId);
      if (targetPlayer) {
        modifyLife(targetId, -damage);

        // Track damage taken this turn for intervening-if templates.
        try {
          (state as any).damageTakenThisTurnByPlayer = (state as any).damageTakenThisTurnByPlayer || {};
          (state as any).damageTakenThisTurnByPlayer[targetId] =
            ((state as any).damageTakenThisTurnByPlayer[targetId] || 0) + damage;
        } catch {
          /* ignore */
        }

        // Track life lost this turn (damage is life loss).
        try {
          (state as any).lifeLostThisTurn = (state as any).lifeLostThisTurn || {};
          (state as any).lifeLostThisTurn[targetId] = ((state as any).lifeLostThisTurn[targetId] || 0) + damage;
        } catch {
          /* ignore */
        }

        // Queue "Whenever ~ deals damage to a player" triggers from the damage source.
        try {
          const sourcePermanentId = String((triggerItem as any)?.source || (triggerItem as any)?.permanentId || '');
          if (sourcePermanentId) {
            queueDealsDamageToPlayerTriggersFromPermanent(ctx, sourcePermanentId, String(targetId));

            // Track that a creature dealt damage to a player this turn.
            try {
              const battlefield = (state as any).battlefield || [];
              const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
              const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
              if (sourcePerm && sourceTL.includes('creature')) {
                const creatureName = String(sourcePerm?.card?.name || 'Unknown Creature');
                (state as any).creaturesThatDealtDamageToPlayer = (state as any).creaturesThatDealtDamageToPlayer || {};
                const perPlayer = ((state as any).creaturesThatDealtDamageToPlayer[String(targetId)] =
                  (state as any).creaturesThatDealtDamageToPlayer[String(targetId)] || {});
                perPlayer[String(sourcePermanentId)] = {
                  creatureName,
                  totalDamage: (perPlayer[String(sourcePermanentId)]?.totalDamage || 0) + damage,
                  lastDamageTime: Date.now(),
                };
              }
            } catch {
              /* ignore */
            }
          }
        } catch {
          // Defensive: do not block resolution on trigger queue failure.
        }
      } else {
        // Target is a permanent - deal damage
        const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targetId);
        if (targetPerm) {
          targetPerm.damageMarked = (targetPerm.damageMarked || 0) + damage;
          // Track total damage dealt to this permanent this turn (for intervening-if clauses).
          targetPerm.damageThisTurn = (targetPerm.damageThisTurn || 0) + damage;
          targetPerm.tookDamageThisTurn = true;

          // Best-effort: track creature damaged by this creature this turn (for intervening-if templates).
          try {
            const sourcePermanentId = String((triggerItem as any)?.source || (triggerItem as any)?.permanentId || '');
            if (sourcePermanentId) {
              const battlefield = (state as any).battlefield || [];
              const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
              const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
              const targetTL = String(targetPerm?.card?.type_line || '').toLowerCase();
              if (sourcePerm && sourceTL.includes('creature') && targetTL.includes('creature')) {
                const stateAny = state as any;
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] =
                  stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId][String(targetId)] = true;
              }
            }
          } catch {
            /* ignore */
          }

          debug(2, `[executeTriggerEffect] Dealt ${damage} damage to ${targetPerm.card?.name || targetId}`);
          
          // Check for damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
          processDamageReceivedTriggers(ctx, targetPerm, damage, (triggerInfo) => {
            // Initialize pendingDamageTriggers if needed
            if (!state.pendingDamageTriggers) {
              state.pendingDamageTriggers = {};
            }
            
            // Add the trigger to the pending list for socket layer to process
            state.pendingDamageTriggers[triggerInfo.triggerId] = {
              sourceId: triggerInfo.sourceId,
              sourceName: triggerInfo.sourceName,
              controller: triggerInfo.controller,
              damageAmount: triggerInfo.damageAmount,
              triggerType: 'dealt_damage' as const,
              targetType: triggerInfo.targetType,
              ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
            };
            
            debug(2, `[executeTriggerEffect] Queued damage trigger: ${triggerInfo.sourceName} was dealt ${damage} damage`);
          });
        }
      }
    }
    return;
  }
  
  // Pattern: "untap all creatures you control" or "untap target creature"
  if (desc.includes('untap all creatures you control')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      if (perm.tapped) {
        perm.tapped = false;
        debug(2, `[executeTriggerEffect] Untapped ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // Pattern: "tap target creature" or "tap all creatures"
  if (desc.includes('tap target creature')) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        targetPerm.tapped = true;
        debug(2, `[executeTriggerEffect] Tapped ${targetPerm.card?.name || targetPerm.id}`);
      }
    }
    return;
  }
  
  // Pattern: "exile target creature/permanent ... until ~ leaves the battlefield" (Oblivion Ring-style)
  // This is a LINKED exile - the exiled card returns when the source permanent leaves
  const linkedExileMatch = desc.match(/exile (?:target |that )?([^.]+) until [^.]* leaves the battlefield/i);
  if (linkedExileMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const permIndex = state.battlefield.indexOf(targetPerm);
        if (permIndex !== -1) {
          const exiledPermanentId = targetPerm.id;
          const exiledCard = targetPerm.card;
          const exiledCardName = exiledCard?.name || targetPerm.id;
          const originalOwner = targetPerm.owner;
          const originalController = targetPerm.controller;
          
          // Remove from battlefield
          state.battlefield.splice(permIndex, 1);
          
          // Tokens cease to exist when they leave the battlefield
          if (targetPerm.isToken || exiledCard?.isToken) {
            debug(2, `[executeTriggerEffect] ${exiledCardName} token ceases to exist (not added to exile, no return)`);
          } else {
            // Add to exile zone (tag with its source so intervening-if checks can be decidable)
            const ownerZones = state.zones?.[originalOwner];
            if (ownerZones) {
              ownerZones.exile = ownerZones.exile || [];
              const sourceId = triggerItem.sourceId || triggerItem.permanentId;
              const tagged = {
                ...(exiledCard || {}),
                zone: 'exile',
                ...(sourceId ? { exiledWithSourceId: sourceId, exiledWithSourceName: sourceName } : {}),
              };
              ownerZones.exile.push(tagged);
              ownerZones.exileCount = (ownerZones.exile || []).length;
            }
            
            // Register the linked exile so the card returns when source leaves
            const sourceId = triggerItem.sourceId || triggerItem.permanentId;
            registerLinkedExile(
              ctx,
              sourceId,
              sourceName,
              exiledCard,
              originalOwner,
              originalController
            );
            
            debug(2, `[executeTriggerEffect] ${sourceName} exiled ${exiledCardName} - will return when ${sourceName} leaves the battlefield`);
          }
          
          // Process linked exile returns for the removed permanent
          processLinkedExileReturns(ctx, exiledPermanentId);
        }
      }
    }
    return;
  }
  
  // Pattern: "exile target creature" or "exile it" (simple exile, no return)
  const exileMatch = desc.match(/exile (?:target (?:creature|permanent)|it|that creature)/i);
  if (exileMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        // Check if the source card has a linked exile effect
        const sourceCard = triggerItem.card;
        const linkedEffect = sourceCard ? detectLinkedExileEffect(sourceCard) : null;
        
        // Use movePermanentToExile to properly handle commander replacement effects
        // Import and use the function from counters_tokens
        try {
          const oracleLower = String(triggerItem.card?.oracle_text || '').toLowerCase();
          const shouldTagExiledWith = oracleLower.includes('exiled with');

          const sourceId = triggerItem.sourceId || triggerItem.permanentId;
          const sourceOracleId = triggerItem.card?.id;
          if (shouldTagExiledWith) {
            movePermanentToExile(ctx, targetPerm.id, {
              ...(sourceId ? { exiledWithSourceId: sourceId, exiledWithSourceName: sourceName } : {}),
              ...(sourceOracleId ? { exiledWithOracleId: String(sourceOracleId) } : {}),
            });
          } else {
            movePermanentToExile(ctx, targetPerm.id);
          }
          
          // If this is a linked exile effect, register the link
          if (linkedEffect?.hasLinkedExile && targetPerm.card && !targetPerm.isToken && !targetPerm.card?.isToken) {
            registerLinkedExile(
              ctx,
              sourceId,
              sourceName,
              targetPerm.card,
              targetPerm.owner,
              targetPerm.controller
            );
            debug(2, `[executeTriggerEffect] ${sourceName} exiled ${targetPerm.card?.name || targetPerm.id} (linked - returns when ${sourceName} leaves)`);
          } else if (!targetPerm.isToken && !targetPerm.card?.isToken) {
            debug(2, `[executeTriggerEffect] Exiled ${targetPerm.card?.name || targetPerm.id}`);
          }
        } catch (err) {
          debugWarn(1, `[executeTriggerEffect] Error calling movePermanentToExile:`, err);
        }
      }
    }
    return;
  }
  
  // Pattern: "destroy target creature" or "destroy it"  
  const destroyMatch = desc.match(/destroy (?:target (?:creature|permanent|artifact|enchantment)|it|that creature)/i);
  if (destroyMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const owner = targetPerm.owner;
        const card = targetPerm.card;
        
        // Check if this is a commander (Rule 903.9a)
        const commandZone = (ctx as any).commandZone || {};
        const commanderInfo = commandZone[owner];
        const commanderIds = commanderInfo?.commanderIds || [];
        const isCommander = (card?.id && commanderIds.includes(card.id)) || targetPerm.isCommander === true;
        
        // Move to graveyard
        const permIndex = state.battlefield.indexOf(targetPerm);
        if (permIndex !== -1) {
          const destroyedPermanentId = targetPerm.id;
          state.battlefield.splice(permIndex, 1);
          
          if (isCommander && card) {
            // Commander Replacement Effect (Rule 903.9a):
            // If a commander would be put into graveyard from anywhere,
            // its owner may put it into the command zone instead.
            ResolutionQueueManager.addStep(ctx.gameId, {
              type: ResolutionStepType.COMMANDER_ZONE_CHOICE,
              playerId: owner,
              sourceId: destroyedPermanentId,
              sourceName: card.name,
              description: `Your commander ${card.name} would be put into your graveyard. Move it to the command zone instead?`,
              mandatory: true,
              commanderId: card.id,
              commanderName: card.name,
              fromZone: 'graveyard',
              card: {
                id: card.id,
                name: card.name,
                type_line: card.type_line,
                oracle_text: card.oracle_text,
                image_uris: card.image_uris,
                mana_cost: card.mana_cost,
                power: card.power,
                toughness: card.toughness,
              } as any,
            } as any);
            debug(2, `[executeTriggerEffect] Commander ${card.name} destroyed - queued commander zone choice step`);
          } else {
            // Non-commander - move directly to graveyard
            const ownerZones = state.zones?.[targetPerm.owner];
            if (ownerZones) {
              ownerZones.graveyard = ownerZones.graveyard || [];
              targetPerm.card.zone = 'graveyard';
              ownerZones.graveyard.push(targetPerm.card);
              recordCardPutIntoGraveyardThisTurn(ctx, String(targetPerm.owner), targetPerm.card, {
                fromBattlefield: true,
                controllerId: String((targetPerm as any).controller || targetPerm.owner),
              });
              ownerZones.graveyardCount = (ownerZones.graveyard || []).length;
              
              // Check for graveyard triggers (Eldrazi shuffle)
              if (checkGraveyardTrigger(ctx, targetPerm.card, targetPerm.owner)) {
                debug(2, `[executeTriggerEffect] ${targetPerm.card?.name} triggered graveyard shuffle for ${targetPerm.owner}`);
              }
            }
            debug(2, `[executeTriggerEffect] Destroyed ${targetPerm.card?.name || targetPerm.id}`);
          }
          
          // Process linked exile returns for the removed permanent
          processLinkedExileReturns(ctx, destroyedPermanentId);
        }
      }
    }
    return;
  }
  
  // Pattern: "return target creature to its owner's hand" (bounce)
  const bounceMatch = desc.match(/return (?:target|a) (?:creature|permanent) (?:card )?(?:from [^.]+ )?to its owner's hand/i);
  if (bounceMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const owner = targetPerm.owner;
        const card = targetPerm.card;
        
        // Commander Replacement Effect (Rule 903.9a):
        // If a commander would be put into its owner's hand from anywhere, 
        // its owner may put it into the command zone instead.
        const commandZone = (ctx as any).commandZone || {};
        const commanderInfo = commandZone[owner];
        const commanderIds = commanderInfo?.commanderIds || [];
        const isCommander = (card?.id && commanderIds.includes(card.id)) || targetPerm.isCommander === true;
        
        // Move to owner's hand
        const permIndex = state.battlefield.indexOf(targetPerm);
        if (permIndex !== -1) {
          const bouncedPermanentId = targetPerm.id;
          state.battlefield.splice(permIndex, 1);
          
          if (isCommander && card) {
            // Defer zone change - let player choose command zone or hand
            ResolutionQueueManager.addStep(ctx.gameId, {
              type: ResolutionStepType.COMMANDER_ZONE_CHOICE,
              playerId: owner,
              sourceId: bouncedPermanentId,
              sourceName: card.name,
              description: `Your commander ${card.name} would be returned to your hand. Move it to the command zone instead?`,
              mandatory: true,
              commanderId: card.id,
              commanderName: card.name,
              fromZone: 'hand',
              card: {
                id: card.id,
                name: card.name,
                type_line: card.type_line,
                oracle_text: card.oracle_text,
                image_uris: card.image_uris,
                mana_cost: card.mana_cost,
                power: card.power,
                toughness: card.toughness,
              } as any,
            } as any);
            debug(2, `[executeTriggerEffect] Commander ${card.name} would go to hand - queued commander zone choice step`);
          } else {
            // Non-commander - move directly to hand
            const ownerZones = state.zones?.[owner];
            if (ownerZones) {
              ownerZones.hand = ownerZones.hand || [];
              card.zone = 'hand';
              ownerZones.hand.push(card);
              ownerZones.handCount = ownerZones.hand.length;
            }
            debug(2, `[executeTriggerEffect] Returned ${card?.name || targetPerm.id} to owner's hand`);
          }
          
          // Process linked exile returns for the removed permanent
          processLinkedExileReturns(ctx, bouncedPermanentId);
        }
      }
    }
    return;
  }
  
  // Pattern: "exile the top card of your library" (Prosper, Theater of Horrors, etc.)
  // These cards let you play the exiled card until end of turn or end of next turn
  const exileTopCardMatch = desc.match(/exile the top card of your library/i);
  if (exileTopCardMatch) {
    // Get the controller's library
    const lib = (ctx as any).libraries?.get(controller);
    if (lib && lib.length > 0) {
      // Remove top card from library
      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);
      
      // Update library count
      const zones = state.zones?.[controller];
      if (zones) {
        zones.libraryCount = lib.length;
      }
      
      // Add to exile zone with "can play" flag
      state.exile = state.exile || [];
      const exiledCard = {
        ...topCard,
        zone: 'exile',
        canBePlayedBy: controller,
        playableUntilTurn: (state.turnNumber || 0) + 1, // Until end of next turn
        exiledBy: sourceName,
      };
      state.exile.push(exiledCard);
      
      // Also track in a pending impulse draw state for the UI
      state.pendingImpulseDraws = state.pendingImpulseDraws || {};
      state.pendingImpulseDraws[controller] = state.pendingImpulseDraws[controller] || [];
      state.pendingImpulseDraws[controller].push({
        cardId: topCard.id,
        cardName: topCard.name,
        exiledBy: sourceName,
        playableUntilTurn: (state.turnNumber || 0) + 1,
      });
      
      debug(2, `[executeTriggerEffect] ${sourceName}: Exiled ${topCard.name || 'card'} from ${controller}'s library (can play until end of next turn)`);
    }
    return;
  }
  
  // Pattern: add mana (Cryptolith Rite, etc.)
  const addManaMatch = desc.match(/add (\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (addManaMatch) {
    const manaString = addManaMatch[1];
    debug(2, `[executeTriggerEffect] ${controller} adds ${manaString} to mana pool`);
    
    // Parse mana and add to pool
    state.manaPool = state.manaPool || {};
    state.manaPool[controller] = state.manaPool[controller] || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    
    const manaRegex = /\{([WUBRGC])\}/gi;
    let match;
    while ((match = manaRegex.exec(manaString)) !== null) {
      const color = match[1].toUpperCase();
      if (state.manaPool[controller][color] !== undefined) {
        state.manaPool[controller][color]++;
      }
    }
    return;
  }
  
  // Pattern: "whenever an opponent draws a card" - deals damage or other effect
  // Scrawling Crawler, Nekusar, Fate Unraveler, etc.
  const opponentDrawsDamageMatch = desc.match(/whenever (?:an )?opponent draws (?:a card|cards?),?\s*(?:[^,.]+ )?(?:deals? |loses? )(\d+) (?:damage|life)/i);
  if (opponentDrawsDamageMatch) {
    const damage = parseInt(opponentDrawsDamageMatch[1], 10);
    // This trigger should have been put on stack when opponent drew
    // The triggerItem should contain info about which opponent drew
    const drawingPlayer = triggerItem?.triggeringPlayer || triggerItem?.targets?.[0];
    if (drawingPlayer && drawingPlayer !== controller) {
      modifyLife(drawingPlayer, -damage);
      debug(2, `[executeTriggerEffect] ${sourceName}: ${drawingPlayer} loses ${damage} life from drawing`);
    }
    return;
  }
  
  // Pattern: "whenever a player draws a card" - universal draw trigger
  const playerDrawsTriggerMatch = desc.match(/whenever (?:a )?player draws (?:a card|cards?),?\s*([^.]+)/i);
  if (playerDrawsTriggerMatch) {
    const effectText = playerDrawsTriggerMatch[1].trim();
    // Check for damage/life loss patterns
    const damageMatch = effectText.match(/(?:deals? |loses? )(\d+) (?:damage|life)/i);
    if (damageMatch) {
      const damage = parseInt(damageMatch[1], 10);
      const drawingPlayer = triggerItem?.triggeringPlayer || triggerItem?.targets?.[0];
      if (drawingPlayer) {
        modifyLife(drawingPlayer, -damage);
        debug(2, `[executeTriggerEffect] ${sourceName}: ${drawingPlayer} loses ${damage} life from drawing`);
      }
    }
    return;
  }
  
  // Pattern: "that player adds {X}{X}{X}" - mana production for specific player
  const thatPlayerAddsManaMatch = desc.match(/that player adds (\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (thatPlayerAddsManaMatch) {
    const manaString = thatPlayerAddsManaMatch[1];
    const targetPlayer = triggerItem?.triggeringPlayer || controller;
    debug(2, `[executeTriggerEffect] ${targetPlayer} adds ${manaString} to mana pool`);
    
    state.manaPool = state.manaPool || {};
    state.manaPool[targetPlayer] = state.manaPool[targetPlayer] || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    
    const manaRegex2 = /\{([WUBRGC])\}/gi;
    let manaMatch;
    while ((manaMatch = manaRegex2.exec(manaString)) !== null) {
      const color = manaMatch[1].toUpperCase();
      if (state.manaPool[targetPlayer][color] !== undefined) {
        state.manaPool[targetPlayer][color]++;
      }
    }
    return;
  }

  // Pattern: "<source> deals N damage to that player" (Harsh Mentor, etc.)
  const dealsDamageToThatPlayerMatch = desc.match(/deals?\s+(\d+)\s+damage\s+to\s+that\s+player/i);
  if (dealsDamageToThatPlayerMatch) {
    const dmg = parseInt(dealsDamageToThatPlayerMatch[1], 10);
    const targetPlayer = triggerItem?.triggeringPlayer || triggerItem?.targetPlayer || controller;
    if (targetPlayer) {
      modifyLife(targetPlayer, -dmg);
      debug(2, `[executeTriggerEffect] ${sourceName}: ${String(targetPlayer)} takes ${dmg} damage (that player)`);
    }
    return;
  }
  
  // Pattern: "Additional combat phase" or "extra combat phase" (Aurelia, Combat Celebrant, etc.)
  if (desc.includes('additional combat phase') || desc.includes('extra combat phase')) {
    const sourceNameLower = sourceName.toLowerCase();
    
    // Check if this is a "first attack each turn" condition (Aurelia)
    const isFirstAttackOnly = desc.includes('first attack') || desc.includes('first combat');
    
    // Check if we should untap creatures (Aurelia does this)
    const shouldUntap = desc.includes('untap all creatures') || sourceNameLower.includes('aurelia');
    
    // Check if this trigger has already fired this turn (for "once per turn" effects)
    const extraCombatKey = `extraCombat_${sourceName}_${state.turnNumber || 0}`;
    if (isFirstAttackOnly && state.usedOncePerTurn?.[extraCombatKey]) {
      debug(2, `[executeTriggerEffect] ${sourceName} extra combat already used this turn, skipping`);
      return;
    }
    
    // Mark as used for "once per turn" effects
    if (isFirstAttackOnly) {
      state.usedOncePerTurn = state.usedOncePerTurn || {};
      state.usedOncePerTurn[extraCombatKey] = true;
    }
    
    // Add the extra combat phase
    addExtraCombat(ctx, sourceName, shouldUntap);
    debug(2, `[executeTriggerEffect] ${sourceName}: Added extra combat phase (untap: ${shouldUntap})`);
    return;
  }
  
  // Pattern: "untap all creatures you control" without extra combat
  if (desc.includes('untap all creatures you control') && !desc.includes('combat phase')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      if (perm.tapped) {
        perm.tapped = false;
        debug(2, `[executeTriggerEffect] Untapped ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // ===== PROLIFERATE =====
  // Pattern: "Proliferate" - Add one counter of each kind to chosen permanents/players
  // Rule 701.34: Choose any number of permanents and/or players that have a counter,
  // then give each one additional counter of each kind that permanent or player already has.
  if (desc.includes('proliferate')) {
    debug(2, `[executeTriggerEffect] Proliferate effect from ${sourceName} for ${controller}`);
    
    // Set up pending proliferate choice - the socket layer will prompt the player
    // to select targets (permanents/players with counters)
    state.pendingProliferate = state.pendingProliferate || [];
    state.pendingProliferate.push({
      id: uid("proliferate"),
      controller,
      sourceName: sourceName || 'Proliferate Effect',
      imageUrl: triggerItem.value?.imageUrl,
    });
    
    return;
  }
  
  // ===== GENERIC: Create X tokens where X is the number of [type] you control =====
  // This handles patterns like:
  // - "Create X 1/1 [color] [type] creature tokens, where X is the number of [countType] you control"
  // - "Create X 1/1 colorless [type] artifact creature tokens, where X is the number of [countType] you control"
  // Cards: Krenko Mob Boss (Goblins), Horn of Gondor (Humans), Myrel (Soldiers), etc.
  const createXTokensPattern = desc.match(
    /create\s+x\s+(\d+)\/(\d+)\s+(colorless\s+)?(\w+(?:\s+\w+)*?)\s+(artifact\s+)?creature\s+tokens?,?\s*where\s+x\s+is\s+(?:the\s+)?number\s+of\s+(\w+)s?\s+you\s+control/i
  );
  if (createXTokensPattern) {
    const power = parseInt(createXTokensPattern[1], 10);
    const toughness = parseInt(createXTokensPattern[2], 10);
    const isColorless = !!createXTokensPattern[3];
    const tokenType = createXTokensPattern[4].trim();
    const isArtifact = !!createXTokensPattern[5];
    // Normalize countType to singular form - the regex may capture plural form (e.g., "Soldiers")
    // but type_line uses singular (e.g., "Creature - Soldier")
    let countType = createXTokensPattern[6].toLowerCase();
    // Handle irregular plurals first (using module-level constant), then regular plurals
    if (IRREGULAR_PLURALS[countType]) {
      countType = IRREGULAR_PLURALS[countType];
    } else if (countType.endsWith('s') && countType.length > 1) {
      // Strip trailing 's' to get singular form for matching
      // This handles: Soldiers -> soldier, Goblins -> goblin, Humans -> human, etc.
      countType = countType.slice(0, -1);
    }
    
    const battlefield = state.battlefield || [];
    
    // Count permanents of the specified type that controller controls
    let count = 0;
    debug(2, `[executeTriggerEffect] COUNT DEBUG: battlefield.length=${battlefield.length}, controller=${controller}, countType=${countType}`);
    for (const perm of battlefield) {
      if (!perm) continue;
      const permController = perm.controller;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      const matchesType = typeLine.includes(countType);
      const matchesController = permController === controller;
      debug(3, `[executeTriggerEffect] PERM: ${perm.card?.name || 'unknown'}, controller=${permController}, typeLine=${typeLine}, matchesType=${matchesType}, matchesController=${matchesController}`);
      if (!matchesController) continue;
      if (matchesType) {
        count++;
      }
    }
    
    debug(2, `[executeTriggerEffect] ${sourceName}: Creating ${count} ${tokenType} tokens for ${controller} (${countType} controlled: ${count})`);
    
    // Extra debug if count is 0 but we expected soldiers
    if (count === 0 && battlefield.length > 0) {
      const allCreatures = battlefield.filter((p: any) => p?.card?.type_line?.toLowerCase().includes('creature'));
      debug(1, `[executeTriggerEffect] WARNING: 0 ${countType}s found but ${allCreatures.length} creatures on battlefield. Controllers: ${[...new Set(battlefield.map((p: any) => p?.controller))].join(', ')}. Expected controller: ${controller}`);
    }
    
    // Apply token doublers (Anointed Procession, Doubling Season, etc.)
    const tokensToCreate = count * getTokenDoublerMultiplier(controller, state);
    
    // Determine color based on token type and colorless flag
    let colors: string[] = [];
    if (!isColorless) {
      // Try to infer color from the token type description in oracle text
      const fullDesc = desc.toLowerCase();
      if (fullDesc.includes('white')) colors = ['W'];
      else if (fullDesc.includes('blue')) colors = ['U'];
      else if (fullDesc.includes('black')) colors = ['B'];
      else if (fullDesc.includes('red')) colors = ['R'];
      else if (fullDesc.includes('green')) colors = ['G'];
    }
    
    // Build type line
    let typeLineParts = ['Token'];
    if (isArtifact) typeLineParts.push('Artifact');
    typeLineParts.push('Creature');
    typeLineParts.push('—');
    typeLineParts.push(tokenType);
    const typeLine = typeLineParts.join(' ');
    
    // Create tokens
    for (let i = 0; i < tokensToCreate; i++) {
      const tokenId = uid("token");
      const imageUrls = getTokenImageUrls(tokenType, power, toughness, colors.length > 0 ? colors : undefined);
      
      const token = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: power,
        baseToughness: toughness,
        summoningSickness: true,
        isToken: true,
        card: {
          id: tokenId,
          name: tokenType,
          type_line: typeLine,
          power: String(power),
          toughness: String(toughness),
          zone: 'battlefield',
          colors: colors,
          image_uris: imageUrls,
        },
      };
      
      state.battlefield.push(token as any);
      triggerETBEffectsForToken(ctx, token, controller);
      debug(2, `[executeTriggerEffect] Created ${tokenType} token ${i + 1}/${tokensToCreate}`);
    }
    
    return;
  }
  
  // ===== LEGACY: Horn of Gondor / Krenko specific patterns (fallback for edge cases) =====
  // Pattern: "Create X 1/1 white Human Soldier creature tokens, where X is the number of Humans you control"
  // Horn of Gondor: "{3}, {T}: Create X 1/1 white Human Soldier creature tokens, where X is the number of Humans you control."
  if ((desc.includes('create') && desc.includes('human') && desc.includes('soldier') &&
       (desc.includes('number of humans') || desc.includes('humans you control')))) {
    const battlefield = state.battlefield || [];
    
    // Count Humans controller controls
    let humanCount = 0;
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (typeLine.includes('human')) {
        humanCount++;
      }
    }
    
    debug(2, `[executeTriggerEffect] ${sourceName}: Creating ${humanCount} Human Soldier tokens for ${controller} (humans controlled: ${humanCount})`);
    
    // Apply token doublers (Anointed Procession, Doubling Season, etc.)
    const tokensToCreate = humanCount * getTokenDoublerMultiplier(controller, state);
    
    // Create X 1/1 white Human Soldier tokens
    for (let i = 0; i < tokensToCreate; i++) {
      const tokenId = uid("token");
      const typeLine = 'Token Creature — Human Soldier';
      const imageUrls = getTokenImageUrls('Human Soldier', 1, 1, ['W']);
      
      const soldierToken = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        summoningSickness: true,
        isToken: true,
        card: {
          id: tokenId,
          name: 'Human Soldier',
          type_line: typeLine,
          power: '1',
          toughness: '1',
          zone: 'battlefield',
          colors: ['W'],
          image_uris: imageUrls,
        },
      };
      
      state.battlefield.push(soldierToken as any);
      
      // Trigger ETB effects for each token (Cathars' Crusade, Soul Warden, Impact Tremors, etc.)
      triggerETBEffectsForToken(ctx, soldierToken, controller);
      
      debug(2, `[executeTriggerEffect] Created Human Soldier token ${i + 1}/${tokensToCreate}`);
    }
    
    return;
  }
  
  // ===== KRENKO, MOB BOSS ACTIVATED ABILITY =====
  // Pattern: "Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control"
  // Krenko, Mob Boss: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control."
  if ((desc.includes('create') && desc.includes('goblin') && 
       (desc.includes('number of goblins') || desc.includes('goblins you control'))) ||
      (sourceName.toLowerCase().includes('krenko') && sourceName.toLowerCase().includes('mob boss'))) {
    const battlefield = state.battlefield || [];
    
    // Count Goblins controller controls
    let goblinCount = 0;
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (typeLine.includes('goblin')) {
        goblinCount++;
      }
    }
    
    debug(2, `[executeTriggerEffect] ${sourceName}: Creating ${goblinCount} Goblin tokens for ${controller} (goblins controlled: ${goblinCount})`);
    
    // Apply token doublers (Anointed Procession, Doubling Season, etc.)
    const tokensToCreate = goblinCount * getTokenDoublerMultiplier(controller, state);
    
    // Create X 1/1 red Goblin tokens
    for (let i = 0; i < tokensToCreate; i++) {
      const tokenId = uid("token");
      const typeLine = 'Token Creature — Goblin';
      const imageUrls = getTokenImageUrls('Goblin', 1, 1, ['R']);
      
      const goblinToken = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        summoningSickness: true,
        isToken: true,
        card: {
          id: tokenId,
          name: 'Goblin',
          type_line: typeLine,
          power: '1',
          toughness: '1',
          zone: 'battlefield',
          colors: ['R'],
          image_uris: imageUrls,
        },
      };
      
      state.battlefield.push(goblinToken as any);
      
      // Trigger ETB effects for each token (Cathars' Crusade, Soul Warden, Impact Tremors, etc.)
      triggerETBEffectsForToken(ctx, goblinToken, controller);
      
      debug(2, `[executeTriggerEffect] Created Goblin token ${i + 1}/${tokensToCreate}`);
    }
    
    return;
  }
  
  // ===== MYREL, SHIELD OF ARGIVE =====
  // Pattern: "Create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control"
  // This handles Myrel and similar "create tokens based on type count" effects
  if ((desc.includes('create') && desc.includes('soldier') && desc.includes('artifact') && 
       (desc.includes('number of soldiers you control') || desc.includes('soldiers you control'))) ||
      (sourceName.toLowerCase().includes('myrel'))) {
    const battlefield = state.battlefield || [];
    
    // Count Soldiers the controller controls
    let soldierCount = 0;
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (typeLine.includes('soldier')) {
        soldierCount++;
      }
    }
    
    debug(2, `[executeTriggerEffect] ${sourceName}: Creating ${soldierCount} Soldier artifact tokens for ${controller}`);
    
    // Apply token doublers (Anointed Procession, Doubling Season, etc.)
    const tokensToCreate = soldierCount * getTokenDoublerMultiplier(controller, state);
    
    // Create X 1/1 colorless Soldier artifact creature tokens
    for (let i = 0; i < tokensToCreate; i++) {
      const tokenId = uid("token");
      const typeLine = 'Token Artifact Creature — Soldier';
      const imageUrls = getTokenImageUrls('Soldier', 1, 1, []);
      
      const soldierToken = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        summoningSickness: true,
        isToken: true,
        card: {
          id: tokenId,
          name: 'Soldier',
          type_line: typeLine,
          power: '1',
          toughness: '1',
          zone: 'battlefield',
          colors: [], // colorless
          image_uris: imageUrls,
        },
      };
      
      state.battlefield.push(soldierToken as any);
      
      // Trigger ETB effects for each token (Cathars' Crusade, Soul Warden, Impact Tremors, etc.)
      triggerETBEffectsForToken(ctx, soldierToken, controller);
      
      debug(2, `[executeTriggerEffect] Created Soldier artifact token ${i + 1}/${tokensToCreate}`);
    }
    
    return;
  }
  
  // ===== DEPLOY TO THE FRONT =====
  // Pattern: "Create X 1/1 white Soldier creature tokens, where X is the number of creatures on the battlefield"
  // Deploy to the Front: "Create X 1/1 white Soldier creature tokens, where X is the number of creatures on the battlefield."
  if ((desc.includes('create') && desc.includes('soldier') && 
       desc.includes('number of creatures on the battlefield')) ||
      (sourceName.toLowerCase().includes('deploy to the front'))) {
    const battlefield = state.battlefield || [];
    
    // Count ALL creatures on the battlefield (not just controller's)
    let creatureCount = 0;
    for (const perm of battlefield) {
      if (!perm) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (typeLine.includes('creature')) {
        creatureCount++;
      }
    }
    
    debug(2, `[executeTriggerEffect] ${sourceName}: Creating ${creatureCount} Soldier tokens for ${controller} (creatures on battlefield: ${creatureCount})`);
    
    // Apply token doublers (Anointed Procession, Doubling Season, etc.)
    const tokensToCreate = creatureCount * getTokenDoublerMultiplier(controller, state);
    
    // Create X 1/1 white Soldier tokens
    for (let i = 0; i < tokensToCreate; i++) {
      const tokenId = uid("token");
      const typeLine = 'Token Creature — Soldier';
      const imageUrls = getTokenImageUrls('Soldier', 1, 1, ['W']);
      
      const soldierToken = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        summoningSickness: true,
        isToken: true,
        card: {
          id: tokenId,
          name: 'Soldier',
          type_line: typeLine,
          power: '1',
          toughness: '1',
          zone: 'battlefield',
          colors: ['W'],
          image_uris: imageUrls,
        },
      };
      
      state.battlefield.push(soldierToken as any);
      
      // Trigger ETB effects for each token (Cathars' Crusade, Soul Warden, Impact Tremors, etc.)
      triggerETBEffectsForToken(ctx, soldierToken, controller);
      
      debug(2, `[executeTriggerEffect] Created Soldier token ${i + 1}/${tokensToCreate}`);
    }
    
    return;
  }
  
  // ===== CALL THE COPPERCOATS =====
  // Pattern: "Create X 1/1 white Human Soldier creature tokens, where X is the number of creatures those opponents control"
  // Call the Coppercoats: "Strive — This spell costs {1}{W} more to cast for each target beyond the first.
  //                        Choose any number of target opponents. Create X 1/1 white Human Soldier creature tokens,
  //                        where X is the number of creatures those opponents control."
  if ((desc.includes('create') && desc.includes('human') && desc.includes('soldier') &&
       desc.includes('opponents control')) ||
      (sourceName.toLowerCase().includes('call the coppercoats'))) {
    const battlefield = state.battlefield || [];
    
    // Count creatures controlled by targeted opponents
    // If no specific targets, assume all opponents were targeted
    let targetedOpponents: string[] = [];
    if (triggerItem.targets && triggerItem.targets.length > 0) {
      // Filter to just player IDs (not permanent IDs)
      targetedOpponents = triggerItem.targets.filter((t: string) => !t.startsWith('perm_'));
    }
    
    // If no targets specified, count all opponents' creatures
    if (targetedOpponents.length === 0) {
      const players = state.players || [];
      targetedOpponents = players
        .map((p: any) => p.id)
        .filter((pid: string) => pid !== controller);
    }
    
    let opponentCreatureCount = 0;
    for (const perm of battlefield) {
      if (!perm) continue;
      if (!targetedOpponents.includes(perm.controller)) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (typeLine.includes('creature')) {
        opponentCreatureCount++;
      }
    }
    
    debug(2, `[executeTriggerEffect] ${sourceName}: Creating ${opponentCreatureCount} Human Soldier tokens for ${controller} (opponent creatures: ${opponentCreatureCount})`);
    
    // Apply token doublers (Anointed Procession, Doubling Season, etc.)
    const tokensToCreate = opponentCreatureCount * getTokenDoublerMultiplier(controller, state);
    
    // Create X 1/1 white Human Soldier tokens
    for (let i = 0; i < tokensToCreate; i++) {
      const tokenId = uid("token");
      const typeLine = 'Token Creature — Human Soldier';
      const imageUrls = getTokenImageUrls('Human Soldier', 1, 1, ['W']);
      
      const soldierToken = {
        id: tokenId,
        controller,
        owner: controller,
        tapped: false,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        summoningSickness: true,
        isToken: true,
        card: {
          id: tokenId,
          name: 'Human Soldier',
          type_line: typeLine,
          power: '1',
          toughness: '1',
          zone: 'battlefield',
          colors: ['W'],
          image_uris: imageUrls,
        },
      };
      
      state.battlefield.push(soldierToken as any);
      
      // Trigger ETB effects for each token (Cathars' Crusade, Soul Warden, Impact Tremors, etc.)
      triggerETBEffectsForToken(ctx, soldierToken, controller);
      
      debug(2, `[executeTriggerEffect] Created Human Soldier token ${i + 1}/${tokensToCreate}`);
    }
    
    return;
  }
  
  // ===== KEYWORD-BASED FALLBACK =====
  // Try to detect and process keyword abilities dynamically using the keyword detection system
  // This handles keywords like prowess, dethrone, evolve, extort, etc.
  const sourceCard = (triggerItem as any)?.card || {};
  const oracleText = sourceCard.oracle_text || description;
  const cardNameForKeyword = sourceCard.name || sourceName;
  
  const detectedKeywords = detectKeywords(oracleText, cardNameForKeyword);
  
  if (detectedKeywords.keywords.length > 0) {
    debug(2, `[executeTriggerEffect] Found ${detectedKeywords.keywords.length} keywords via dynamic detection for ${sourceName}`);
    
    // Determine trigger timing from triggerType
    const triggerType = (triggerItem as any).triggerType;
    let timing: 'attacks' | 'etb' | 'dies' | 'combat_damage' | 'cast' | 'noncreature_cast' = 'cast';
    
    if (triggerType === 'attacks' || triggerType === 'creature_attacks') {
      timing = 'attacks';
    } else if (triggerType === 'etb' || triggerType === 'etb_self') {
      timing = 'etb';
    } else if (triggerType === 'dies' || triggerType === 'death') {
      timing = 'dies';
    } else if (triggerType === 'combat_damage' || triggerType === 'deals_combat_damage') {
      timing = 'combat_damage';
    } else if (triggerType === 'cast' || triggerType === 'spell_cast') {
      timing = 'cast';
    }
    
    // Get the permanent from the battlefield
    const battlefield = state.battlefield || [];
    const sourceId = (triggerItem as any).source || (triggerItem as any).permanentId;
    const permanent = battlefield.find((p: any) => p.id === sourceId);
    
    if (permanent) {
      // Build trigger context
      const keywordCtx: KeywordTriggerContext = {
        gameId: (ctx as any).gameId || 'unknown',
        permanent,
        controller,
        state,
        battlefield,
        players: state.players || [],
        activePlayer: state.activePlayer || controller,
        defendingPlayer: (triggerItem as any).defendingPlayer,
        attackingCreatures: (triggerItem as any).attackingCreatures,
        spellCast: (triggerItem as any).spellCast,
      };
      
      // Process keywords for this timing
      const results = processKeywordTriggers(keywordCtx, timing);
      
      for (const result of results) {
        debug(2, `[executeTriggerEffect] Keyword ${result.keyword} processed: ${result.chatMessage || result.effect}`);
        
        // Apply counter modifications
        if (result.countersAdded) {
          applyKeywordCounters(permanent, result);
        }
        
        // Apply P/T modifications
        if (result.ptModification) {
          applyKeywordPTMod(permanent, result);
        }
        
        // Handle player choices (will be processed by socket layer)
        if (result.requiresPlayerChoice) {
          // Store pending choice for socket layer to handle
          state.pendingKeywordChoice = state.pendingKeywordChoice || [];
          state.pendingKeywordChoice.push({
            keyword: result.keyword,
            playerId: result.requiresPlayerChoice.playerId,
            permanentId: result.requiresPlayerChoice.permanentId,
            type: result.requiresPlayerChoice.type,
            options: result.requiresPlayerChoice.options,
            sourceName,
            sourceId,
          });
        }
      }
      
      if (results.length > 0) {
        return; // Keyword handlers processed the effect
      }
    }
  }
  
  // Log unhandled triggers for future implementation
  debug(2, `[executeTriggerEffect] Unhandled trigger effect: "${description}" from ${sourceName}`);
}

/* Resolve the top item - moves permanent spells to battlefield */
export function resolveTopOfStack(ctx: GameContext) {
  const item = popStackItem(ctx);
  if (!item) return;
  
  const { state, bumpSeq } = ctx;
  const card = item.card;
  const controller = item.controller as PlayerID;
  const targets = (item as any).targets || [];
  const spellXValue = (item as any).xValue;
  
  // For adventure cards, determine which face was cast
  // If castAsAdventure is false, we're casting the permanent side (face 0)
  // If castAsAdventure is true, we're casting the adventure side (face 1, which is sorcery/instant)
  // Only process adventure card logic if card exists (abilities and triggered abilities don't have card property)
  const castAsAdventure = (item as any).castAsAdventure;
  let effectiveTypeLine = card?.type_line;
  let effectiveCard = card; // Use this for all card property accesses
  
  // For adventure cards, use the properties of the specific face that was cast
  if (card && (card as any).layout === 'adventure' && Array.isArray((card as any).card_faces)) {
    const faces = (card as any).card_faces;
    let faceIndex = 0; // Default to permanent side
    
    if (castAsAdventure === true && faces[1]) {
      // Casting adventure side (face 1) - sorcery/instant
      faceIndex = 1;
    } else if (castAsAdventure === false && faces[0]) {
      // Casting permanent side (face 0) - creature/enchantment/artifact/etc.
      faceIndex = 0;
    }
    
    const face = faces[faceIndex];
    if (face) {
      effectiveTypeLine = face.type_line;
      // Create an effective card object that merges the main card with the face-specific properties
      effectiveCard = {
        ...card,
        type_line: face.type_line,
        oracle_text: face.oracle_text,
        mana_cost: face.mana_cost,
        power: face.power,
        toughness: face.toughness,
        loyalty: face.loyalty,
        // Keep the original name and image_uris from the main card for display
        // but override the name if we need face-specific name
        name: face.name || card.name,
      };
    }
  }
  
  // For transform DFCs (Ill-Tempered Loner, etc.), always use front face (face 0) properties when casting
  // The back face cannot be cast directly - it's only accessed via transformation
  if (card && ((card as any).layout === 'transform' || (card as any).layout === 'double_faced_token') && 
      Array.isArray((card as any).card_faces)) {
    const faces = (card as any).card_faces;
    const frontFace = faces[0];
    if (frontFace) {
      effectiveTypeLine = frontFace.type_line || effectiveTypeLine;
      // Create an effective card object that ensures front face P/T are used
      effectiveCard = {
        ...card,
        type_line: frontFace.type_line || card.type_line,
        oracle_text: frontFace.oracle_text || card.oracle_text,
        mana_cost: frontFace.mana_cost || card.mana_cost,
        power: frontFace.power || card.power,
        toughness: frontFace.toughness || card.toughness,
        loyalty: frontFace.loyalty || card.loyalty,
        name: frontFace.name || card.name,
      };
      debug(2, `[resolveTopOfStack] Transform DFC ${effectiveCard.name}: using front face P/T ${frontFace.power}/${frontFace.toughness}`);
    }
  }

  // Day/Night: some spells/abilities explicitly say "it becomes day/night".
  // Apply this even if we don't have a dedicated effect implementation yet.
  try {
    const resolvedText = `${String((item as any)?.description || '')}\n${String((effectiveCard as any)?.oracle_text || '')}`;
    applyExplicitDayNightChangeFromText(state as any, resolvedText);
  } catch {}
  
  // Handle activated abilities (like fetch lands)
  if ((item as any).type === 'ability') {
    const abilityType = (item as any).abilityType;
    const sourceName = (item as any).sourceName || 'Unknown';
    
    // Handle fetch land ability resolution
    if (abilityType === 'fetch-land') {
      debug(2, `[resolveTopOfStack] Resolving fetch land ability from ${sourceName} for ${controller}`);
      
      const searchParams = (item as any).searchParams || {};
      enqueueLibrarySearchStep(ctx, controller as PlayerID, {
        searchFor: searchParams.searchDescription || 'a land card',
        description: `${sourceName}: Search your library for ${searchParams.searchDescription || 'a land'}`,
        destination: 'battlefield',
        entersTapped: searchParams.entersTapped || false,
        optional: false,
        source: sourceName,
        shuffleAfter: true,
        filter: searchParams.filter || { types: ['land'] },
        maxSelections: searchParams.maxSelections || 1,
        minSelections: 1,
      });
      
      const searchDesc = searchParams.searchDescription || 'a land card';
      const maxSel = searchParams.maxSelections || 1;
      const tappedStatus = searchParams.entersTapped ? ' (enters tapped)' : '';
      const selectionText = maxSel > 1 ? ` (up to ${maxSel})` : '';
      
      debug(2, `[resolveTopOfStack] Fetch land ${sourceName}: ${controller} may search for ${searchDesc}${selectionText}${tappedStatus}`);
      bumpSeq();
      return;
    }
    
    // Handle cycling ability resolution
    // Rule 702.29: Cycling is an activated ability that functions only while the card is in hand
    // Effect: Draw a card
    if (abilityType === 'cycling') {
      debug(2, `[resolveTopOfStack] Resolving cycling ability from ${sourceName} for ${controller}`);

      // Turn-tracking for intervening-if templates like "if you cycled two or more cards this turn".
      // Only record positive evidence to avoid false negatives.
      try {
        const stateAny = state as any;
        const key = String(controller);
        stateAny.cycleCountThisTurn = stateAny.cycleCountThisTurn || {};
        stateAny.cycleCountThisTurn[key] = (stateAny.cycleCountThisTurn[key] ?? 0) + 1;
        stateAny.cardsCycledThisTurn = stateAny.cardsCycledThisTurn || {};
        stateAny.cardsCycledThisTurn[key] = stateAny.cycleCountThisTurn[key];
        stateAny.cycledCardsThisTurn = stateAny.cycledCardsThisTurn || {};
        stateAny.cycledCardsThisTurn[key] = stateAny.cycleCountThisTurn[key];
      } catch {
        // best-effort only
      }
      
      const zones = (state as any).zones?.[controller];
      if (!zones) {
        debug(2, `[resolveTopOfStack] Cycling: player ${controller} has no zones`);
        bumpSeq();
        return;
      }
      
      // Get player name for messages
      const players = state.players || [];
      const player = players.find((p: any) => p.id === controller);
      const playerName = player?.name || controller;
      
      // Draw a card from library
      const lib = zones.library || [];
      if (lib.length > 0) {
        const drawnCard = lib.shift();
        zones.hand = zones.hand || [];
        zones.hand.push({ ...drawnCard, zone: "hand" });
        zones.handCount = zones.hand.length;
        zones.libraryCount = lib.length;
        
        (ctx as any).io?.to((ctx as any).gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId: (ctx as any).gameId,
          from: "system",
          message: `${playerName} drew a card from cycling ${sourceName}.`,
          ts: Date.now(),
        });
        
        debug(2, `[resolveTopOfStack] Cycling ${sourceName}: ${controller} drew a card`);
      } else {
        (ctx as any).io?.to((ctx as any).gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId: (ctx as any).gameId,
          from: "system",
          message: `${playerName} cycled ${sourceName} but had no cards to draw.`,
          ts: Date.now(),
        });
        
        debug(2, `[resolveTopOfStack] Cycling ${sourceName}: ${controller} had no cards to draw`);
      }
      
      bumpSeq();
      return;
    }
    
    // Handle creature upgrade ability resolution (Figure of Destiny, Warden of the First Tree, etc.)
    // IMPORTANT: These are PERMANENT characteristic-changing effects, NOT temporary "until end of turn" effects!
    // The creature permanently becomes the new type/stats until it leaves the battlefield.
    // This enables the progression system where each upgrade builds on the previous one.
    if (abilityType === 'creature-upgrade') {
      debug(2, `[resolveTopOfStack] Resolving creature upgrade ability from ${sourceName} for ${controller}`);
      
      const source = (item as any).source;
      const upgradeData = (item as any).upgradeData || {};
      
      // Find the source permanent on the battlefield
      const battlefield = state.battlefield || [];
      const sourcePerm = battlefield.find((p: any) => p.id === source);
      
      if (!sourcePerm) {
        debug(2, `[resolveTopOfStack] Creature upgrade: source permanent ${source} no longer on battlefield`);
        bumpSeq();
        return;
      }
      
      const changes: string[] = [];
      
      // Apply new creature types - these PERMANENTLY replace the creature's types
      // (until the creature leaves the battlefield)
      if (upgradeData.newTypes && upgradeData.newTypes.length > 0) {
        (sourcePerm as any).upgradedCreatureTypes = [...upgradeData.newTypes];
        
        // Update the type line for display
        const typeLine = (sourcePerm as any).card?.type_line || 'Creature';
        const dashIndex = typeLine.indexOf('—');
        const mainTypes = dashIndex !== -1 ? typeLine.slice(0, dashIndex).trim() : typeLine.trim();
        (sourcePerm as any).card = (sourcePerm as any).card || {};
        (sourcePerm as any).card.type_line = `${mainTypes} — ${upgradeData.newTypes.join(' ')}`;
        
        changes.push(`became a ${upgradeData.newTypes.join(' ')}`);
      }
      
      // Apply new base power/toughness
      if (upgradeData.newPower !== undefined) {
        (sourcePerm as any).basePower = upgradeData.newPower;
        changes.push(`base power is now ${upgradeData.newPower}`);
      }
      if (upgradeData.newToughness !== undefined) {
        (sourcePerm as any).baseToughness = upgradeData.newToughness;
        changes.push(`base toughness is now ${upgradeData.newToughness}`);
      }
      
      // Add keywords
      if (upgradeData.keywords && upgradeData.keywords.length > 0) {
        (sourcePerm as any).grantedKeywords = (sourcePerm as any).grantedKeywords || [];
        for (const keyword of upgradeData.keywords) {
          if (!(sourcePerm as any).grantedKeywords.includes(keyword)) {
            (sourcePerm as any).grantedKeywords.push(keyword);
            changes.push(`gained ${keyword}`);
          }
        }
      }
      
      // Add counters
      if (upgradeData.counterCount && upgradeData.counterType) {
        (sourcePerm as any).counters = (sourcePerm as any).counters || {};
        (sourcePerm as any).counters[upgradeData.counterType] = 
          ((sourcePerm as any).counters[upgradeData.counterType] || 0) + upgradeData.counterCount;
        changes.push(`got ${upgradeData.counterCount} ${upgradeData.counterType} counter(s)`);
      }
      
      debug(1, `[resolveTopOfStack] Creature upgrade applied to ${sourceName}: ${changes.join(', ')}`);
      bumpSeq();
      return;
    }
    
    // Handle equip ability resolution
    // CRITICAL: Equipment attachments must go through the stack and can be responded to
    if (abilityType === 'equip') {
      debug(2, `[resolveTopOfStack] Resolving equip ability from ${sourceName} for ${controller}`);
      
      const equipParams = (item as any).equipParams || {};
      const { equipmentId, targetCreatureId, equipmentName, targetCreatureName } = equipParams;
      
      if (!equipmentId || !targetCreatureId) {
        debugWarn(2, `[resolveTopOfStack] Equip ability missing parameters`);
        bumpSeq();
        return;
      }
      
      // Find the equipment and target creature on the battlefield
      const battlefield = state.battlefield || [];
      const equipment = battlefield.find((p: any) => p.id === equipmentId);
      const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
      
      if (!equipment) {
        debug(2, `[resolveTopOfStack] Equipment ${equipmentName || equipmentId} no longer on battlefield`);
        bumpSeq();
        return;
      }
      
      if (!targetCreature) {
        debug(2, `[resolveTopOfStack] Target creature ${targetCreatureName || targetCreatureId} no longer on battlefield`);
        bumpSeq();
        return;
      }
      
      // Verify target is still a legal creature
      const targetTypeLine = (targetCreature.card?.type_line || "").toLowerCase();
      if (!targetTypeLine.includes("creature")) {
        debug(2, `[resolveTopOfStack] Target ${targetCreatureName || targetCreatureId} is no longer a creature`);
        bumpSeq();
        return;
      }
      
      // Remove equipment from previous target (if any)
      if (equipment.attachedTo) {
        const previousTarget = battlefield.find((p: any) => p?.id === equipment.attachedTo);
        if (previousTarget && previousTarget.attachedEquipment) {
          previousTarget.attachedEquipment = (previousTarget.attachedEquipment as string[]).filter(
            (id: string) => id !== equipmentId
          );
          // Remove equipped badge if no equipment remains
          if (previousTarget.attachedEquipment.length === 0) {
            previousTarget.isEquipped = false;
          }
        }
      }
      
      // Attach equipment to new target
      equipment.attachedTo = targetCreatureId;
      
      // Add equipment to creature's attachedEquipment array
      if (!targetCreature.attachedEquipment) {
        targetCreature.attachedEquipment = [];
      }
      if (!targetCreature.attachedEquipment.includes(equipmentId)) {
        targetCreature.attachedEquipment.push(equipmentId);
      }
      
      // Add equipped badge/marker
      targetCreature.isEquipped = true;
      
      debug(2, `[resolveTopOfStack] ${equipmentName || 'Equipment'} equipped to ${targetCreatureName || 'creature'}`);
      bumpSeq();
      return;
    }
    
    // Handle other activated abilities - execute their effects
    // Use the same effect execution logic as triggered abilities
    const description = (item as any).description || '';
    debug(2, `[resolveTopOfStack] Executing activated ability from ${sourceName} for ${controller}: ${description}`);
    
    // Execute the ability effect (handles life gain, draw, damage, etc.)
    executeTriggerEffect(ctx, controller, sourceName, description, item);
    
    bumpSeq();
    return;
  }
  
  // Handle triggered abilities
  if ((item as any).type === 'triggered_ability') {
    const sourceName = (item as any).sourceName || 'Unknown';
    const description = (item as any).description || '';
    const triggerController = (item as any).controller || controller;
    const triggerType = (item as any).triggerType;
    const sourceId = (item as any).id;
    
    debug(2, `[resolveTopOfStack] Triggered ability from ${sourceName} resolved: ${description}`);

    // Intervening-if triggers: the condition must be true at resolution.
    // If we can recognize the condition and it is now false, the trigger resolves with no effect.
    try {
      const desc = String(description || '').trim();

      // Prefer raw effect text when available; stack descriptions are sometimes decorated
      // (e.g., "Landfall - ...") and won't start with When/Whenever/At.
      const rawEffect = String((item as any).effect || '').trim();
      const maybeStripped = desc.startsWith('Landfall - ')
        ? desc.slice('Landfall - '.length).trim()
        : desc;

      let textForEval = rawEffect || maybeStripped;
      const hasTriggerPrefix = /^(?:when|whenever|at)\b/i.test(textForEval);
      if (!hasTriggerPrefix) {
        if (triggerType === 'deals_damage') {
          textForEval = `Whenever ~ deals damage to a player, ${textForEval}`;
        } else if (triggerType === 'deals_combat_damage') {
          textForEval = `Whenever ~ deals combat damage to a player, ${textForEval}`;
        } else if (triggerType === 'tap') {
          textForEval = `Whenever ~ becomes tapped, ${textForEval}`;
        } else if (triggerType === 'attacks' || triggerType === 'attack') {
          textForEval = `Whenever ~ attacks, ${textForEval}`;
        } else if (triggerType === 'blocks') {
          textForEval = `Whenever ~ blocks, ${textForEval}`;
        } else if (triggerType === 'upkeep') {
          textForEval = `At the beginning of upkeep, ${textForEval}`;
        } else if (triggerType === 'draw_step') {
          textForEval = `At the beginning of draw step, ${textForEval}`;
        } else if (triggerType === 'precombat_main') {
          textForEval = `At the beginning of your precombat main phase, ${textForEval}`;
        } else if (triggerType === 'begin_combat') {
          textForEval = `At the beginning of combat, ${textForEval}`;
        } else if (triggerType === 'end_combat') {
          textForEval = `At end of combat, ${textForEval}`;
        } else if (triggerType === 'end_step') {
          textForEval = `At the beginning of end step, ${textForEval}`;
        } else if (triggerType === 'landfall') {
          textForEval = `Whenever a land enters the battlefield under your control, ${textForEval}`;
        } else if (typeof triggerType === 'string' && triggerType.includes('etb')) {
          textForEval = `When ~ enters the battlefield, ${textForEval}`;
        }
      }

      const thatPlayerId = String(
        (item as any).defendingPlayer ||
        (item as any).targetPlayer ||
        (item as any).triggeringPlayer ||
        ''
      );

      const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
      const needsTheirTurnRef = /\btheir\s+turn\b/i.test(textForEval) || /\bthat player's\s+turn\b/i.test(textForEval);
      const needsManaAbilityRef = /\bmana ability\b/i.test(textForEval);
      const needsSingleTargetRef = /\bsingle\s+target\b/i.test(textForEval) || /\btargets?\s+only\s+a\s+single\b/i.test(textForEval);
      const needsCardTypeShareRef = /\bshares\s+a\s+card\s+type\s+with\s+the\s+exiled\s+card\b/i.test(textForEval);
      const needsDamageSourceRefs = /\bany\s+of\s+that\s+damage\s+was\s+dealt\s+by\s+a\s+warrior\b/i.test(textForEval);
      const activatedAbilityIsManaAbility = (item as any).activatedAbilityIsManaAbility;
      const triggeringStackItemId = (item as any).triggeringStackItemId;

      const damageSourcePermanentIds = Array.isArray((item as any).damageSourcePermanentIds)
        ? (item as any).damageSourcePermanentIds
        : undefined;
      const damageIncludedWarriorSource = (item as any).damageIncludedWarriorSource;
      const wantsDamageSourceRefs =
        needsDamageSourceRefs ||
        Array.isArray(damageSourcePermanentIds) ||
        typeof damageIncludedWarriorSource === 'boolean';

      const battlefield = (ctx as any).state?.battlefield || [];
      const sourcePerm = battlefield.find((p: any) => p?.id === (item as any).source);
      const refs = (needsThatPlayerRef || needsTheirTurnRef || needsManaAbilityRef || needsSingleTargetRef || needsCardTypeShareRef || wantsDamageSourceRefs)
        ? {
            ...(thatPlayerId && (needsThatPlayerRef || needsTheirTurnRef)
              ? {
                  thatPlayerId,
                  referencedPlayerId: thatPlayerId,
                  theirPlayerId: thatPlayerId,
                }
              : {}),
            ...(typeof activatedAbilityIsManaAbility === 'boolean'
              ? { activatedAbilityIsManaAbility: activatedAbilityIsManaAbility }
              : {}),
            ...((needsSingleTargetRef || needsCardTypeShareRef) && triggeringStackItemId
              ? { triggeringStackItemId: String(triggeringStackItemId) }
              : {}),
            ...(wantsDamageSourceRefs && Array.isArray(damageSourcePermanentIds)
              ? {
                  damageSourcePermanentIds,
                  damageSourceCreatureIds: damageSourcePermanentIds,
                  damageSourceIds: damageSourcePermanentIds,
                }
              : {}),
            ...(wantsDamageSourceRefs && typeof damageIncludedWarriorSource === 'boolean'
              ? { damageIncludedWarriorSource }
              : {}),
          }
        : undefined;
      const satisfied = isInterveningIfSatisfied(
        ctx as any,
        String(triggerController),
        textForEval,
        sourcePerm,
        refs as any
      );
      if (satisfied === false) {
        debug(2, `[resolveTopOfStack] Intervening-if no longer satisfied; skipping resolution for ${sourceName}: ${textForEval}`);
        bumpSeq();
        return;
      }
    } catch {
      // If evaluation fails, be conservative and continue.
    }
    
    // ========================================================================
    // BOUNCE LAND ETB TRIGGER: Add resolution step for player to select a land to return
    // This must happen BEFORE executing the trigger effect
    // Uses the resolution queue instead of legacy pendingBounceLandChoice
    // ========================================================================
    if (triggerType === 'etb_bounce_land') {
      const permanentId = (item as any).permanentId;
      const battlefield = state.battlefield || [];
      const bounceLandPerm = battlefield.find((p: any) => p.id === permanentId);
      
      if (bounceLandPerm) {
        // Find all lands the controller controls (INCLUDING the bounce land itself)
        // Per MTG rules, the bounce land can return itself to hand
        const availableLands = battlefield.filter((p: any) => {
          if (p.controller !== triggerController) return false;
          const typeLine = (p.card?.type_line || '').toLowerCase();
          return typeLine.includes('land');
        });
        
        if (availableLands.length > 0) {
          // Skip adding resolution steps during replay to prevent infinite loops
          const isReplaying = !!(ctx as any).isReplaying;
          if (isReplaying) {
            debug(2, `[resolveTopOfStack] Bounce land trigger: skipping resolution step during replay`);
            return;
          }
          
          // Add resolution step to the queue
          const gameId = (ctx as any).gameId || 'unknown';
          
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.BOUNCE_LAND_CHOICE,
            playerId: triggerController as PlayerID,
            description: `${sourceName}: Return a land you control to its owner's hand`,
            mandatory: true,
            sourceId: bounceLandPerm.id,
            sourceName: sourceName,
            sourceImage: bounceLandPerm.card?.image_uris?.small || bounceLandPerm.card?.image_uris?.normal,
            bounceLandId: bounceLandPerm.id,
            bounceLandName: sourceName,
            landsToChoose: availableLands.map((p: any) => ({
              permanentId: p.id,
              cardName: p.card?.name || 'Land',
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            })),
            stackItemId: item.id,
          });
          
          debug(2, `[resolveTopOfStack] Bounce land trigger: added resolution step for ${triggerController} to return a land`);
          
          // DON'T execute the trigger effect yet - wait for player choice
          // DON'T bump sequence here - it will be bumped after choice is made
          return;
        } else {
          debugWarn(2, `[resolveTopOfStack] Bounce land trigger: ${triggerController} has no lands to return (shouldn't happen)`);
        }
      } else {
        debugWarn(2, `[resolveTopOfStack] Bounce land trigger: permanent ${permanentId} not found on battlefield`);
      }
    }

    // ========================================================================
    // HIDEAWAY ETB TRIGGER: Look at top N cards, exile one face-down, put rest on bottom
    // Uses the resolution queue for player to select which card to hideaway
    // ========================================================================
    if (triggerType === 'hideaway_etb') {
      const permanentId = (item as any).permanentId;
      const hideawayCount = (item as any).hideawayCount || 4;
      const hideawayCondition = (item as any).hideawayCondition || 'unknown';
      const battlefield = state.battlefield || [];
      const hideawayPerm = battlefield.find((p: any) => p.id === permanentId);
      
      if (hideawayPerm) {
        // Skip adding resolution steps during replay
        const isReplaying = !!(ctx as any).isReplaying;
        if (isReplaying) {
          debug(2, `[resolveTopOfStack] Hideaway trigger: skipping resolution step during replay`);
          return;
        }
        
        // Get top N cards from library
        const lib = (ctx as any).libraries?.get(triggerController);
        if (!lib || lib.length === 0) {
          debugWarn(2, `[resolveTopOfStack] Hideaway: ${triggerController} has no library`);
          return;
        }
        
        const cardsToLookAt = Math.min(hideawayCount, lib.length);
        const topCards = lib.slice(0, cardsToLookAt);
        
        if (topCards.length === 0) {
          debugWarn(2, `[resolveTopOfStack] Hideaway: no cards to look at`);
          return;
        }
        
        // Add resolution step to the queue for player to choose which card to exile
        const gameId = (ctx as any).gameId || 'unknown';
        
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.HIDEAWAY_CHOICE,
          playerId: triggerController as PlayerID,
          description: `${sourceName}: Choose a card to exile face down (Hideaway)`,
          mandatory: true,
          sourceId: hideawayPerm.id,
          sourceName: sourceName,
          sourceImage: hideawayPerm.card?.image_uris?.small || hideawayPerm.card?.image_uris?.normal,
          hideawayCards: topCards.map((c: any) => ({
            cardId: c.id,
            cardName: c.name || 'Card',
            imageUrl: c.image_uris?.small || c.image_uris?.normal,
          })),
          hideawayCondition: hideawayCondition,
          permanentId: permanentId,
          stackItemId: item.id,
        } as any);
        
        debug(2, `[resolveTopOfStack] Hideaway trigger: added resolution step for ${triggerController} to choose from ${topCards.length} cards`);
        
        // DON'T execute the trigger effect yet - wait for player choice
        return;
      } else {
        debugWarn(2, `[resolveTopOfStack] Hideaway trigger: permanent ${permanentId} not found on battlefield`);
      }
    }

    // ========================================================================
    // BEGINNING OF COMBAT TARGETING TRIGGERS (e.g., Heidegger, Shinra Executive)
    // Handles triggers like "At the beginning of combat on your turn, target creature you control gets +X/+0"
    // ========================================================================
    if (triggerType === 'begin_combat') {
      const effectText = description || (item as any).effect || '';
      const lowerEffect = effectText.toLowerCase();
      
      // Check if this trigger targets a creature you control
      if (lowerEffect.includes('target creature you control') || 
          lowerEffect.includes('target creature')) {
        const gameId = (ctx as any).gameId || 'unknown';
        const isReplaying = !!(ctx as any).isReplaying;
        const battlefield = state.battlefield || [];
        
        if (!isReplaying) {
          // Get valid creature targets
          const validTargets = battlefield
            .filter((p: any) => {
              const tl = (p.card?.type_line || '').toLowerCase();
              const isCreature = tl.includes('creature');
              // Check if it must be controlled by the trigger controller
              const controlledOnly = lowerEffect.includes('you control');
              return isCreature && (!controlledOnly || p.controller === triggerController);
            })
            .map((p: any) => ({
              id: p.id,
              label: p.card?.name || 'Creature',
              description: p.card?.type_line,
              image: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
          
          if (validTargets.length > 0) {
            // Store the effect description for resolution
            const effectDescription = effectText;
            
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: triggerController as PlayerID,
              description: `${sourceName}: Choose target creature`,
              mandatory: true,
              sourceId,
              sourceName,
              validTargets,
              targetTypes: ['creature'],
              minTargets: 1,
              maxTargets: 1,
              action: 'begin_combat_target_buff',
              effectDescription, // Pass the effect text for resolution
            } as any);
            
            debug(2, `[resolveTopOfStack] Begin combat trigger ${sourceName} requires target creature selection`);
            return; // Wait for target selection
          }
        }
      }
    }

    // ========================================================================
    // MODAL TRIGGER: "Choose one" or "Choose X" triggers
    // These need to present the player with modal choices before executing
    // ========================================================================
    const requiresChoice = (item as any).requiresChoice;
    
    if (requiresChoice && triggerType === 'begin_combat') {
      // Handle "SOLDIER Military Program" and similar "choose one" beginning of combat triggers
      const oracleText = (item as any).effect || description || '';
      const lowerText = oracleText.toLowerCase();
      
      // Check if this is SOLDIER Military Program specifically
      const isSoldierProgram = sourceName.toLowerCase().includes('soldier military program');
      
      if (isSoldierProgram || lowerText.includes('choose one')) {
        // Skip adding resolution steps during replay
        const isReplaying = (ctx as any).isReplaying;
        if (isReplaying) {
          debug(2, `[resolveTopOfStack] Modal trigger: skipping resolution step during replay`);
          return;
        }
        
        const gameId = (ctx as any).gameId || 'unknown';
        const battlefield = state.battlefield || [];
        
        // For SOLDIER Military Program, check if player controls a commander
        let canChooseBoth = false;
        if (isSoldierProgram) {
          // Check if player controls a commander
          const commandZone = (state as any).commandZone?.[triggerController];
          const commanderIds = commandZone?.commanderIds || [];
          
          // Check if any commander is on the battlefield
          canChooseBoth = battlefield.some((p: any) => 
            p.controller === triggerController && commanderIds.includes(p.card?.id)
          );
          
          debug(2, `[resolveTopOfStack] SOLDIER Military Program: player ${canChooseBoth ? 'controls' : 'does not control'} a commander`);
        }
        
        // Create modal choice options
        const options: ChoiceOption[] = [];
        
        if (isSoldierProgram) {
          // SOLDIER Military Program specific options
          options.push({
            id: 'create_token',
            label: 'Create a 1/1 white Soldier creature token',
            description: 'Create a 1/1 white Soldier creature token.',
          });
          
          options.push({
            id: 'add_counters',
            label: 'Put a +1/+1 counter on each of up to two Soldiers',
            description: 'Put a +1/+1 counter on each of up to two Soldiers you control.',
          });
          
          if (canChooseBoth) {
            options.push({
              id: 'both',
              label: 'Choose both (you control a commander)',
              description: 'Create a 1/1 white Soldier creature token AND put a +1/+1 counter on each of up to two Soldiers you control.',
            });
          }
        } else {
          // Generic modal trigger - parse options from oracle text
          // This is a simplified parser - may need enhancement for complex cases
          const optionMatches = oracleText.match(/•\s*([^•]+)/g);
          if (optionMatches) {
            optionMatches.forEach((match, index) => {
              const optionText = match.replace(/^•\s*/, '').trim();
              options.push({
                id: `option_${index + 1}`,
                label: optionText,
                description: optionText,
              });
            });
          }
        }
        
        if (options.length > 0) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODAL_CHOICE,
            playerId: triggerController as PlayerID,
            description: `${sourceName}: ${canChooseBoth ? 'Choose one or both' : 'Choose one'}`,
            mandatory: true,
            sourceName: sourceName,
            sourceImage: (item as any).imageUrl,
            promptTitle: sourceName,
            promptDescription: oracleText,
            options: options,
            minSelections: 1,
            maxSelections: canChooseBoth ? 2 : 1,
            // Store trigger data for resolution handler
            triggerData: {
              triggerType,
              sourceName,
              sourceId,
              isSoldierProgram,
              canChooseBoth,
            },
          } as any);
          
          debug(2, `[resolveTopOfStack] Modal trigger ${sourceName}: added resolution step for ${triggerController} to choose from ${options.length} options`);
          
          // DON'T execute the trigger effect yet - wait for player choice
          return;
        }
      }
    }

    // Aura Shards style: "destroy target artifact or enchantment"
    if (sourceName.toLowerCase().includes('aura shards') ||
        description.toLowerCase().includes('destroy target artifact or enchantment')) {
      const battlefield = state.battlefield || [];
      const gameId = (ctx as any).gameId || 'unknown';
      const isReplaying = !!(ctx as any).isReplaying;
      if (!isReplaying) {
        const validTargets = battlefield
          .filter((p: any) => {
            const tl = (p.card?.type_line || '').toLowerCase();
            return tl.includes('artifact') || tl.includes('enchantment');
          })
          .map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Permanent',
            description: p.card?.type_line,
            image: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));
        if (validTargets.length > 0) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: triggerController as PlayerID,
            description: `${sourceName}: Destroy target artifact or enchantment`,
            mandatory: true,
            sourceId,
            sourceName,
            validTargets,
            targetTypes: ['artifact', 'enchantment'],
            minTargets: 1,
            maxTargets: 1,
            action: 'destroy_artifact_enchantment',
          } as any);
          return;
        }
      }
    }
    
    // Merrow Reejerey style: "tap or untap target permanent"
    if (description.toLowerCase().includes('tap or untap target permanent')) {
      const battlefield = state.battlefield || [];
      const gameId = (ctx as any).gameId || 'unknown';
      const isReplaying = !!(ctx as any).isReplaying;
      if (!isReplaying) {
        const validTargets = battlefield.map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Permanent',
          description: p.card?.type_line,
          image: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));
        if (validTargets.length > 0) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: triggerController as PlayerID,
            description: `${sourceName}: Tap or untap target permanent`,
            mandatory: true,
            sourceId,
            sourceName,
            validTargets,
            targetTypes: ['permanent'],
            minTargets: 1,
            maxTargets: 1,
            action: 'tap_or_untap_target',
          } as any);
          return;
        }
      }
    }
    
    // ========================================================================
    // ETB TRIGGERS WITH TARGETING: Add resolution step for target selection
    // Handles cards like Bojuka Bog ("exile target player's graveyard"), 
    // Ravenous Chupacabra ("destroy target creature"), etc.
    // ========================================================================
    const requiresTarget = (item as any).requiresTarget;
    const targetType = (item as any).targetType;
    
    if (requiresTarget && triggerType === 'etb') {
      const players = state.players || [];
      const gameId = (ctx as any).gameId || 'unknown';
      const isReplaying = !!(ctx as any).isReplaying;
      
      if (!isReplaying) {
        // Create appropriate resolution step based on target type
        if (targetType === 'player') {
          // Target player selection
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.PLAYER_CHOICE,
            playerId: triggerController as PlayerID,
            description: `${sourceName}: Choose target player`,
            mandatory: true,
            sourceName: sourceName,
            sourceImage: (item as any).sourceImage,
            // Store the trigger info so we can execute it after target selection
            triggerItem: item,
            etbTargetTrigger: true,
          });
          
          debug(2, `[resolveTopOfStack] ETB trigger with target: added resolution step for ${triggerController} to select target player`);
          
          // DON'T execute the trigger effect yet - wait for target selection
          return;
        } else if (targetType === 'creature' || targetType === 'permanent') {
          // Target permanent selection - would need to implement TARGET_SELECTION handler
          // For now, skip and execute without targeting
          debug(2, `[resolveTopOfStack] ETB trigger requires ${targetType} target - not yet implemented`);
        }
      }
    }
    
    // Execute the triggered ability effect based on description
    debug(2, `[resolveTopOfStack] Executing trigger effect: controller=${triggerController}, sourceName=${sourceName}, triggerType=${triggerType}`);
    executeTriggerEffect(ctx, triggerController, sourceName, description, item);
    
    bumpSeq();
    return;
  }
  
  if (effectiveCard && isPermanentTypeLine(effectiveTypeLine)) {
    // Permanent spell resolves - move to battlefield
    const tl = (effectiveTypeLine || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(tl);
    const isPlaneswalker = /\bplaneswalker\b/.test(tl);
    
    // Check if this was cast with morph (face-down)
    const wasCastWithMorph = (item as any).wasCastWithMorph || false;
    const morphCost = wasCastWithMorph ? (item as any).morphCost : undefined;
    
    let baseP: number | undefined;
    let baseT: number | undefined;
    
    if (wasCastWithMorph) {
      // Face-down creatures are always 2/2 colorless
      baseP = 2;
      baseT = 2;
    } else {
      baseP = isCreature ? parsePT((effectiveCard as any).power) : undefined;
      baseT = isCreature ? parsePT((effectiveCard as any).toughness) : undefined;
    }
    
    // Check if the creature has haste from any source (own text or battlefield effects)
    // Rule 702.10: Haste allows ignoring summoning sickness
    const battlefield = state.battlefield || [];
    const hasHaste = isCreature && creatureWillHaveHaste(effectiveCard, controller, battlefield);
    
    // Creatures have summoning sickness when they enter (unless they have haste)
    // Rule 302.6: A creature's activated ability with tap/untap symbol can't be
    // activated unless the creature has been under controller's control since 
    // their most recent turn began.
    const hasSummoningSickness = isCreature && !hasHaste;
    
    // Initialize counters - planeswalkers enter with loyalty counters equal to their printed loyalty
    const initialCounters: Record<string, number> = {};
    if (isPlaneswalker && effectiveCard.loyalty) {
      const startingLoyalty = typeof effectiveCard.loyalty === 'number' ? effectiveCard.loyalty : parseInt(effectiveCard.loyalty, 10);
      if (!isNaN(startingLoyalty)) {
        initialCounters.loyalty = startingLoyalty;
        debug(2, `[resolveTopOfStack] Planeswalker ${effectiveCard.name} enters with ${startingLoyalty} loyalty`);
      }
    }
    
    // Special handling for Jeska, Thrice Reborn and similar cards
    // "Jeska enters with a loyalty counter on her for each time you've cast a commander from the command zone this game."
    const oracleTextLower = ((effectiveCard.oracle_text || "")).toLowerCase();
    if (isPlaneswalker && (
      oracleTextLower.includes("enters with a loyalty counter") && 
      oracleTextLower.includes("for each time") && 
      oracleTextLower.includes("commander from the command zone")
    )) {
      // Count commander casts from tax
      // Per MTG rules, commander tax increases by {2} for each time the commander has been cast
      // from the command zone. Therefore, tax / 2 = number of times cast from command zone.
      const commandZone = (state as any).commandZone?.[controller];
      let totalCommanderCasts = 0;
      
      if (commandZone?.taxById) {
        // Sum up all commander casts: (tax / 2) for each commander in the command zone
        for (const [, tax] of Object.entries(commandZone.taxById)) {
          const taxNumber = typeof tax === 'number' ? tax : 0;
          // Commander tax = 2 * number_of_casts, so casts = tax / 2
          totalCommanderCasts += Math.floor(taxNumber / 2);
        }
      }
      
      // Add loyalty for each commander cast (including Jeska herself if she was just cast from command zone)
      if (totalCommanderCasts > 0) {
        initialCounters.loyalty = (initialCounters.loyalty || 0) + totalCommanderCasts;
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} (Jeska-style): enters with ${totalCommanderCasts} additional loyalty for commander casts`);
      }
    }
    
    // Check for "enters with counters" patterns (Zack Fair, modular creatures, sagas, etc.)
    const etbCounters = detectEntersWithCounters(effectiveCard);
    for (const [counterType, count] of Object.entries(etbCounters)) {
      initialCounters[counterType] = (initialCounters[counterType] || 0) + count;
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} enters with ${count} ${counterType} counter(s)`);
    }
    
    // Yuna, Grand Summoner: "When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it."
    if (isCreature && (state as any).yunaNextCreatureFlags?.[controller]) {
      initialCounters['+1/+1'] = (initialCounters['+1/+1'] || 0) + 2;
      debug(2, `[resolveTopOfStack] Yuna's Grand Summon: ${effectiveCard.name} enters with 2 additional +1/+1 counters`);
      // Clear the flag
      delete (state as any).yunaNextCreatureFlags[controller];
    }
    
    // Check if this creature should enter tapped due to effects like Authority of the Consuls, Blind Obedience, etc.
    let shouldEnterTapped = false;
    if (isCreature) {
      shouldEnterTapped = checkCreatureEntersTapped(state.battlefield || [], controller, effectiveCard);
    }
    
    state.battlefield = state.battlefield || [];
    const newPermId = uid("perm");
    
    // Apply counter modifiers (Doubling Season, Vorinclex, etc.) to ETB counters
    // Need to create a temporary permanent to apply modifiers
    const tempPerm = { id: newPermId, controller, counters: {} };
    state.battlefield.push(tempPerm as any);
    const modifiedCounters = applyCounterModifications(state, newPermId, initialCounters);
    state.battlefield.pop(); // Remove temp permanent
    
    const newPermanent: any = {
      id: newPermId,
      controller,
      owner: controller,
      tapped: shouldEnterTapped,
      counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : undefined,
      basePower: baseP,
      baseToughness: baseT,
      summoningSickness: hasSummoningSickness,
      card: wasCastWithMorph ? { 
        // Face-down card - show generic 2/2 colorless creature
        name: "Face-down Creature",
        type_line: "Creature",
        zone: "battlefield",
        power: "2",
        toughness: "2",
      } : { ...effectiveCard, zone: "battlefield" },
      // Preserve isCommander flag from stack item if it exists
      isCommander: (item as any).card?.isCommander || (effectiveCard as any).isCommander || false,
    };

    // Propagate relevant cast metadata from the stack item onto the permanent/card.
    // This enables ETB intervening-if clauses like "if {R} was spent to cast it".
    if ((item as any).manaColorsSpent && Array.isArray((item as any).manaColorsSpent) && !wasCastWithMorph) {
      (newPermanent as any).manaColorsSpent = (item as any).manaColorsSpent;
      (newPermanent.card as any).manaColorsSpent = (item as any).manaColorsSpent;
    }

    if (typeof (item as any).manaSpentTotal === 'number' && !Number.isNaN((item as any).manaSpentTotal) && !wasCastWithMorph) {
      (newPermanent as any).manaSpentTotal = (item as any).manaSpentTotal;
      (newPermanent.card as any).manaSpentTotal = (item as any).manaSpentTotal;
    }

    if ((item as any).manaSpentBreakdown && typeof (item as any).manaSpentBreakdown === 'object' && !wasCastWithMorph) {
      (newPermanent as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
      (newPermanent.card as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
    }

    // Alternate-cost id (e.g., surge/spectacle/madness/prowl) for intervening-if and other templates.
    if (typeof (item as any).alternateCostId === 'string' && (item as any).alternateCostId.length > 0 && !wasCastWithMorph) {
      (newPermanent as any).alternateCostId = (item as any).alternateCostId;
      (newPermanent.card as any).alternateCostId = (item as any).alternateCostId;
    }

    // Convoke-derived metadata: how many creatures contributed mana.
    if (typeof (item as any).manaFromCreaturesSpent === 'number' && !Number.isNaN((item as any).manaFromCreaturesSpent) && !wasCastWithMorph) {
      (newPermanent as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
      (newPermanent.card as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
    }
    if (Array.isArray((item as any).convokeTappedCreatures) && !wasCastWithMorph) {
      (newPermanent as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
      (newPermanent.card as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
    }

    // Track cast origin (best-effort) for intervening-if clauses like "if you cast it" / "if you cast it from your hand".
    // Only set these on permanents created from resolving a stack item.
    (newPermanent as any).enteredFromCast = true;
    (newPermanent.card as any).enteredFromCast = true;
    if (typeof (item as any).castFromHand === 'boolean') {
      (newPermanent as any).castFromHand = (item as any).castFromHand;
      (newPermanent.card as any).castFromHand = (item as any).castFromHand;
    }
    if (typeof (item as any).source === 'string' && (item as any).source.length > 0) {
      (newPermanent as any).castSourceZone = (item as any).source;
      (newPermanent.card as any).castSourceZone = (item as any).source;
    }
    
    // Store face-down information
    if (wasCastWithMorph) {
      newPermanent.isFaceDown = true;
      newPermanent.faceDownType = 'morph';
      newPermanent.faceUpCard = effectiveCard; // Store the actual card hidden
      newPermanent.morphCost = morphCost;
    }
    
    // Add loyalty metadata only for planeswalkers
    if (isPlaneswalker) {
      // Keep both for client display: loyalty = current counters, baseLoyalty = printed
      newPermanent.loyalty = modifiedCounters.loyalty ?? initialCounters.loyalty;
      newPermanent.baseLoyalty = initialCounters.loyalty ?? 0;
      debug(1, `[PLANESWALKER DEBUG] ${effectiveCard.name} entering battlefield:`, {
        loyalty: newPermanent.loyalty,
        baseLoyalty: newPermanent.baseLoyalty,
        counters: newPermanent.counters,
        hasOracleText: !!effectiveCard.oracle_text,
        oracleTextLength: effectiveCard.oracle_text?.length || 0,
      });
    }
    
    state.battlefield.push(newPermanent);
    
    // Handle aura and equipment attachments
    // Auras are enchantments with "Aura" subtype that target when cast
    // When they resolve, attach them to their target
    // IMPORTANT: This must be done AFTER pushing to battlefield so the permanent exists
    const isAura = tl.includes('enchantment') && tl.includes('aura');
    const isEquipment = tl.includes('equipment');
    if ((isAura || isEquipment) && targets && targets.length > 0) {
      const targetId = targets[0];
      const targetPerm = state.battlefield.find((p: any) => p?.id === targetId);
      
      if (targetPerm) {
        // Set attachedTo on the aura/equipment
        newPermanent.attachedTo = targetId;
        
        // Track attachment on the target permanent
        // Use attachedEquipment for equipment (existing pattern) and attachments for auras
        if (isEquipment) {
          (targetPerm as any).attachedEquipment = (targetPerm as any).attachedEquipment || [];
          (targetPerm as any).attachedEquipment.push(newPermId);
          debug(2, `[resolveTopOfStack] Equipment ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
        } else {
          // For auras, use the standard attachments field
          (targetPerm as any).attachments = (targetPerm as any).attachments || [];
          (targetPerm as any).attachments.push(newPermId);
          debug(2, `[resolveTopOfStack] Aura ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
        }
      } else {
        debugWarn(2, `[resolveTopOfStack] ${isAura ? 'Aura' : 'Equipment'} ${effectiveCard.name} target ${targetId} not found on battlefield`);
      }
    }
    
    // Build a readable status message for logging
    let statusNote = '';
    if (shouldEnterTapped) {
      statusNote = ' (enters tapped)';
    } else if (hasSummoningSickness) {
      statusNote = ' (summoning sickness)';
    } else if (hasHaste) {
      statusNote = ' (haste)';
    }
    debug(2, `[resolveTopOfStack] Permanent ${effectiveCard.name || 'unnamed'} entered battlefield under ${controller}${statusNote}`);
    
    // ========================================================================
    // ETB CHOICES: Color, Creature Type, and other "as it enters" effects
    // These happen during resolution (Rule 608.2f) and must complete before
    // the spell finishes resolving. They don't give priority, just pause
    // resolution until the player makes their choice.
    // ========================================================================
    const oracleText = (effectiveCard.oracle_text || '').toLowerCase();
    const gameId = (ctx as any).gameId || 'unknown';
    const isReplaying = !!(ctx as any).isReplaying;
    
    // Check for Color Choice ETB ("As ~ enters, choose a color")
    // Examples: Throne of Eldraine, Caged Sun, Gauntlet of Power
    const colorChoicePattern = /as .+? enters(?: the battlefield)?,?\s+(?:you may\s+)?choose a colou?r/i;
    if (colorChoicePattern.test(oracleText) && !isReplaying) {
      if (!newPermanent.chosenColor) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.COLOR_CHOICE,
          playerId: controller as PlayerID,
          description: `Choose a color for ${effectiveCard.name}`,
          mandatory: !oracleText.includes('you may'),
          sourceId: newPermId,
          sourceName: effectiveCard.name || 'Permanent',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          colors: ['white', 'blue', 'black', 'red', 'green'],
          permanentId: newPermId,
        });
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires color choice, added resolution step`);
      }
    }
    
    // Check for Creature Type Choice ETB ("As ~ enters, choose a creature type")
    // Examples: Cavern of Souls, Door of Destinies, Coat of Arms variants
    const creatureTypePattern = /as .+? enters(?: the battlefield)?,?\s+choose a creature type/i;
    if (creatureTypePattern.test(oracleText) && !isReplaying) {
      if (!newPermanent.chosenCreatureType) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.CREATURE_TYPE_CHOICE,
          playerId: controller as PlayerID,
          description: `Choose a creature type for ${effectiveCard.name}`,
          mandatory: true,
          sourceId: newPermId,
          sourceName: effectiveCard.name || 'Permanent',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          permanentId: newPermId,
        });
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires creature type choice, added resolution step`);
      }
    }
    
    // Check for Card Name Choice ETB ("As ~ enters, choose a card name")
    // Examples: Pithing Needle, Runed Halo, Nevermore, Meddling Mage
    const cardNamePattern = /as .+? enters(?: the battlefield)?,?\s+(?:you may\s+)?(?:name|choose) a (?:card|nonland card)(?: name)?/i;
    if (cardNamePattern.test(oracleText) && !isReplaying) {
      if (!newPermanent.chosenCardName) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.CARD_NAME_CHOICE,
          playerId: controller as PlayerID,
          description: `Choose a card name for ${effectiveCard.name}`,
          mandatory: !oracleText.includes('you may'),
          sourceId: newPermId,
          sourceName: effectiveCard.name || 'Permanent',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          permanentId: newPermId,
        });
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires card name choice, added resolution step`);
      }
    }
    
    // Check for Opponent/Player Choice ETB ("As ~ enters, choose an opponent" or "choose a player")
    // Examples: Xantcha, Sleeper Agent, Curses, Vow cycle
    const opponentPattern = /as .+? enters(?: the battlefield)?,?\s+choose (?:an opponent|a player)/i;
    if (opponentPattern.test(oracleText) && !isReplaying) {
      if (!newPermanent.chosenPlayer) {
        // Determine if it should be opponent only or any player
        const opponentOnly = oracleText.includes('choose an opponent');
        const allPlayers = state.players || [];
        const validPlayers = opponentOnly 
          ? allPlayers.filter((p: any) => p.id !== controller)
          : allPlayers;
        
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.PLAYER_CHOICE,
          playerId: controller as PlayerID,
          description: opponentOnly 
            ? `Choose an opponent for ${effectiveCard.name}`
            : `Choose a player for ${effectiveCard.name}`,
          mandatory: true,
          sourceId: newPermId,
          sourceName: effectiveCard.name || 'Permanent',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          permanentId: newPermId,
          players: validPlayers.map((p: any) => ({
            id: p.id,
            name: p.name || `Player ${p.seat}`,
          })),
          opponentOnly: opponentOnly,
        });
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires ${opponentOnly ? 'opponent' : 'player'} choice, added resolution step`);
      }
    }
    
    // Check for Generic Option Choice ETB (2-way or multi-way choices)
    // Examples: 
    // - "choose flying or first strike"
    // - "choose odd or even"
    // - "choose Khan or Dragon"
    // - "choose two abilities from among first strike, vigilance, and lifelink" (Greymond)
    // Pattern: "As ~ enters, choose X or Y" or "choose X, Y, or Z" or "choose N from among X, Y, and Z"
    const optionPattern = /as .+? enters(?: the battlefield)?,?\s+choose (.+?)(?:\.|$)/i;
    const optionMatch = oracleText.match(optionPattern);
    if (optionMatch && !isReplaying) {
      const choiceText = optionMatch[1];
      // Check if this is a simple "A or B" or "A, B, or C" pattern
      // Skip if it's already handled by specific patterns (color, creature type, card name, player)
      const isSpecificPattern = 
        /a colou?r/.test(choiceText) ||
        /a creature type/.test(choiceText) ||
        /a (?:card|nonland card)(?: name)?/.test(choiceText) ||
        /(?:an opponent|a player)/.test(choiceText);
      
      if (!isSpecificPattern && !newPermanent.chosenOption && !newPermanent.chosenOptions) {
        // Extract options from text
        let options: string[] = [];
        let minSelections = 1;
        let maxSelections = 1;
        
        // Check for "choose N from among X, Y, and Z" pattern (e.g., Greymond)
        const fromAmongMatch = choiceText.match(/^(?:(\w+)\s+)?(?:abilities?|options?|cards?)\s+from\s+among\s+(.+)$/i);
        if (fromAmongMatch) {
          // Parse the number (e.g., "two" -> 2)
          const numWord = fromAmongMatch[1]?.toLowerCase();
          const numMap: Record<string, number> = {
            'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
            'a': 1, 'an': 1,
          };
          const choiceCount = numWord ? (numMap[numWord] || parseInt(numWord, 10) || 1) : 1;
          minSelections = choiceCount;
          maxSelections = choiceCount;
          
          // Extract the list after "from among"
          const itemList = fromAmongMatch[2];
          // Split on commas and "and"
          const parts = itemList.split(/,\s+(?:and\s+)?|(?:,\s+)?and\s+/);
          options = parts.map(p => p.trim().replace(/^(a|an|the)\s+/i, '')).filter(p => p.length > 0);
          
          debug(2, `[resolveTopOfStack] Parsed "from among" pattern: choose ${choiceCount} from ${options.join(', ')}`);
        } else {
          // Try to parse "X or Y" pattern
          if (choiceText.includes(' or ')) {
            const parts = choiceText.split(/,?\s+or\s+/);
            options = parts.map(p => p.trim().replace(/^(a|an|the)\s+/i, ''));
          } else if (choiceText.includes(',')) {
            // Try "X, Y, Z" pattern
            options = choiceText.split(',').map(p => p.trim().replace(/^(a|an|the)\s+/i, ''));
          }
          
          // Check for "choose N" at the start
          const chooseNMatch = choiceText.match(/^(\w+)\s+/);
          if (chooseNMatch) {
            const numWord = chooseNMatch[1].toLowerCase();
            const numMap: Record<string, number> = {
              'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
            };
            if (numMap[numWord]) {
              minSelections = numMap[numWord];
              maxSelections = numMap[numWord];
            }
          }
        }
        
        // Only add step if we successfully parsed options
        if (options.length >= 2) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: controller as PlayerID,
            description: `Choose ${minSelections === maxSelections ? minSelections : `${minSelections}-${maxSelections}`} for ${effectiveCard.name}: ${options.join(', ')}`,
            mandatory: true,
            sourceId: newPermId,
            sourceName: effectiveCard.name || 'Permanent',
            sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
            permanentId: newPermId,
            options: options.map((opt, idx) => ({
              id: `option_${idx}`,
              label: opt.charAt(0).toUpperCase() + opt.slice(1),
              value: opt,
            })),
            minSelections: minSelections,
            maxSelections: maxSelections,
          });
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires option choice (${options.join('/')}, choose ${minSelections}), added resolution step`);
        }
      }
    }
    
    // Check for Devour X mechanic
    const devourMatch = oracleText.match(/devour\s+(\d+)/);
    if (devourMatch && isCreature) {
      const devourValue = parseInt(devourMatch[1], 10);
      const gameId = (ctx as any).gameId || 'unknown';
      
      // Get creatures the player controls (excluding the devouring creature itself)
      const availableCreatures = state.battlefield
        .filter((p: any) => 
          p.controller === controller && 
          p.id !== newPermId &&
          p.card?.type_line?.toLowerCase().includes('creature')
        )
        .map((p: any) => ({
          permanentId: p.id,
          cardName: p.card?.name || 'Creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));
      
      if (availableCreatures.length > 0) {
        // Skip adding resolution steps during replay to prevent infinite loops
        const isReplaying = !!(ctx as any).isReplaying;
        if (!isReplaying) {
          // Add resolution step for devour selection
          ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DEVOUR_SELECTION,
          playerId: controller as PlayerID,
          description: `Devour ${devourValue}: Choose any number of creatures to sacrifice`,
          mandatory: false, // Optional - can sacrifice 0
          sourceId: newPermId,
          sourceName: effectiveCard.name || 'Creature',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          devourValue: devourValue,
          creatureId: newPermId,
          creatureName: effectiveCard.name || 'Creature',
          availableCreatures: availableCreatures,
        });
        
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} has Devour ${devourValue}, created selection step with ${availableCreatures.length} available creatures`);
        } else {
          debug(2, `[resolveTopOfStack] Devour: skipping resolution step during replay`);
        }
      } else {
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} has Devour ${devourValue}, but no creatures to sacrifice`);
      }
    }
    
    // Check for ETB control change effects (Xantcha, Akroan Horse, Vislor Turlough)
    // These permanents enter under an opponent's control or may give control to an opponent
    try {
      const controlChangeEffects = detectControlChangeEffects(effectiveCard, newPermanent);
      const etbControlChangeEffects = controlChangeEffects.filter(e => e.isETB);
      
      if (etbControlChangeEffects.length > 0) {
        for (const effect of etbControlChangeEffects) {
          if (effect.type === 'enters_under_opponent_control') {
            // Card must enter under an opponent's control (Xantcha, etc.)
            // Flag the permanent for opponent selection
            (newPermanent as any).pendingControlChange = {
              type: 'enters_under_opponent_control',
              originalOwner: controller,
              goadsOnChange: effect.goadsOnChange || false,
              mustAttackEachCombat: mustAttackEachCombat(effectiveCard),
              cantAttackOwner: cantAttackOwner(effectiveCard),
            };
            debug(2, `[resolveTopOfStack] ${effectiveCard.name} has ETB control change - requires opponent selection`);
          } else if (effect.type === 'may_give_control_to_opponent') {
            // Optional: may give control to opponent (Vislor Turlough)
            (newPermanent as any).pendingControlChange = {
              type: 'may_give_opponent',
              originalOwner: controller,
              isOptional: true,
              goadsOnChange: effect.goadsOnChange || false,
            };
            debug(2, `[resolveTopOfStack] ${effectiveCard.name} has optional ETB control change`);
          } else if (effect.type === 'opponent_gains_control') {
            // Opponent gains control (Akroan Horse)
            (newPermanent as any).pendingControlChange = {
              type: 'opponent_gains',
              originalOwner: controller,
            };
            debug(2, `[resolveTopOfStack] ${effectiveCard.name} has ETB opponent gains control`);
          }
        }
      }
    } catch (err) {
      debugError(1, `[resolveTopOfStack] Error checking control change effects:`, err);
    }
    
    // Check for ETB triggers on this permanent and other permanents
    try {
      const allTriggers = getETBTriggersForPermanent(effectiveCard, newPermanent);
      
      // Filter out triggers that fire when OTHER permanents enter (not when self enters)
      // These trigger types should only fire for OTHER permanents, not the permanent itself:
      // - permanent_etb: "Whenever another creature/permanent enters" (Soul Warden, Altar of the Brood)
      // - creature_etb: "Whenever a creature enters under your control" (Cathars' Crusade)
      // - another_permanent_etb: "Whenever another permanent enters under your control"
      // 
      // Only include triggers that fire when THIS permanent enters:
      // - etb: "When ~ enters the battlefield" (self ETB)
      // - etb_modal_choice: "As ~ enters the battlefield, choose"
      // - job_select, living_weapon: equipment ETB effects
      // - etb_sacrifice_unless_pay: "When ~ enters, sacrifice unless you pay"
      const selfETBTriggerTypes = new Set([
        'etb',                      // Self ETB: "When ~ enters the battlefield"
        'etb_modal_choice',         // Modal ETB: "As ~ enters, choose"
        'job_select',               // Equipment: create Hero token and attach
        'living_weapon',            // Equipment: create Germ token and attach
        'etb_sacrifice_unless_pay', // ETB sacrifice unless pay
        'etb_bounce_land',          // Bounce lands: return a land to hand
        'etb_gain_life',            // Self ETB life gain
        'etb_draw',                 // Self ETB draw
        'etb_search',               // Self ETB search library
        'etb_create_token',         // Self ETB token creation
        'etb_counter',              // Self ETB counter placement
      ]);
      
      const etbTriggers = allTriggers.filter(trigger => {
        // Keep triggers that fire when THIS permanent enters
        if (selfETBTriggerTypes.has(trigger.triggerType)) {
          return true;
        }
        // Filter out triggers that fire when OTHER permanents enter
        // (these will be added from other permanents in the loop below)
        if (trigger.triggerType === 'permanent_etb' ||
            trigger.triggerType === 'creature_etb' ||
            trigger.triggerType === 'another_permanent_etb') {
          return false;
        }
        // Default: keep the trigger (unknown types treated as self-ETB)
        return true;
      });
      
      // Also check other permanents for "whenever a creature/permanent enters" triggers
      // Check if the entering permanent is a token
      const isToken = !!(newPermanent as any).isToken || !!(card as any).isToken;
      
      for (const perm of state.battlefield) {
        if (perm.id === newPermId) continue; // Skip the entering permanent
        const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
        for (const trigger of otherTriggers) {
          // Only add triggers that fire on other permanents entering
          if (trigger.triggerType === 'creature_etb' && isCreature) {
            // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
            if ((trigger as any).nontokenOnly && isToken) {
              continue; // Skip - this trigger only fires for nontoken creatures
            }
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'another_permanent_etb') {
            // "Whenever another permanent enters under your control" - Altar of the Brood, etc.
            // The trigger only fires for permanents that share the same controller as the trigger source
            const triggerController = perm.controller;
            if (triggerController !== controller) {
              continue; // Skip - this trigger only fires for YOUR permanents entering
            }
            // Check color restriction if any (e.g., "white or black creature")
            if ((trigger as any).colorRestriction) {
              if (!matchesColorRestriction((trigger as any).colorRestriction, (card as any).colors || [])) {
                continue; // Skip - entering creature doesn't match color restriction
              }
            }
            // Check if it's creature-only (e.g., "another creature you control enters")
            if ((trigger as any).creatureOnly && !isCreature) {
              continue; // Skip - this trigger only fires for creatures
            }
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'permanent_etb') {
            // Altar of the Brood style - triggers on ANY permanent entering (not just yours)
            // Check color restriction if any
            if ((trigger as any).colorRestriction) {
              if (!matchesColorRestriction((trigger as any).colorRestriction, (card as any).colors || [])) {
                continue; // Skip - entering creature doesn't match color restriction
              }
            }
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
            // Suture Priest, Authority of the Consuls style - triggers when OPPONENT's creature enters
            const triggerController = perm.controller;
            // Only fire if the entering creature is controlled by an opponent of the trigger controller
            if (triggerController && triggerController !== controller) {
              etbTriggers.push({ ...trigger, permanentId: perm.id, targetPlayer: controller } as any);
            }
          }
        }
      }
      
      if (etbTriggers.length > 0) {
        debug(2, `[resolveTopOfStack] Found ${etbTriggers.length} ETB trigger(s) for ${effectiveCard.name || 'permanent'}`);
        
        for (const trigger of etbTriggers) {
          // Handle Job Select and Living Weapon immediately (they don't go on stack - they're part of ETB)
          // These create tokens and attach the equipment as a single action
          if (trigger.triggerType === 'job_select' || trigger.triggerType === 'living_weapon') {
            const tokenInfo = (trigger as any).tokenInfo;
            if (tokenInfo) {
              // Create the token
              const tokenId = uid("token");
              const tokenCard = {
                id: `card_${tokenId}`,
                name: tokenInfo.name || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ'),
                type_line: `Token Creature — ${tokenInfo.subtypes?.join(' ') || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ')}`,
                colors: tokenInfo.colors || [],
                isToken: true,
              };
              
              const tokenPermanent = {
                id: tokenId,
                controller,
                owner: controller,
                tapped: false,
                counters: {},
                basePower: tokenInfo.power ?? (trigger.triggerType === 'job_select' ? 1 : 0),
                baseToughness: tokenInfo.toughness ?? (trigger.triggerType === 'job_select' ? 1 : 0),
                summoningSickness: true,
                isToken: true,
                card: { ...tokenCard, zone: 'battlefield' },
              } as any;
              
              state.battlefield.push(tokenPermanent);
              
              // Attach the equipment to the token (validate it's actually an equipment)
              const equipment = state.battlefield.find((p: any) => p.id === newPermId);
              const isEquipment = equipment && (equipment.card?.type_line || '').toLowerCase().includes('equipment');
              if (equipment && isEquipment) {
                (equipment as any).attachedTo = tokenId;
                (tokenPermanent as any).attachedEquipment = (tokenPermanent as any).attachedEquipment || [];
                (tokenPermanent as any).attachedEquipment.push(newPermId);
                
                debug(2, `[resolveTopOfStack] ${trigger.triggerType === 'job_select' ? 'Job Select' : 'Living Weapon'}: Created ${tokenCard.name} token and attached ${card.name}`);
              }
              
              // Trigger ETB effects for the token
              triggerETBEffectsForToken(ctx, tokenPermanent, controller);
            }
            continue; // Don't push to stack, already handled
          }
          
          // Push trigger onto the stack
          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          // Determine the controller of the triggered ability
          // For ETB triggers from other permanents (like Soul Warden), the controller
          // is the controller of the permanent with the trigger, NOT the entering creature
          let triggerController = controller;
          if (trigger.permanentId && trigger.permanentId !== newPermId) {
            const triggerSource = state.battlefield?.find((p: any) => p.id === trigger.permanentId);
            if (triggerSource?.controller) {
              triggerController = triggerSource.controller;
            }
          }

          // Intervening-if triggers: only trigger if condition is true both at trigger time and resolution.
          // Here we enforce the first half (trigger time). If we can recognize the condition and it's false,
          // we must not put the trigger on the stack.
          try {
            const raw = String((trigger as any)?.description || "").trim();
            let desc = raw;
            if (desc && !/^(?:when|whenever|at)\b/i.test(desc)) {
              if (trigger.triggerType === 'creature_etb') {
                desc = `Whenever a creature enters the battlefield, ${desc}`;
              } else if (trigger.triggerType === 'another_permanent_etb') {
                desc = `Whenever another permanent enters the battlefield under your control, ${desc}`;
              } else if (trigger.triggerType === 'permanent_etb') {
                desc = `Whenever a permanent enters the battlefield, ${desc}`;
              } else if (trigger.triggerType === 'opponent_creature_etb') {
                desc = `Whenever a creature enters the battlefield under an opponent's control, ${desc}`;
              } else {
                desc = `When ~ enters the battlefield, ${desc}`;
              }
            }
            const battlefield = (ctx as any).state?.battlefield || [];
            const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
            const enteringControllerId = String(controller || '').trim();
            const needsThatPlayerRef = /\bthat player\b/i.test(desc);
            const refs =
              trigger.triggerType === 'opponent_creature_etb' && enteringControllerId && needsThatPlayerRef
                ? {
                    thatPlayerId: enteringControllerId,
                    referencedPlayerId: enteringControllerId,
                    theirPlayerId: enteringControllerId,
                  }
                : undefined;
            const satisfied = isInterveningIfSatisfied(ctx as any, String(triggerController), desc, sourcePerm, refs);
            if (satisfied === false) {
              debug(2, `[resolveTopOfStack] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
              continue;
            }
          } catch {
            // If evaluation fails, be conservative and keep the trigger.
          }
          
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: trigger.permanentId,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
          } as any);
          
          debug(2, `[resolveTopOfStack] ⚡ ${trigger.cardName}'s triggered ability (controlled by ${triggerController}): ${trigger.description}`);
        }
      }
    } catch (err) {
      debugWarn(1, '[resolveTopOfStack] Failed to detect ETB triggers:', err);
    }
    
    // Handle Squad token creation (Rule 702.157)
    // Squad: "As an additional cost to cast this spell, you may pay {cost} any number of times. 
    // When this permanent enters the battlefield, create that many tokens that are copies of it."
    try {
      const squadTimesPaid = (card as any).squadTimesPaid;
      if (squadTimesPaid && squadTimesPaid > 0 && isCreature) {
        debug(2, `[resolveTopOfStack] Squad: Creating ${squadTimesPaid} token copies of ${effectiveCard.name || 'creature'}`);
        
        for (let i = 0; i < squadTimesPaid; i++) {
          const tokenId = uid("squad_token");
          const tokenCard = {
            id: `card_${tokenId}`,
            name: effectiveCard.name || 'Token',
            type_line: effectiveCard.type_line || 'Creature',
            oracle_text: effectiveCard.oracle_text || '',
            colors: (card as any).colors || [],
            power: effectiveCard.power,
            toughness: effectiveCard.toughness,
            image_uris: effectiveCard.image_uris,
            isToken: true,
          };
          
          const tokenPermanent = {
            id: tokenId,
            controller,
            owner: controller,
            tapped: false,
            counters: {},
            basePower: baseP,
            baseToughness: baseT,
            summoningSickness: true,
            isToken: true,
            card: { ...tokenCard, zone: 'battlefield' },
          } as any;
          
          state.battlefield.push(tokenPermanent);
          
          // Trigger ETB effects for each squad token
          triggerETBEffectsForToken(ctx, tokenPermanent, controller);
          
          debug(2, `[resolveTopOfStack] Squad: Created token copy #${i + 1} of ${effectiveCard.name}`);
        }
      }
    } catch (err) {
      debugWarn(1, '[resolveTopOfStack] Failed to create squad tokens:', err);
    }
    
    // Recalculate player effects when permanents ETB (for Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, '[resolveTopOfStack] Failed to recalculate player effects:', err);
    }
  } else if (effectiveCard) {
    // Non-permanent spell (instant/sorcery) - execute effects before moving to graveyard
    const oracleText = effectiveCard.oracle_text || '';
    const oracleTextLower = oracleText.toLowerCase();
    const spellSpec = categorizeSpell(effectiveCard.name || '', oracleText);
    const gameId = (ctx as any).gameId || 'unknown';
    const isReplaying = !!(ctx as any).isReplaying;
    
    // ========================================================================
    // COLOR CHOICE FOR INSTANTS/SORCERIES
    // Spells like "Brave the Elements", "Absolute Grace", etc. that say
    // "Choose a color." require player input before resolving their effects.
    // Pattern: "Choose a color" at the beginning of the oracle text
    // ========================================================================
    const spellColorChoicePattern = /^choose a colou?r\b/i;
    const hasColorChoiceSpell = spellColorChoicePattern.test(oracleTextLower.trim());
    
    // Check if spell already has a chosen color (from stack item)
    const stackItem = state.stack?.find((s: any) => s.id === card?.id);
    const existingChosenColor = (card as any)?.chosenColor || (stackItem as any)?.chosenColor;
    
    if (hasColorChoiceSpell && !existingChosenColor && !isReplaying) {
      // This spell needs a color choice before it can resolve
      // Add to resolution queue and return (spell stays on stack until color is chosen)
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} requires color choice, adding resolution step`);
      
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COLOR_CHOICE,
        playerId: controller as PlayerID,
        description: `Choose a color for ${effectiveCard.name}`,
        mandatory: true,
        sourceId: card?.id || effectiveCard.id,
        sourceName: effectiveCard.name || 'Spell',
        sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
        colors: ['white', 'blue', 'black', 'red', 'green'],
        spellId: card?.id, // Mark this as a spell color choice (not permanent ETB)
        oracleText: oracleText, // Include oracle text for effect application later
      });
      
      // Don't continue with resolution - wait for color choice
      // The spell stays on the stack and will be re-processed after color is chosen
      return;
    }
    
    // If spell has color choice and color is chosen, apply the effect
    if (hasColorChoiceSpell && existingChosenColor) {
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} resolving with chosen color: ${existingChosenColor}`);
      
      // Handle "Choose a color. [Creatures/permanents] you control gain protection from the chosen color until end of turn."
      // Pattern examples:
      // - Brave the Elements: "Choose a color. White creatures you control gain protection from the chosen color until end of turn."
      // - Akroma's Blessing: "Choose a color. Creatures you control gain protection from the chosen color until end of turn."
      // - Absolute Grace/Law variants
      const protectionPattern = /(?:(\w+)\s+)?creatures?\s+(?:you control\s+)?(?:gains?|have)\s+protection from the chosen colou?r\s+(?:until end of turn)?/i;
      const protectionMatch = oracleTextLower.match(protectionPattern);
      
      if (protectionMatch) {
        const restrictionColor = protectionMatch[1]?.toLowerCase(); // e.g., "white" for Brave the Elements
        
        // Apply protection from chosen color to creatures you control
        const battlefield = state.battlefield || [];
        let affectedCount = 0;
        
        for (const perm of battlefield) {
          if (!perm || perm.controller !== controller) continue;
          
          const permTypeLine = ((perm as any).card?.type_line || '').toLowerCase();
          if (!permTypeLine.includes('creature')) continue;
          
          // Check if creature matches the restriction (e.g., "white creatures")
          if (restrictionColor) {
            const permColors = ((perm as any).card?.colors || []) as string[];
            const colorMap: Record<string, string> = {
              white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G'
            };
            const requiredColorCode = colorMap[restrictionColor];
            if (!permColors.includes(requiredColorCode)) continue;
          }
          
          // Grant protection from chosen color until end of turn
          (perm as any).temporaryProtection = (perm as any).temporaryProtection || [];
          const protectionEntry = {
            from: existingChosenColor,
            untilEndOfTurn: true,
            source: effectiveCard.name,
            grantedBy: card?.id,
          };
          (perm as any).temporaryProtection.push(protectionEntry);
          
          // Also add to grantedAbilities for display
          (perm as any).grantedAbilities = (perm as any).grantedAbilities || [];
          (perm as any).grantedAbilities.push(`Protection from ${existingChosenColor} (until end of turn)`);
          
          affectedCount++;
        }
        
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} granted protection from ${existingChosenColor} to ${affectedCount} creature(s)`);
      }
    }
    
    // IMPORTANT: Capture target permanent info BEFORE destruction/exile for effects that need it
    // This MUST be done before any effects are executed as the target will be removed
    // - Beast Within, Rapid Hybridization, Pongify: "its controller creates" token effects
    // - Path to Exile: target's controller may search for basic land
    // - Swords to Plowshares: target's controller gains life equal to power
    // - Fateful Absence: target's controller investigates
    // - Get Lost: target's controller creates Map tokens
    let targetControllerForTokenCreation: PlayerID | null = null;
    let targetControllerForRemovalEffects: PlayerID | null = null;
    let targetPowerBeforeRemoval: number = 0;
    
    // Capture target info for removal spells that have "its controller" effects
    if (targets.length > 0 && targets[0] !== undefined) {
      const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
      const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);
      if (targetPerm) {
        // For token creation after destroy (Beast Within, etc.)
        if (oracleTextLower.includes('its controller creates')) {
          targetControllerForTokenCreation = targetPerm.controller as PlayerID;
          debug(2, `[resolveTopOfStack] Captured target controller ${targetControllerForTokenCreation} for token creation`);
        }
        
        // For effects that affect target's controller after exile/destroy
        // Path to Exile, Swords to Plowshares, Fateful Absence, Get Lost, Nature's Claim
        const isPathToExile = effectiveCard.name?.toLowerCase().includes('path to exile') || 
            (oracleTextLower.includes('exile target creature') && 
             oracleTextLower.includes('search') && 
             oracleTextLower.includes('basic land'));
        const isSwordsToPlowshares = effectiveCard.name?.toLowerCase().includes('swords to plowshares') || 
            (oracleTextLower.includes('exile target creature') && 
             oracleTextLower.includes('gains life equal to'));
        const isFatefulAbsence = effectiveCard.name?.toLowerCase().includes('fateful absence') ||
            (oracleTextLower.includes('destroy target creature') && 
             oracleTextLower.includes('investigates'));
        const isGetLost = effectiveCard.name?.toLowerCase().includes('get lost') ||
            (oracleTextLower.includes('destroy target creature') && 
             oracleTextLower.includes('map token'));
        const isNaturesClaimEffect = effectiveCard.name?.toLowerCase().includes("nature's claim") ||
            effectiveCard.name?.toLowerCase().includes("natures claim") ||
            ((oracleTextLower.includes('destroy target artifact') || oracleTextLower.includes('destroy target enchantment')) && 
             oracleTextLower.includes('its controller gains'));
             
        if (isPathToExile || isSwordsToPlowshares || isFatefulAbsence || isGetLost || isNaturesClaimEffect) {
          targetControllerForRemovalEffects = targetPerm.controller as PlayerID;
          
          // Capture power for Swords to Plowshares
          if (isSwordsToPlowshares) {
            if (typeof targetPerm.effectivePower === 'number') {
              targetPowerBeforeRemoval = targetPerm.effectivePower;
            } else if (typeof targetPerm.basePower === 'number') {
              targetPowerBeforeRemoval = targetPerm.basePower;
            } else if (targetPerm.card?.power) {
              const parsed = parseInt(String(targetPerm.card.power), 10);
              if (!isNaN(parsed)) {
                targetPowerBeforeRemoval = parsed;
              }
            }
            // Add +1/+1 and -1/-1 counter adjustments
            if (targetPerm.counters) {
              const plusCounters = targetPerm.counters['+1/+1'] || 0;
              const minusCounters = targetPerm.counters['-1/-1'] || 0;
              targetPowerBeforeRemoval += plusCounters - minusCounters;
            }
          }
          
          debug(2, `[resolveTopOfStack] Captured target controller ${targetControllerForRemovalEffects} for removal spell effects (power: ${targetPowerBeforeRemoval})`);
        }
      }
    }
    
    if (spellSpec) {
      // Convert targets array to TargetRef format if needed
      const targetRefs: TargetRef[] = targets.map((t: any) => {
        if (typeof t === 'string') {
          return { kind: 'permanent' as const, id: t };
        }
        return t;
      });
      
      // Generate effects based on spell type and targets.
      // For X spells, hydrate the amount at resolution time when X is known.
      let hydratedSpec: any = spellSpec;
      if ((hydratedSpec as any)?.amountIsX && typeof spellXValue === 'number') {
        hydratedSpec = { ...(hydratedSpec as any), amount: spellXValue };
      }
      if ((hydratedSpec as any)?.tokenCountIsX && typeof spellXValue === 'number') {
        hydratedSpec = { ...(hydratedSpec as any), tokenCount: spellXValue };
      }

      const effects = resolveSpell(hydratedSpec as any, targetRefs, state as any, controller as any);
      
      // Execute each effect
      for (const effect of effects) {
        executeSpellEffect(
          ctx,
          effect,
          controller,
          effectiveCard.name || 'spell',
          String((item as any).source || (item as any).permanentId || '')
        );
      }
      
      // Check for temporary land play effects (Summer Bloom, Explore, etc.)
      // These spells grant extra land plays for the current turn only
      const landBonus = detectSpellLandBonus(effectiveCard.name || '', oracleText);
      if (landBonus > 0) {
        applyTemporaryLandBonus(ctx, controller, landBonus);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name} granted ${controller} ${landBonus} additional land play(s) this turn`);
      }
      
      // Handle special spell effects not covered by the base system
      // Beast Within: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token."
      // Rapid Hybridization: "Destroy target creature. Its controller creates a 3/3 green Frog Lizard creature token."
      // Pongify: "Destroy target creature. Its controller creates a 3/3 green Ape creature token."
      if (targetControllerForTokenCreation) {
        // Check for token creation patterns
        // Pattern: "creates a X/Y [color] [type] creature token"
        const tokenMatch = oracleText.match(/creates?\s+(?:a\s+)?(\d+)\/(\d+)\s+(\w+)\s+(?:(\w+)\s+)?(?:(\w+)\s+)?creature\s+token/i);
        if (tokenMatch) {
          const power = parseInt(tokenMatch[1], 10);
          const toughness = parseInt(tokenMatch[2], 10);
          // Determine token type - the last non-null match before "creature token"
          const color = tokenMatch[3]?.toLowerCase() || 'green';
          const type1 = tokenMatch[4] || '';
          const type2 = tokenMatch[5] || '';
          const tokenType = type2 || type1 || 'Beast';
          const tokenName = `${tokenType} Token`;
          
          createBeastToken(ctx, targetControllerForTokenCreation, tokenName, power, toughness, color);
          debug(2, `[resolveTopOfStack] ${effectiveCard.name} created ${power}/${toughness} ${tokenName} for ${targetControllerForTokenCreation}`);
        }
      }
    }

    // Oracle IR fallback: if we couldn't categorize/resolve this spell, try best-effort
    // automation for a small, choice-free subset of effects.
    if (!spellSpec) {
      applyOracleIRFallbackForUncategorizedSpell(
        ctx,
        oracleText,
        controller as PlayerID,
        effectiveCard.name || 'spell',
        spellXValue,
        String((item as any).source || (item as any).permanentId || '')
        ,
        String((item as any).id || (card as any)?.id || '')
      );
    }
    
    // Handle Dispatch and similar metalcraft spells
    // Dispatch: "Tap target creature. Metalcraft — If you control three or more artifacts, exile that creature instead."
    const dispatchHandled = handleDispatch(ctx, card, controller, targets, state);
    
    // Handle Fractured Identity: "Exile target nonland permanent. Each player other than its controller creates a token that's a copy of it."
    // This requires special handling because we need to:
    // 1. Capture the target permanent's info before exiling
    // 2. Create token copies for each opponent of the target's controller
    const isFracturedIdentity = effectiveCard.name?.toLowerCase().includes('fractured identity') ||
        (oracleTextLower.includes('exile target') && 
         oracleTextLower.includes('each player other than its controller') && 
         oracleTextLower.includes('creates a token') && 
         oracleTextLower.includes('copy'));
    
    if (isFracturedIdentity && targets.length > 0) {
      const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
      const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);
      
      if (targetPerm && targetPerm.card) {
        const targetController = targetPerm.controller as PlayerID;
        const targetCard = targetPerm.card as any;
        const players = (state as any).players || [];
        
        // Get all players EXCEPT the target's controller
        const copyRecipients = players.filter((p: any) => p && p.id && p.id !== targetController);
        
        debug(2, `[resolveTopOfStack] Fractured Identity: Creating token copies for ${copyRecipients.length} players (excluding target controller ${targetController})`);
        
        // Create token copy for each player other than target's controller
        for (const recipient of copyRecipients) {
          try {
            // Use uid() for robust ID generation instead of Date.now() + Math.random()
            const tokenId = uid('fi_token');
            const typeLine = targetCard.type_line || '';
            const isCreature = typeLine.toLowerCase().includes('creature');
            
            const tokenPerm = {
              id: tokenId,
              controller: recipient.id as PlayerID,
              owner: recipient.id as PlayerID,
              tapped: false,
              counters: {},
              basePower: isCreature ? parseInt(String(targetCard.power || '0'), 10) : undefined,
              baseToughness: isCreature ? parseInt(String(targetCard.toughness || '0'), 10) : undefined,
              summoningSickness: isCreature,
              isToken: true,
              card: {
                id: tokenId,
                name: targetCard.name || 'Copy',
                type_line: typeLine,
                oracle_text: targetCard.oracle_text || '',
                mana_cost: targetCard.mana_cost || '',
                power: targetCard.power,
                toughness: targetCard.toughness,
                image_uris: targetCard.image_uris,
                zone: 'battlefield',
              },
            };
            
            state.battlefield = state.battlefield || [];
            state.battlefield.push(tokenPerm as any);
            
            debug(2, `[resolveTopOfStack] Fractured Identity: Created token copy of ${targetCard.name} for ${recipient.name || recipient.id}`);
          } catch (err) {
            debugWarn(1, `[resolveTopOfStack] Failed to create Fractured Identity token for ${recipient.id}:`, err);
          }
        }
        
        // Note: The exile effect is handled by the spellSpec resolution above (EXILE_TARGET)
      }
    }
    
    // Handle token creation spells (where the caster creates tokens)
    // Patterns: "create X 1/1 tokens", "create two 1/1 tokens", etc.
    const tokenCreationResult = parseTokenCreation(effectiveCard.name, oracleTextLower, controller, state, spellXValue);
    if (tokenCreationResult) {
      createTokenFromSpec(ctx, controller, tokenCreationResult);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} created ${tokenCreationResult.count} ${tokenCreationResult.name} token(s) for ${controller} (xValue: ${spellXValue ?? 'N/A'})`);
    }
    
    // Handle conditional board wipes based on X value
    // Pattern: "If X is N or more, destroy all other creatures" (Martial Coup, etc.)
    const conditionalWipeMatch = oracleTextLower.match(/if x is (\d+) or more,\s*(destroy all (?:other )?creatures)/i);
    if (conditionalWipeMatch && typeof spellXValue === 'number') {
      const threshold = parseInt(conditionalWipeMatch[1], 10);
      const destroyPattern = conditionalWipeMatch[2];
      
      if (spellXValue >= threshold) {
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: X=${spellXValue} >= ${threshold}, triggering: ${destroyPattern}`);
        
        // Destroy all other creatures (not tokens just created by this spell)
        const battlefield = state.battlefield || [];
        const creaturesBeforeSpell = battlefield.filter((perm: any) => {
          if (!perm) return false;
          const typeLine = (perm.card?.type_line || '').toLowerCase();
          return typeLine.includes('creature');
        });
        
        // "all other creatures" means not including the caster's tokens
        const destroyOther = destroyPattern.includes('other');
        for (const creature of creaturesBeforeSpell) {
          // If "other", skip tokens just created (they were created THIS resolution)
          // Check by comparing creation time or token flag with recent timestamp
          if (destroyOther && (creature as any).isToken) {
            // Skip newly created tokens - they don't have counters or damage yet
            const hasCounters = creature.counters && Object.keys(creature.counters).length > 0;
            const hasDamage = (creature as any).damage > 0;
            if (!hasCounters && !hasDamage) {
              continue; // Skip newly created tokens
            }
          }
          
          // Destroy the creature
          movePermanentToGraveyard(ctx, creature.id);
          debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Destroyed ${creature.card?.name || creature.id}`);
        }
      } else {
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: X=${spellXValue} < ${threshold}, no board wipe`);
      }
    }
    
    // Handle life gain from spells
    // Pattern: "You gain X life" or "You gain N life"
    const lifeGainMatch = oracleTextLower.match(/you gain (\d+|x) life/i);
    if (lifeGainMatch) {
      let lifeAmount = 0;
      if (lifeGainMatch[1] === 'x' && typeof spellXValue === 'number') {
        lifeAmount = spellXValue;
      } else if (/^\d+$/.test(lifeGainMatch[1])) {
        lifeAmount = parseInt(lifeGainMatch[1], 10);
      }
      
      if (lifeAmount > 0) {
        const currentLife = state.life?.[controller] ?? 40;
        state.life = state.life || {};
        state.life[controller] = currentLife + lifeAmount;
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} gained ${lifeAmount} life (${currentLife} -> ${state.life[controller]})`);
      }
    }
    
    // Handle mass bounce spells (Evacuation, Cyclonic Rift overloaded, Aetherize, etc.)
    // Multiple patterns to handle different mass bounce effects:
    // - "Return all creatures to their owners' hands" (Evacuation)
    // - "Return all attacking creatures to their owner's hand" (Aetherize)
    // - "Return all nonland permanents to their owners' hands" (Coastal Breach, Cyclonic Rift overloaded)
    // - "Return all noncreature, nonland permanents to their owners' hands" (Filter Out)
    // - "Return each nonland permanent you don't control to its owner's hand" (Cyclonic Rift overloaded)
    
    const massBouncePatterns = [
      { pattern: /return all creatures to their owners'? hands?/i, filter: 'creatures' },
      { pattern: /return all attacking creatures to their owners'? hands?/i, filter: 'attacking_creatures' },
      { pattern: /return all nonland permanents to their owners'? hands?/i, filter: 'nonland_permanents' },
      { pattern: /return all noncreature,?\s*nonland permanents to their owners'? hands?/i, filter: 'noncreature_nonland' },
      { pattern: /return each nonland permanent you don't control to its owner's hand/i, filter: 'nonland_opponent_control' },
    ];
    
    let massBounceFilter: string | null = null;
    for (const { pattern, filter } of massBouncePatterns) {
      if (pattern.test(oracleText)) {
        massBounceFilter = filter;
        break;
      }
    }
    
    if (massBounceFilter) {
      const battlefield = state.battlefield || [];
      const attackers = (state as any).attackers || [];
      const attackingCreatureIds = new Set(attackers.map((a: any) => a.creatureId || a.id));
      
      // Filter permanents based on the bounce type
      const permanentsToBounce = battlefield.filter((p: any) => {
        const typeLine = (p.card?.type_line || '').toLowerCase();
        const isCreature = typeLine.includes('creature');
        const isLand = typeLine.includes('land');
        const isAttacking = attackingCreatureIds.has(p.id);
        
        switch (massBounceFilter) {
          case 'creatures':
            return isCreature;
          case 'attacking_creatures':
            return isCreature && isAttacking;
          case 'nonland_permanents':
            return !isLand;
          case 'noncreature_nonland':
            return !isCreature && !isLand;
          case 'nonland_opponent_control':
            return !isLand && p.controller !== controller;
          default:
            return false;
        }
      });
      
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Returning ${permanentsToBounce.length} permanents to owners' hands (filter: ${massBounceFilter})`);
      
      // Helper function to bounce a single permanent
      const bouncePermanent = (perm: any) => {
        const ownerId = perm.owner || perm.controller;
        const zones = state.zones || {};
        const ownerZones = zones[ownerId];
        
        if (ownerZones) {
          // Token permanents cease to exist when they leave the battlefield
          if (perm.isToken) {
            debug(2, `[resolveTopOfStack] ${perm.card?.name || 'Token'} is a token - removed from game`);
            const idx = battlefield.findIndex((p: any) => p.id === perm.id);
            if (idx !== -1) battlefield.splice(idx, 1);
            return;
          }
          
          // Add card to owner's hand
          ownerZones.hand = ownerZones.hand || [];
          (ownerZones.hand as any[]).push({ ...perm.card, zone: 'hand' });
          ownerZones.handCount = ownerZones.hand.length;
          
          debug(2, `[resolveTopOfStack] ${perm.card?.name || 'Permanent'} returned to ${ownerId}'s hand`);
        }
        
        // Handle attached permanents (auras, equipment) - they fall off
        // Auras attached to this permanent go to graveyard
        const attachedAuras = battlefield.filter((p: any) => 
          p.attachedTo === perm.id && (p.card?.type_line || '').toLowerCase().includes('aura')
        );
        for (const aura of attachedAuras) {
          const auraOwnerId = aura.owner || aura.controller;
          const auraOwnerZones = zones[auraOwnerId];
          if (auraOwnerZones) {
            // Token auras cease to exist
            if (aura.isToken) {
              debug(2, `[resolveTopOfStack] ${aura.card?.name || 'Aura Token'} is a token - removed from game`);
            } else {
              auraOwnerZones.graveyard = auraOwnerZones.graveyard || [];
              (auraOwnerZones.graveyard as any[]).push({ ...aura.card, zone: 'graveyard' });
              auraOwnerZones.graveyardCount = auraOwnerZones.graveyard.length;
              debug(2, `[resolveTopOfStack] ${aura.card?.name || 'Aura'} fell off and went to graveyard`);
            }
          }
          const auraIdx = battlefield.findIndex((p: any) => p.id === aura.id);
          if (auraIdx !== -1) battlefield.splice(auraIdx, 1);
        }
        
        // Equipment detaches but stays on battlefield
        const attachedEquipment = battlefield.filter((p: any) => 
          p.attachedTo === perm.id && (p.card?.type_line || '').toLowerCase().includes('equipment')
        );
        for (const equipment of attachedEquipment) {
          delete equipment.attachedTo;
          debug(2, `[resolveTopOfStack] ${equipment.card?.name || 'Equipment'} detached`);
        }
        
        // Remove permanent from battlefield
        const idx = battlefield.findIndex((p: any) => p.id === perm.id);
        if (idx !== -1) battlefield.splice(idx, 1);
      };
      
      // Bounce all matching permanents
      // Make a copy of the array since we'll be modifying the battlefield
      const permanentsToBounceIds = permanentsToBounce.map((p: any) => p.id);
      for (const permId of permanentsToBounceIds) {
        const perm = battlefield.find((p: any) => p.id === permId);
        if (perm) {
          bouncePermanent(perm);
        }
      }
    }
    
    // Handle extra turn spells (Time Warp, Time Walk, Temporal Mastery, etc.)
    if (isExtraTurnSpell(effectiveCard.name, oracleTextLower)) {
      // Determine who gets the extra turn
      // Most extra turn spells give the caster an extra turn
      // "Target player takes an extra turn" would need target handling
      let extraTurnPlayer = controller;
      
      // Check for "target player takes an extra turn" pattern
      if (oracleTextLower.includes('target player') && oracleTextLower.includes('extra turn')) {
        // Use target if provided
        if (targets.length > 0 && targets[0]?.kind === 'player') {
          extraTurnPlayer = targets[0].id as PlayerID;
        }
      }
      
      addExtraTurn(ctx, extraTurnPlayer, effectiveCard.name || 'Extra turn spell');
      debug(2, `[resolveTopOfStack] Extra turn granted to ${extraTurnPlayer} by ${effectiveCard.name}`);
    }
    
    // Handle "each player draws" spells (Vision Skeins, Prosperity, Howling Mine effects, etc.)
    const eachPlayerDrawsMatch = oracleTextLower.match(/each player draws?\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
    if (eachPlayerDrawsMatch) {
      const drawCountStr = eachPlayerDrawsMatch[1].toLowerCase();
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
      };
      const drawCount = wordToNumber[drawCountStr] || parseInt(drawCountStr, 10) || 1;
      
      // Draw cards for each player
      const players = (state as any).players || [];
      for (const player of players) {
        if (player && player.id) {
          try {
            const drawn = drawCardsFromZone(ctx, player.id as PlayerID, drawCount);
            debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s)`);
          } catch (err) {
            debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
          }
        }
      }
    }
    
    // Handle "You draw X. Each other player draws Y" patterns (Words of Wisdom style)
    // Words of Wisdom: "You draw two cards. Each other player draws a card."
    const youDrawMatch = oracleTextLower.match(/you draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
    const eachOtherDrawMatch = oracleTextLower.match(/each other player draws?\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
    
    if (youDrawMatch && !eachPlayerDrawsMatch) {
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
      };
      const controllerDrawCount = wordToNumber[youDrawMatch[1].toLowerCase()] || parseInt(youDrawMatch[1], 10) || 1;
      
      try {
        const drawn = drawCardsFromZone(ctx, controller, controllerDrawCount);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Controller ${controller} drew ${drawn.length} card(s)`);
      } catch (err) {
        debugWarn(1, `[resolveTopOfStack] Failed to draw cards for controller ${controller}:`, err);
      }
      
      // Handle "each other player draws" if present
      if (eachOtherDrawMatch) {
        const otherDrawCount = wordToNumber[eachOtherDrawMatch[1].toLowerCase()] || parseInt(eachOtherDrawMatch[1], 10) || 1;
        const players = (state as any).players || [];
        for (const player of players) {
          if (player && player.id && player.id !== controller) {
            try {
              const drawn = drawCardsFromZone(ctx, player.id as PlayerID, otherDrawCount);
              debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s)`);
            } catch (err) {
              debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
            }
          }
        }
      }
    }
    
    // Handle Windfall-style effects: "Each player discards their hand, then draws cards equal to..."
    if (oracleTextLower.includes('each player discards') && oracleTextLower.includes('hand') && 
        (oracleTextLower.includes('then draws') || oracleTextLower.includes('draws cards equal'))) {
      const players = (state as any).players || [];
      const zones = state.zones || {};
      let greatestDiscarded = 0;
      
      // First pass: discard all hands and track the greatest number discarded
      for (const player of players) {
        if (player && player.id) {
          const playerZones = zones[player.id];
          if (playerZones && Array.isArray(playerZones.hand)) {
            const handSize = playerZones.hand.length;
            greatestDiscarded = Math.max(greatestDiscarded, handSize);
            
            // Move hand to graveyard
            playerZones.graveyard = playerZones.graveyard || [];
            for (const handCard of playerZones.hand) {
              if (handCard && typeof handCard === 'object') {
                (playerZones.graveyard as any[]).push({ ...handCard, zone: 'graveyard' });
              }
            }
            playerZones.hand = [];
            playerZones.handCount = 0;
            playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
            
            debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} discarded ${handSize} card(s)`);
          }
        }
      }
      
      // Second pass: each player draws cards equal to the greatest number discarded
      for (const player of players) {
        if (player && player.id && greatestDiscarded > 0) {
          try {
            const drawn = drawCardsFromZone(ctx, player.id as PlayerID, greatestDiscarded);
            debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s) (greatest discarded: ${greatestDiscarded})`);
          } catch (err) {
            debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
          }
        }
      }
    }
    
    // Handle "draw X, then discard Y" spells (Faithless Looting, Cathartic Reunion, Tormenting Voice, etc.)
    // Pattern: "Draw two cards, then discard two cards" or "Draw two cards. Then discard two cards."
    const drawThenDiscardMatch = oracleTextLower.match(/draw\s+(\d+|a|an|one|two|three|four|five)\s+cards?(?:\.|,)?\s*(?:then\s+)?discard\s+(\d+|a|an|one|two|three|four|five)\s+cards?/i);
    if (drawThenDiscardMatch && !oracleTextLower.includes('each player')) {
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
      };
      const drawCount = wordToNumber[drawThenDiscardMatch[1].toLowerCase()] || parseInt(drawThenDiscardMatch[1], 10) || 1;
      const discardCount = wordToNumber[drawThenDiscardMatch[2].toLowerCase()] || parseInt(drawThenDiscardMatch[2], 10) || 1;
      
      try {
        // Draw first
        const drawn = drawCardsFromZone(ctx, controller, drawCount);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s)`);
        
        // Set up pending discard - the socket layer will prompt for discard selection
        (state as any).pendingDiscard = (state as any).pendingDiscard || {};
        (state as any).pendingDiscard[controller] = {
          count: discardCount,
          source: effectiveCard.name || 'Spell',
          reason: 'spell_effect',
        };
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} must discard ${discardCount} card(s)`);
      } catch (err) {
        debugWarn(1, `[resolveTopOfStack] Failed to process draw/discard for ${controller}:`, err);
      }
    }
    
    // Handle "draw cards and create treasure" spells (Seize the Spoils, Unexpected Windfall, etc.)
    // Pattern: "Draw two cards and create a Treasure token"
    const drawAndTreasureMatch = oracleTextLower.match(/draw\s+(\d+|a|an|one|two|three|four|five)\s+cards?.*(?:create|creates?)\s+(?:a|an|one|two|three|\d+)?\s*treasure\s+tokens?/i);
    debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Checking draw+treasure pattern. Match: ${!!drawAndTreasureMatch}, drawThenDiscardMatch: ${!!drawThenDiscardMatch}, eachPlayer: ${oracleTextLower.includes('each player')}`);
    if (drawAndTreasureMatch && !oracleTextLower.includes('each player') && !drawThenDiscardMatch) {
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
      };
      const drawCount = wordToNumber[drawAndTreasureMatch[1].toLowerCase()] || parseInt(drawAndTreasureMatch[1], 10) || 1;
      
      // Check how many treasures to create
      const treasureCountMatch = oracleTextLower.match(/create\s+(?:a|an|(\d+)|one|two|three)\s*treasure\s+tokens?/i);
      const treasureCount = treasureCountMatch && treasureCountMatch[1] ? 
        parseInt(treasureCountMatch[1], 10) : 1;
      
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Executing draw ${drawCount} + create ${treasureCount} treasure(s)`);
      try {
        const drawn = drawCardsFromZone(ctx, controller, drawCount);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s)`);
        
        // Create treasure tokens
        for (let i = 0; i < treasureCount; i++) {
          createTreasureToken(ctx, controller);
        }
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} created ${treasureCount} Treasure token(s)`);
      } catch (err) {
        debugWarn(1, `[resolveTopOfStack] Failed to process draw/treasure for ${controller}:`, err);
      }
    }
    
    // Handle simple "Draw X cards" spells (Harmonize, Concentrate, Jace's Ingenuity, etc.)
    // Pattern: "Draw three cards." or "Draw four cards." 
    // This is the imperative form without "you" and catches cards like Harmonize
    // Must NOT match other patterns we've already handled
    if (!eachPlayerDrawsMatch && !youDrawMatch && !drawThenDiscardMatch && !drawAndTreasureMatch) {
      // First try exact match for simple draw spells (e.g., "Draw three cards.")
      // Then try to find "draw X cards" anywhere in the text if it's the main effect
      const simpleDrawMatch = oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\.?$/i) ||
                              oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\s*$/i);
      
      // Also handle cards where "Draw X cards" is at the start but may have a period
      const altDrawMatch = !simpleDrawMatch && oracleTextLower.startsWith('draw ') ?
        oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i) : null;
      
      const matchToUse = simpleDrawMatch || altDrawMatch;
      
      if (matchToUse) {
        const wordToNumber: Record<string, number> = { 
          'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
          'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
        };
        const drawCount = wordToNumber[matchToUse[1].toLowerCase()] || parseInt(matchToUse[1], 10) || 1;
        
        try {
          const drawn = drawCardsFromZone(ctx, controller, drawCount);
          debug(2, `[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s) (simple draw spell)`);
        } catch (err) {
          debugWarn(1, `[resolveTopOfStack] Failed to draw cards for ${controller}:`, err);
        }
      }
    }
    
    // ===== DYNAMIC TOKEN CREATION: "Create X tokens for each creature you control" pattern =====
    // This dynamically handles cards like Nomads' Assembly, Increasing Devotion (second cast), etc.
    // Pattern: "Create a/X [type] token(s) for each creature you control"
    // Examples:
    //   - Nomads' Assembly: "Create a 1/1 white Kor Soldier creature token for each creature you control."
    //   - March of the Multitudes (convoke part): "Create X 1/1 white Soldier creature tokens with lifelink."
    const tokenForEachCreaturePattern = /create\s+(?:a|an|(\d+))\s+(\d+)\/(\d+)\s+(\w+)(?:\s+(\w+))?\s+(?:(\w+)\s+)?creature\s+tokens?\s+(?:with\s+[\w\s]+\s+)?for\s+each\s+creature\s+you\s+control/i;
    const tokenForEachMatch = oracleTextLower.match(tokenForEachCreaturePattern);
    
    if (tokenForEachMatch) {
      const battlefield = state.battlefield || [];
      
      // Count creatures controlled by the caster
      let creatureCount = 0;
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        if (typeLine.includes('creature')) {
          creatureCount++;
        }
      }
      
      // Parse token stats from the match
      const tokenQuantity = tokenForEachMatch[1] ? parseInt(tokenForEachMatch[1], 10) : 1;
      const tokenPower = parseInt(tokenForEachMatch[2], 10);
      const tokenToughness = parseInt(tokenForEachMatch[3], 10);
      const tokenColor = tokenForEachMatch[4]?.toLowerCase() || 'white';
      const tokenSubtype1 = tokenForEachMatch[5] || '';
      const tokenSubtype2 = tokenForEachMatch[6] || '';
      const tokenType = tokenSubtype2 || tokenSubtype1 || 'Soldier';
      
      // Map color name to color code
      const colorNameToCode: Record<string, string> = {
        'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G', 'colorless': ''
      };
      const colorCode = colorNameToCode[tokenColor] || 'W';
      const colors = colorCode ? [colorCode] : [];
      
      const tokensPerCreature = tokenQuantity;
      const totalBaseTokens = creatureCount * tokensPerCreature;
      
      // Apply token doublers
      const totalTokens = totalBaseTokens * getTokenDoublerMultiplier(controller, state);
      
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Creating ${totalTokens} ${tokenPower}/${tokenToughness} ${tokenColor} ${tokenType} tokens for ${controller} (${creatureCount} creatures × ${tokensPerCreature} tokens × doublers)`);
      
      // Create tokens
      for (let i = 0; i < totalTokens; i++) {
        const tokenId = uid("token");
        const typeLine = `Token Creature — ${tokenType}`;
        const imageUrls = getTokenImageUrls(tokenType, tokenPower, tokenToughness, colors);
        
        const token = {
          id: tokenId,
          controller,
          owner: controller,
          tapped: false,
          counters: {},
          basePower: tokenPower,
          baseToughness: tokenToughness,
          summoningSickness: true,
          isToken: true,
          card: {
            id: tokenId,
            name: tokenType,
            type_line: typeLine,
            power: String(tokenPower),
            toughness: String(tokenToughness),
            zone: 'battlefield',
            colors,
            image_uris: imageUrls,
          },
        };
        
        state.battlefield.push(token as any);
        
        // Trigger ETB effects for each token (Cathars' Crusade, Soul Warden, Impact Tremors, etc.)
        triggerETBEffectsForToken(ctx, token, controller);
      }
      
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Created ${totalTokens} ${tokenType} tokens for ${controller}`);
    }
    
    // Handle tutor spells (Demonic Tutor, Vampiric Tutor, Diabolic Tutor, Kodama's Reach, Cultivate, etc.)
    // These need to trigger a library search prompt for the player
    const tutorInfo = detectTutorSpell(oracleText);
    if (tutorInfo.isTutor) {
      const isVampiric = (effectiveCard.name || '').toLowerCase().trim() === 'vampiric tutor';
      enqueueLibrarySearchStep(ctx, controller as PlayerID, {
        searchFor: tutorInfo.searchCriteria || 'a card',
        description: `${effectiveCard.name}: Search your library for ${tutorInfo.searchCriteria || 'a card'}`,
        destination: tutorInfo.destination || 'hand',
        entersTapped: tutorInfo.entersTapped ?? (tutorInfo.destination === 'battlefield'),
        optional: tutorInfo.optional || false,
        source: effectiveCard.name || 'Tutor',
        shuffleAfter: true,
        maxSelections: tutorInfo.maxSelections || 1,
        minSelections: tutorInfo.optional ? 0 : 1,
        splitDestination: tutorInfo.splitDestination || false,
        toBattlefield: tutorInfo.toBattlefield,
        toHand: tutorInfo.toHand,
        lifeLoss: isVampiric ? 2 : undefined,
      });
      debug(2, `[resolveTopOfStack] Tutor spell ${effectiveCard.name}: ${controller} may search for ${tutorInfo.searchCriteria || 'a card'} (destination: ${tutorInfo.destination}, split: ${tutorInfo.splitDestination || false})`);
    }
    
    // Handle Gamble - special tutor with random discard
    // "Search your library for a card, put it into your hand, then shuffle. Then discard a card at random."
    const isGamble = effectiveCard.name?.toLowerCase().trim() === 'gamble';
    
    if (isGamble) {
      enqueueLibrarySearchStep(ctx, controller as PlayerID, {
        searchFor: 'a card',
        description: 'Gamble: Search your library for a card',
        destination: 'hand',
        optional: false,
        source: 'Gamble',
        shuffleAfter: true,
        maxSelections: 1,
      });
      debug(2, `[resolveTopOfStack] Gamble: ${controller} will search for a card (discard handled separately)`);
    }
    
    // Handle Gift of Estates - "If an opponent controls more lands than you, 
    // search your library for up to three Plains cards, reveal them, put them into your hand, then shuffle."
    const isGiftOfEstates = effectiveCard.name?.toLowerCase().includes('gift of estates') ||
        (oracleTextLower.includes('opponent controls more lands') && 
         oracleTextLower.includes('search') && 
         oracleTextLower.includes('plains'));
    
    if (isGiftOfEstates) {
      // Check condition: does an opponent control more lands?
      const { myLandCount, anyOpponentHasMoreLands } = checkOpponentHasMoreLands(state, controller);
      
      if (anyOpponentHasMoreLands) {
        enqueueLibrarySearchStep(ctx, controller as PlayerID, {
          searchFor: 'Plains cards',
          description: `${effectiveCard.name}: Search for up to three Plains cards`,
          destination: 'hand',
          optional: true,
          source: effectiveCard.name || 'Gift of Estates',
          shuffleAfter: true,
          maxSelections: 3,
          filter: { subtypes: ['plains'] },
          minSelections: 0,
        });
        debug(2, `[resolveTopOfStack] Gift of Estates: Condition met (opponent has more lands) - ${controller} may search for up to 3 Plains`);
      } else {
        debug(2, `[resolveTopOfStack] Gift of Estates: Condition NOT met - ${controller} has ${myLandCount} lands, no opponent has more`);
      }
    }
    
    // Handle Traverse the Outlands - "Search your library for up to X basic land cards, 
    // where X is the greatest power among creatures you control"
    const isTraverseOutlands = effectiveCard.name?.toLowerCase().includes('traverse the outlands') ||
        (oracleTextLower.includes('search your library') && 
         oracleTextLower.includes('greatest power') && 
         oracleTextLower.includes('basic land'));
    
    if (isTraverseOutlands) {
      const battlefield = state.battlefield || [];
      
      // Find greatest power among creatures controlled by the caster
      let greatestPower = 0;
      for (const perm of battlefield) {
        if (perm.controller === controller) {
          const typeLine = (perm.card?.type_line || '').toLowerCase();
          if (typeLine.includes('creature')) {
            // Calculate effective power including counters, modifiers, and base power
            let basePower = perm.basePower ?? (parseInt(String(perm.card?.power ?? '0'), 10) || 0);
            
            // Handle star (*) power - use basePower if set
            if (typeof perm.card?.power === 'string' && perm.card.power.includes('*')) {
              if (typeof perm.basePower === 'number') {
                basePower = perm.basePower;
              }
            }
            
            // Add +1/+1 counters
            const plusCounters = perm.counters?.['+1/+1'] || 0;
            const minusCounters = perm.counters?.['-1/-1'] || 0;
            const counterDelta = plusCounters - minusCounters;
            
            // Check for other counter types that affect power
            let otherCounterPower = 0;
            if (perm.counters) {
              for (const [counterType, count] of Object.entries(perm.counters)) {
                if (counterType === '+1/+1' || counterType === '-1/-1') continue;
                const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
                if (counterMatch) {
                  const pMod = parseInt(counterMatch[1], 10);
                  otherCounterPower += pMod * (count as number);
                }
              }
            }
            
            // Add modifiers from equipment, auras, anthems, lords, etc.
            let modifierPower = 0;
            if (perm.modifiers && Array.isArray(perm.modifiers)) {
              for (const mod of perm.modifiers) {
                if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
                  modifierPower += mod.power || 0;
                }
              }
            }
            
            const effectivePower = Math.max(0, basePower + counterDelta + otherCounterPower + modifierPower);
            
            if (effectivePower > greatestPower) {
              greatestPower = effectivePower;
            }
          }
        }
      }
      
      enqueueLibrarySearchStep(ctx, controller as PlayerID, {
        searchFor: 'basic land cards',
        description: `${effectiveCard.name}: Search for up to ${greatestPower} basic lands`,
        destination: 'battlefield',
        entersTapped: true,
        optional: true,
        source: effectiveCard.name || 'Traverse the Outlands',
        shuffleAfter: true,
        maxSelections: greatestPower,
        filter: { types: ['land'], supertypes: ['basic'] },
        minSelections: 0,
      });
      debug(2, `[resolveTopOfStack] Traverse the Outlands: ${controller} may search for up to ${greatestPower} basic lands (greatest power with counters/modifiers)`);
    }
    
    // Handle Boundless Realms - "Search your library for up to X basic land cards, 
    // where X is the number of lands you control"
    const isBoundlessRealms = effectiveCard.name?.toLowerCase().includes('boundless realms') ||
        (oracleTextLower.includes('search your library') && 
         oracleTextLower.includes('number of lands you control') && 
         oracleTextLower.includes('basic land'));
    
    if (isBoundlessRealms) {
      const battlefield = state.battlefield || [];
      
      // Count lands controlled by the caster
      const landCount = battlefield.filter((p: any) => 
        p.controller === controller && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      ).length;
      
      enqueueLibrarySearchStep(ctx, controller as PlayerID, {
        searchFor: 'basic land cards',
        description: `${effectiveCard.name}: Search for up to ${landCount} basic lands`,
        destination: 'battlefield',
        entersTapped: true,
        optional: true,
        source: effectiveCard.name || 'Boundless Realms',
        shuffleAfter: true,
        maxSelections: landCount,
        filter: { types: ['land'], supertypes: ['basic'] },
        minSelections: 0,
      });
      debug(2, `[resolveTopOfStack] Boundless Realms: ${controller} may search for up to ${landCount} basic lands (lands controlled)`);
    }
    
    // Handle Jaheira's Respite - "Search your library for up to X basic land cards, 
    // where X is the number of creatures attacking you"
    const isJaheirasRespite = effectiveCard.name?.toLowerCase().includes("jaheira's respite") ||
        (oracleTextLower.includes('search your library') && 
         oracleTextLower.includes('number of creatures attacking you') && 
         oracleTextLower.includes('basic land'));
    
    if (isJaheirasRespite) {
      // Count creatures currently attacking the controller
      // Note: This should be resolved during combat, so we check the combat state
      const attackers = (state as any).combat?.attackers || [];
      const attackingController = attackers.filter((atk: any) => 
        atk.defendingPlayer === controller
      ).length;
      
      enqueueLibrarySearchStep(ctx, controller as PlayerID, {
        searchFor: 'basic land cards',
        description: `${effectiveCard.name}: Search for up to ${attackingController} basic lands`,
        destination: 'battlefield',
        entersTapped: true,
        optional: true,
        source: effectiveCard.name || "Jaheira's Respite",
        shuffleAfter: true,
        maxSelections: attackingController,
        filter: { types: ['land'], supertypes: ['basic'] },
        minSelections: 0,
      });
      debug(2, `[resolveTopOfStack] Jaheira's Respite: ${controller} may search for up to ${attackingController} basic lands (creatures attacking)`);
    }
    
    // Handle Path to Exile - exile target creature, controller may search for basic land
    // Use captured target info from BEFORE the exile happened
    const isPathToExile = effectiveCard.name?.toLowerCase().includes('path to exile') || 
        (oracleTextLower.includes('exile target creature') && 
         oracleTextLower.includes('search') && 
         oracleTextLower.includes('basic land'));
    
    if (isPathToExile && targetControllerForRemovalEffects) {
      enqueueLibrarySearchStep(ctx, targetControllerForRemovalEffects as PlayerID, {
        searchFor: 'basic land',
        description: `${effectiveCard.name}: Search for a basic land`,
        destination: 'battlefield',
        entersTapped: true,
        optional: true,
        source: effectiveCard.name || 'Path to Exile',
        shuffleAfter: true,
        maxSelections: 1,
        minSelections: 0,
        filter: { types: ['land'], supertypes: ['basic'] },
      });
      debug(2, `[resolveTopOfStack] Path to Exile: ${targetControllerForRemovalEffects} may search for a basic land (tapped)`);
    }
    
    // Handle Swords to Plowshares - "Exile target creature. Its controller gains life equal to its power."
    // Use captured target info from BEFORE the exile happened
    const isSwordsToPlowshares = effectiveCard.name?.toLowerCase().includes('swords to plowshares') || 
        (oracleTextLower.includes('exile target creature') && 
         oracleTextLower.includes('gains life equal to'));
    
    if (isSwordsToPlowshares && targetControllerForRemovalEffects) {
      // Gain the life using pre-captured power value
      if (targetPowerBeforeRemoval > 0) {
        const players = (state as any).players || [];
        const player = players.find((p: any) => p?.id === targetControllerForRemovalEffects);
        
        // Update both player.life and state.life to ensure consistency
        const startingLife = (state as any).startingLife || 40;
        state.life = state.life || {};
        const currentLife = state.life[targetControllerForRemovalEffects] ?? player?.life ?? startingLife;
        state.life[targetControllerForRemovalEffects] = currentLife + targetPowerBeforeRemoval;
        
        if (player) {
          player.life = state.life[targetControllerForRemovalEffects];
          debug(2, `[resolveTopOfStack] Swords to Plowshares: ${targetControllerForRemovalEffects} gains ${targetPowerBeforeRemoval} life (${currentLife} -> ${state.life[targetControllerForRemovalEffects]})`);
        }
        
        // Trigger life gain effects (Ajani's Pridemate, etc.)
        triggerLifeGainEffects(state, targetControllerForRemovalEffects, targetPowerBeforeRemoval);
      }
    }
    
    // Handle Fateful Absence - "Destroy target creature or planeswalker. Its controller investigates."
    // Use captured target info from BEFORE the destroy happened
    const isFatefulAbsence = effectiveCard.name?.toLowerCase().includes('fateful absence') ||
        (oracleTextLower.includes('destroy target creature') && 
         oracleTextLower.includes('investigates'));
    
    if (isFatefulAbsence && targetControllerForRemovalEffects) {
      // Create a Clue token for the creature's controller
      state.battlefield = state.battlefield || [];
      const clueId = uid("clue");
      state.battlefield.push({
        id: clueId,
        controller: targetControllerForRemovalEffects,
        owner: targetControllerForRemovalEffects,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: clueId,
          name: "Clue",
          type_line: "Token Artifact — Clue",
          oracle_text: "{2}, Sacrifice this artifact: Draw a card.",
          zone: "battlefield",
          colors: [],
        },
      } as any);
      
      debug(2, `[resolveTopOfStack] Fateful Absence: Created Clue token for ${targetControllerForRemovalEffects}`);
    }
    
    // Handle Get Lost - "Destroy target creature, enchantment, or planeswalker. Its controller creates two Map tokens."
    // Use captured target info from BEFORE the destroy happened
    const isGetLost = effectiveCard.name?.toLowerCase().includes('get lost') ||
        (oracleTextLower.includes('destroy target creature') && 
         oracleTextLower.includes('map token'));
    
    if (isGetLost && targetControllerForRemovalEffects) {
      // Create two Map tokens for the creature's controller
      state.battlefield = state.battlefield || [];
      for (let i = 0; i < 2; i++) {
        const mapId = uid("map");
        state.battlefield.push({
          id: mapId,
          controller: targetControllerForRemovalEffects,
          owner: targetControllerForRemovalEffects,
          tapped: false,
          counters: {},
          isToken: true,
          card: {
            id: mapId,
            name: "Map",
            type_line: "Token Artifact — Map",
            oracle_text: "{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.",
            zone: "battlefield",
            colors: [],
          },
        } as any);
      }
      
      debug(1, `[resolveTopOfStack] Get Lost: Created 2 Map tokens for ${targetControllerForRemovalEffects}`);
    }
    
    // Handle Nature's Claim - "Destroy target artifact or enchantment. Its controller gains 4 life."
    // Use captured target info from BEFORE the destroy happened
    const isNaturesClaim = effectiveCard.name?.toLowerCase().includes("nature's claim") ||
        effectiveCard.name?.toLowerCase().includes("natures claim") ||
        ((oracleTextLower.includes('destroy target artifact') || oracleTextLower.includes('destroy target enchantment')) && 
         oracleTextLower.includes('its controller gains 4 life'));
    
    if (isNaturesClaim && targetControllerForRemovalEffects) {
      // Give 4 life to the controller of the destroyed permanent
      const players = (state as any).players || [];
      const player = players.find((p: any) => p?.id === targetControllerForRemovalEffects);
      
      // Update both player.life and state.life to ensure consistency
      const startingLife = (state as any).startingLife || 40;
      state.life = state.life || {};
      const currentLife = state.life[targetControllerForRemovalEffects] ?? player?.life ?? startingLife;
      state.life[targetControllerForRemovalEffects] = currentLife + 4;
      
      if (player) {
        player.life = state.life[targetControllerForRemovalEffects];
        debug(2, `[resolveTopOfStack] Nature's Claim: ${targetControllerForRemovalEffects} gains 4 life (${currentLife} -> ${state.life[targetControllerForRemovalEffects]})`);
      }
      
      // Trigger life gain effects (Ajani's Pridemate, etc.)
      triggerLifeGainEffects(state, targetControllerForRemovalEffects, 4);
    }
    
    // Handle Entrapment Maneuver - "Target player sacrifices an attacking creature. 
    // You create X 1/1 white Soldier creature tokens, where X is that creature's toughness."
    const isEntrapmentManeuver = effectiveCard.name?.toLowerCase().includes('entrapment maneuver') ||
      (oracleTextLower.includes('sacrifices an attacking creature') && 
       oracleTextLower.includes('create') && 
       oracleTextLower.includes('soldier') &&
       oracleTextLower.includes('toughness'));
    
    if (isEntrapmentManeuver && targets.length > 0) {
      // Find the target player (they must sacrifice an attacking creature)
      const targetPlayerId = targets[0]?.id || targets[0];
      
      // Get all attacking creatures controlled by the target player
      const battlefield = state.battlefield || [];
      const attackingCreatures = battlefield.filter((p: any) => 
        p?.controller === targetPlayerId && 
        (p?.card?.type_line || "").toLowerCase().includes("creature") &&
        p?.attacking // Only creatures that are currently attacking
      );
      
      if (attackingCreatures.length > 0) {
        // Get gameId from context - needed for Resolution Queue
        const gameId = (ctx as any).gameId || (ctx as any).id;
        
        if (gameId) {
          // Use Resolution Queue for Entrapment Maneuver selection
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.ENTRAPMENT_MANEUVER,
            playerId: targetPlayerId as PlayerID,
            description: `You must sacrifice an attacking creature you control.`,
            mandatory: true,
            sourceId: item.id,
            sourceName: effectiveCard.name || 'Entrapment Maneuver',
            sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
            caster: controller,
            attackingCreatures: attackingCreatures.map((c: any) => ({
              id: c.id,
              name: c.card?.name || "Unknown",
              power: c.card?.power || c.basePower || "0",
              toughness: c.card?.toughness || c.baseToughness || "0",
              imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
              typeLine: c.card?.type_line,
            })),
          });
          debug(2, `[resolveTopOfStack] Entrapment Maneuver: Added Resolution Queue step for ${targetPlayerId} to sacrifice one of ${attackingCreatures.length} attacking creature(s)`);
        } else {
          debugError(1, `[resolveTopOfStack] Entrapment Maneuver: Cannot process without gameId - spell effect will be skipped`);
        }
      } else {
        debug(2, `[resolveTopOfStack] Entrapment Maneuver: ${targetPlayerId} has no attacking creatures to sacrifice`);
      }
    }
    
    // Handle Chaos Warp - "The owner of target permanent shuffles it into their library, 
    // then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield."
    const isChaosWarp = effectiveCard.name?.toLowerCase().includes('chaos warp') ||
      (oracleTextLower.includes('shuffles it into their library') && 
       oracleTextLower.includes('reveals the top card') &&
       oracleTextLower.includes('permanent'));
    
    if (isChaosWarp && targets.length > 0) {
      const targetPermId = targets[0]?.id || targets[0];
      const battlefield = state.battlefield || [];
      const targetPerm = battlefield.find((p: any) => p.id === targetPermId);
      
      if (targetPerm) {
        const owner = targetPerm.owner as PlayerID;
        const targetCard = targetPerm.card;
        
        // Commander Replacement Effect (Rule 903.9a):
        // If a commander would be put into its owner's library from anywhere,
        // its owner may put it into the command zone instead.
        const commandZone = ctx.commandZone || {};
        const commanderInfo = commandZone[owner];
        const commanderIds = commanderInfo?.commanderIds || [];
        const isCommander = (targetCard?.id && commanderIds.includes(targetCard.id)) || targetPerm.isCommander === true;
        
        // Remove permanent from battlefield
        const idx = battlefield.findIndex((p: any) => p.id === targetPermId);
        if (idx !== -1) {
          battlefield.splice(idx, 1);
        }
        
        if (isCommander && targetCard) {
          // Defer zone change - let player choose command zone or library via Resolution Queue
          ResolutionQueueManager.addStep(ctx.gameId, {
            type: ResolutionStepType.COMMANDER_ZONE_CHOICE,
            playerId: owner,
            sourceId: targetPermId,
            sourceName: targetCard.name,
            description: `Your commander ${targetCard.name} would be shuffled into your library. Move it to the command zone instead?`,
            mandatory: true,
            commanderId: targetCard.id,
            commanderName: targetCard.name,
            fromZone: 'library',
            libraryPosition: 'shuffle',
            card: {
              id: targetCard.id,
              name: targetCard.name,
              type_line: targetCard.type_line,
              oracle_text: targetCard.oracle_text,
              image_uris: targetCard.image_uris,
              mana_cost: targetCard.mana_cost,
              power: targetCard.power,
              toughness: targetCard.toughness,
            } as any,
          } as any);
          debug(2, `[resolveTopOfStack] Chaos Warp: Commander ${targetCard.name} would go to library - queued commander zone choice step`);
          
          // Still reveal and potentially put a card onto battlefield
          // (but the commander choice happens separately)
          const lib = ctx.libraries?.get(owner) || [];
          if (lib.length > 0) {
            const topCard = lib[0];
            const topTypeLine = (topCard?.type_line || '').toLowerCase();
            const isPermanent = topTypeLine.includes('creature') || 
                                topTypeLine.includes('artifact') || 
                                topTypeLine.includes('enchantment') || 
                                topTypeLine.includes('land') || 
                                topTypeLine.includes('planeswalker') ||
                                topTypeLine.includes('battle');
            if (isPermanent) {
              lib.shift();
              ctx.libraries?.set(owner, lib);
              const newPerm = {
                id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                card: topCard,
                controller: owner,
                owner: owner,
                tapped: false,
                counters: {},
              };
              battlefield.push(newPerm);
              debug(2, `[resolveTopOfStack] Chaos Warp: Revealed and put ${topCard.name} onto battlefield for ${owner}`);
            }
          }
          
          bumpSeq();
          return;
        }
        
        // Non-commander - shuffle into owner's library
        const lib = ctx.libraries?.get(owner) || [];
        (lib as any[]).push({ ...targetCard, zone: 'library' });
        
        // Shuffle library
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
        ctx.libraries?.set(owner, lib);
        
        debug(2, `[resolveTopOfStack] Chaos Warp: ${targetCard?.name || 'Permanent'} shuffled into ${owner}'s library`);
        
        // Reveal top card of library
        if (lib.length > 0) {
          const topCard = lib[0];
          const topTypeLine = (topCard?.type_line || '').toLowerCase();
          
          // Check if it's a permanent card (creature, artifact, enchantment, land, planeswalker, battle)
          const isPermanent = topTypeLine.includes('creature') || 
                              topTypeLine.includes('artifact') || 
                              topTypeLine.includes('enchantment') || 
                              topTypeLine.includes('land') || 
                              topTypeLine.includes('planeswalker') ||
                              topTypeLine.includes('battle');
          
          if (isPermanent) {
            // Remove from library
            lib.shift();
            ctx.libraries?.set(owner, lib);
            
            // Put onto battlefield
            const isCreature = topTypeLine.includes('creature');
            const isPlaneswalker = topTypeLine.includes('planeswalker');
            const newPermanent = {
              id: uid("perm"),
              controller: owner,
              owner: owner,
              tapped: false,
              counters: {},
              basePower: isCreature ? parsePT((topCard as any).power) : undefined,
              baseToughness: isCreature ? parsePT((topCard as any).toughness) : undefined,
              summoningSickness: isCreature,
              card: { ...topCard, zone: "battlefield" },
            } as any;
            
            // Add loyalty for planeswalkers
            if (isPlaneswalker && (topCard as any).loyalty) {
              const loyaltyValue = parseInt((topCard as any).loyalty, 10);
              newPermanent.counters = { loyalty: loyaltyValue };
              newPermanent.loyalty = loyaltyValue;
              newPermanent.baseLoyalty = loyaltyValue;
            }
            
            battlefield.push(newPermanent);
            debug(2, `[resolveTopOfStack] Chaos Warp: ${owner} revealed ${topCard?.name || 'card'} (permanent) - put onto battlefield`);
          } else {
            debug(2, `[resolveTopOfStack] Chaos Warp: ${owner} revealed ${topCard?.name || 'card'} (${topTypeLine}) - not a permanent, stays on top`);
          }
        }
        
        // Update library count
        const zones = state.zones || {};
        const z = zones[owner];
        if (z) {
          z.libraryCount = lib.length;
        }
      }
    }
    
    // Handle Join Forces spells (Mind's Aglow, Collective Voyage, etc.)
    // These require all players to have the option to contribute mana
    // Uses the unified ResolutionQueueManager for proper APNAP ordering
    const cardNameLower = (effectiveCard.name || '').toLowerCase();
    debug(1, `[resolveTopOfStack] Checking if ${effectiveCard.name} is a Join Forces spell...`);
    if (isJoinForcesSpell(effectiveCard.name, oracleTextLower)) {
      // Get players from state
      const allPlayers = (state as any).players || [];
      
      // Get turn order for APNAP ordering
      const turnOrder = allPlayers.map((p: any) => p.id);
      const activePlayerId = (state as any).activePlayer || controller;
      const gameId = (ctx as any).gameId || 'unknown';
      
      // Create resolution steps for each player using APNAP ordering
      // "Starting with you" means the caster goes first, then others in turn order
      const stepConfigs = allPlayers.map((p: any) => {
        const playerId = p.id;
        const isInitiator = playerId === controller;
        
        // Calculate available mana for this player
        const battlefield = state.battlefield || [];
        const untappedLands = battlefield.filter((perm: any) => 
          perm.controller === playerId && 
          !perm.tapped &&
          (perm.card?.type_line || '').toLowerCase().includes('land')
        ).length;
        
        return {
          type: ResolutionStepType.JOIN_FORCES,
          playerId,
          description: `${effectiveCard.name}: You may pay any amount of mana to contribute to this effect`,
          mandatory: false,
          sourceId: item.id,
          sourceName: effectiveCard.name || 'Join Forces Spell',
          sourceImage: effectiveCard.image_uris?.small,
          cardName: effectiveCard.name || 'Join Forces Spell',
          effectDescription: oracleText,
          cardImageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
          initiator: controller,
          availableMana: untappedLands,
          isInitiator,
        };
      });
      
      // Skip adding resolution steps during replay to prevent infinite loops
      const isReplaying = !!(ctx as any).isReplaying;
      if (!isReplaying) {
        // Add steps with APNAP ordering, starting with the caster
        ResolutionQueueManager.addStepsWithAPNAP(
          gameId,
          stepConfigs,
          turnOrder,
          controller // Start with caster, not active player
        );
        
        debug(1, `[resolveTopOfStack] Join Forces spell ${effectiveCard.name} created ${allPlayers.length} resolution steps for contributions`);
      } else {
        debug(2, `[resolveTopOfStack] Join Forces: skipping resolution steps during replay`);
      }
    } else {
      debug(1, `[resolveTopOfStack] ${effectiveCard.name} is NOT a Join Forces spell (name: "${cardNameLower}", has 'join forces': ${oracleTextLower.includes('join forces')})`);
    }
    
    // Handle Tempting Offer spells (Tempt with Discovery, Tempt with Glory, etc.)
    // These require each opponent to choose whether to accept the offer
    // Uses the unified ResolutionQueueManager for proper APNAP ordering
    debug(2, `[resolveTopOfStack] Checking if ${effectiveCard.name} is a Tempting Offer spell...`);
    if (isTemptingOfferSpell(effectiveCard.name, oracleTextLower)) {
      // Get players from state
      const allPlayers = (state as any).players || [];
      
      // Get opponents (non-initiator players)
      const opponents = allPlayers.filter((p: any) => p.id !== controller);
      const turnOrder = allPlayers.map((p: any) => p.id);
      const gameId = (ctx as any).gameId || 'unknown';
      
      if (opponents.length > 0) {
        // Create resolution steps for each opponent using APNAP ordering
        const stepConfigs = opponents.map((p: any) => {
          const playerId = p.id;
          
          return {
            type: ResolutionStepType.TEMPTING_OFFER,
            playerId,
            description: `${effectiveCard.name}: Do you accept the tempting offer?`,
            mandatory: false,
            sourceId: item.id,
            sourceName: effectiveCard.name || 'Tempting Offer Spell',
            sourceImage: effectiveCard.image_uris?.small,
            cardName: effectiveCard.name || 'Tempting Offer Spell',
            effectDescription: oracleText,
            cardImageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
            initiator: controller,
            isOpponent: true,
          };
        });
        
        // Skip adding resolution steps during replay to prevent infinite loops
        const isReplaying = !!(ctx as any).isReplaying;
        if (!isReplaying) {
          // Add steps with APNAP ordering
          ResolutionQueueManager.addStepsWithAPNAP(
            gameId,
            stepConfigs,
            turnOrder,
            (state as any).activePlayer || controller
          );
          
          debug(2, `[resolveTopOfStack] Tempting Offer spell ${effectiveCard.name} created ${opponents.length} resolution steps for opponent responses`);
        } else {
          debug(2, `[resolveTopOfStack] Tempting Offer: skipping resolution steps during replay`);
        }
      } else {
        // No opponents - initiator just gets the effect once
        debug(2, `[resolveTopOfStack] Tempting Offer spell ${effectiveCard.name} has no opponents - effect resolves immediately for initiator`);
      }
    } else {
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} is NOT a Tempting Offer spell`);
    }
    
    // Handle Ponder-style effects (look at top N, reorder, optionally shuffle, then draw)
    // Pattern: "Look at the top N cards of your library, then put them back in any order"
    if (isPonderStyleSpell(effectiveCard.name, oracleTextLower)) {
      const ponderConfig = getPonderConfig(effectiveCard.name, oracleTextLower);
      
      // Set up pending ponder - the socket layer will send the peek prompt
      (state as any).pendingPonder = (state as any).pendingPonder || {};
      (state as any).pendingPonder[controller] = {
        effectId: uid("ponder"),
        cardCount: ponderConfig.cardCount,
        cardName: effectiveCard.name || 'Ponder',
        variant: ponderConfig.variant,
        canShuffle: ponderConfig.canShuffle,
        drawAfter: ponderConfig.drawAfter,
        pickToHand: ponderConfig.pickToHand,
        targetPlayerId: controller,
        imageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      };
      debug(2, `[resolveTopOfStack] Ponder-style spell ${effectiveCard.name} set up pending effect (variant: ${ponderConfig.variant}, cards: ${ponderConfig.cardCount})`);
    }

    // Handle Genesis Wave: Reveal top X, you may put any number of permanents with MV <= X onto battlefield, rest to graveyard
    if ((effectiveCard.name || '').toLowerCase().includes('genesis wave')) {
      const xVal = typeof spellXValue === 'number' ? spellXValue : 0;
      const lib = ctx.libraries?.get(controller) || [];
      const revealed: any[] = [];
      for (let i = 0; i < xVal && lib.length > 0; i++) {
        revealed.push(lib.shift() as any);
      }
      
      // Filter to only permanents with MV <= X
      const eligiblePermanents: any[] = [];
      const notEligible: any[] = [];
      for (const c of revealed) {
        const typeLine = (c.type_line || '').toLowerCase();
        const isPermanentCard = ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'].some(t => typeLine.includes(t));
        const mv = cardManaValue(c);
        if (isPermanentCard && mv <= xVal) {
          eligiblePermanents.push(c);
        } else {
          notEligible.push(c);
        }
      }
      
      // If there are eligible permanents, create a resolution step for player to choose which to put onto battlefield
      if (eligiblePermanents.length > 0) {
        const gameId = (ctx as any).gameId || 'unknown';
        
        // Skip adding resolution steps during replay to prevent infinite loops
        const isReplaying = !!(ctx as any).isReplaying;
        if (!isReplaying) {
          // Add resolution step using the generic LIBRARY_SEARCH type with Genesis Wave parameters
          ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: controller as PlayerID,
          description: `Genesis Wave (X=${xVal}): Choose any number of permanents to put onto the battlefield`,
          mandatory: false, // Optional - player may choose 0 permanents
          sourceId: item.id,
          sourceName: 'Genesis Wave',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          searchCriteria: `Permanent cards with mana value ${xVal} or less`,
          minSelections: 0,
          maxSelections: eligiblePermanents.length,
          destination: 'battlefield' as const,
          reveal: true,
          shuffleAfter: false,
          remainderDestination: 'graveyard' as const, // Genesis Wave: rest go to graveyard
          remainderRandomOrder: false,
          availableCards: eligiblePermanents.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,  // Include full image_uris object for battlefield placement
            imageUrl: c.image_uris?.normal || c.image_uris?.small,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
            power: c.power,
            toughness: c.toughness,
            loyalty: c.loyalty,
            colors: c.colors,
          })),
          nonSelectableCards: notEligible.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,  // Include full image_uris object
            imageUrl: c.image_uris?.normal || c.image_uris?.small,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
          })),
          contextValue: xVal, // Store X value for display/reference
          entersTapped: false,
        });
        
        debug(2, `[resolveTopOfStack] Genesis Wave: Created LIBRARY_SEARCH step for ${eligiblePermanents.length} eligible permanents (X=${xVal})`);
        } else {
          debug(2, `[resolveTopOfStack] Genesis Wave: skipping resolution step during replay`);
        }
      } else {
        // No eligible permanents, just put everything to graveyard
        const zones = ctx.state.zones || {};
        const z = zones[controller] || { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 };
        zones[controller] = z;
        z.graveyard = z.graveyard || [];
        
        for (const c of revealed) {
          z.graveyard.push({ ...c, zone: 'graveyard' });
          recordCardPutIntoGraveyardThisTurn(ctx, String(controller), c, { fromBattlefield: false });
        }
        z.graveyardCount = z.graveyard.length;
        
        // Update library count
        z.libraryCount = lib.length;
        
        debug(2, `[resolveTopOfStack] Genesis Wave: No eligible permanents, put ${revealed.length} cards to graveyard (X=${xVal})`);
      }
      
      bumpSeq();
    }
    
    // Handle Approach of the Second Sun - goes 7th from top of library, not graveyard
    // Also track that it was cast for win condition checking
    const isApproach = (effectiveCard.name || '').toLowerCase().includes('approach of the second sun') ||
                       (oracleTextLower.includes('put it into its owner\'s library seventh from the top') &&
                        oracleTextLower.includes('you win the game'));
    
    if (isApproach) {
      // Track that Approach was cast (for win condition)
      (state as any).approachCastHistory = (state as any).approachCastHistory || {};
      (state as any).approachCastHistory[controller] = (state as any).approachCastHistory[controller] || [];
      (state as any).approachCastHistory[controller].push({
        timestamp: Date.now(),
        castFromHand: true, // Assuming cast from hand for now
      });
      
      // Check if this is the second time casting from hand
      const castCount = (state as any).approachCastHistory[controller].length;
      if (castCount >= 2) {
        // Win the game!
        debug(2, `[resolveTopOfStack] ${controller} wins! Approach of the Second Sun cast for the second time!`);
        
        // Set winner
        (state as any).winner = controller;
        (state as any).gameOver = true;
        (state as any).winCondition = 'Approach of the Second Sun';
      } else {
        // Put 7th from top of library (position 6 in 0-indexed)
        // If library has fewer than 7 cards, put at the bottom (lib.length position)
        const lib = ctx.libraries?.get(controller) || [];
        const insertPosition = Math.min(6, lib.length); // 7th from top, or bottom if library is small
        (lib as any[]).splice(insertPosition, 0, { ...card, zone: 'library' });
        ctx.libraries?.set(controller, lib);
        
        // Update library count
        const zones = ctx.state.zones || {};
        const z = zones[controller];
        if (z) {
          z.libraryCount = lib.length;
        }
        
        // Gain 7 life
        state.life = state.life || {};
        state.life[controller] = (state.life[controller] || 40) + 7;
        const player = (state.players || []).find((p: any) => p.id === controller);
        if (player) player.life = state.life[controller];
        
        debug(2, `[resolveTopOfStack] Approach of the Second Sun: ${controller} gained 7 life, card put 7th from top (cast #${castCount})`);
      }
      
      bumpSeq();
      return; // Skip normal graveyard movement
    }
    
    // Move spell to graveyard or exile (for adventure/rebound) after resolution
    const zones = ctx.state.zones || {};
    const z = zones[controller];
    if (z) {
      // Check if this is an adventure spell (layout === 'adventure' and was cast as adventure)
      const layout = (card as any).layout;
      const wasAdventure = (item as any).castAsAdventure === true;
      
      // Check for Rebound keyword (dynamically detect from oracle text)
      // Rebound: "If this spell was cast from your hand, exile it as it resolves. 
      // At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost."
      // Important: Spells cast from rebound don't rebound again (they go to graveyard)
      const hasRebound = /\brebound\b/i.test(oracleText);
      const wasCastFromHand = (item as any).castFromHand === true || (item as any).source === 'hand';
      const wasCastFromRebound = (item as any).castFromRebound === true;
      
      if (layout === 'adventure' && wasAdventure) {
        // Adventure spells go to exile instead of graveyard (Rule 715.3d)
        z.exile = z.exile || [];
        (z.exile as any[]).push({ 
          ...card, 
          zone: "exile",
          onAdventure: true, // Mark that this was sent on an adventure
          adventureCaster: controller, // Track who sent it on adventure
        });
        z.exileCount = (z.exile as any[]).length;
        
        debug(2, `[resolveTopOfStack] Adventure spell ${effectiveCard.name || 'unnamed'} resolved and exiled for ${controller}`);
      } else if (hasRebound && wasCastFromHand && !wasCastFromRebound) {
        // Rebound: Exile the spell instead of putting it in graveyard
        // Mark it for casting at the beginning of next upkeep
        // Note: Spells cast from rebound don't rebound again
        z.exile = z.exile || [];
        (z.exile as any[]).push({ 
          ...card, 
          zone: "exile",
          reboundPending: true, // Mark for rebound
          reboundController: controller, // Who will cast it
          reboundTurn: (state as any).turnNumber || 1, // Track which turn it was cast
        });
        z.exileCount = (z.exile as any[]).length;
        
        debug(2, `[resolveTopOfStack] Rebound spell ${effectiveCard.name || 'unnamed'} exiled for ${controller} - will trigger at beginning of next upkeep`);
      } else {
        // Regular instant/sorcery - goes to graveyard
        z.graveyard = z.graveyard || [];
        (z.graveyard as any[]).push({ ...card, zone: "graveyard" });
        z.graveyardCount = (z.graveyard as any[]).length;
        
        // Check for graveyard triggers (Eldrazi shuffle)
        if (checkGraveyardTrigger(ctx, card, controller)) {
          debug(2, `[resolveTopOfStack] ${card.name} triggered graveyard shuffle for ${controller}`);
        }
        
        debug(2, `[resolveTopOfStack] Spell ${card.name || 'unnamed'} resolved and moved to graveyard for ${controller}`);
      }
    }
  }
  
  // Run state-based actions after spell resolution
  // This catches creatures that should die from damage (Blasphemous Act, etc.)
  // or from 0 toughness from -1/-1 effects
  try {
    runSBA(ctx);
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Error running SBA:', err);
  }
  
  // CRITICAL FIX: Reset priorityPassedBy after stack resolution
  // This ensures that after a spell resolves, all players must pass priority again
  // before the step can advance. This prevents the race condition where auto-pass
  // immediately advances to the next step before the turn player can play their land.
  // 
  // Per MTG rules (117.3b): After a spell or ability resolves, the active player
  // receives priority again and can perform more actions before passing.
  try {
    (state as any).priorityPassedBy = new Set<string>();
    debug(2, `[resolveTopOfStack] Reset priorityPassedBy after spell resolution`);
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Error resetting priorityPassedBy:', err);
  }
  
  bumpSeq();
}

/**
 * Execute a single spell effect
 */
function executeSpellEffect(
  ctx: GameContext,
  effect: EngineEffect,
  caster: PlayerID,
  spellName: string,
  sourcePermanentId?: string
): void {
  const { state } = ctx;
  
  switch (effect.kind) {
    case 'DestroyPermanent': {
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const destroyedPermanentId = (battlefield[idx] as any).id;
        const destroyed = battlefield.splice(idx, 1)[0];
        const owner = (destroyed as any).owner || (destroyed as any).controller;
        const zones = ctx.state.zones || {};
        const z = zones[owner];
        if (z) {
          z.graveyard = z.graveyard || [];
          const card = (destroyed as any).card;
          if (card) {
            (z.graveyard as any[]).push({ ...card, zone: "graveyard" });
            z.graveyardCount = (z.graveyard as any[]).length;
          }
        }
        debug(2, `[resolveSpell] ${spellName} destroyed ${(destroyed as any).card?.name || effect.id}`);
        
        // Process linked exile returns - if this was an Oblivion Ring-style card,
        // return any cards it had exiled
        processLinkedExileReturns(ctx, destroyedPermanentId);
      }
      break;
    }
    case 'MoveToExile': {
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const exiledPermanentId = (battlefield[idx] as any).id;
        const exiled = battlefield.splice(idx, 1)[0];
        const owner = (exiled as any).owner || (exiled as any).controller;
        const zones = ctx.state.zones || {};
        const z = zones[owner];
        if (z) {
          z.exile = z.exile || [];
          const card = (exiled as any).card;
          if (card) {
            (z.exile as any[]).push({ ...card, zone: "exile" });
          }
        }
        debug(2, `[resolveSpell] ${spellName} exiled ${(exiled as any).card?.name || effect.id}`);
        
        // Process linked exile returns - if this was an Oblivion Ring-style card,
        // return any cards it had exiled
        processLinkedExileReturns(ctx, exiledPermanentId);
      }
      break;
    }
    case 'BouncePermanent': {
      const id = String((effect as any).id || '');
      if (!id) break;
      const moved = movePermanentToHand(ctx, id);
      if (moved) {
        // If this was an Oblivion Ring-style permanent, return any cards it had exiled.
        processLinkedExileReturns(ctx, id);
        debug(2, `[resolveSpell] ${spellName} returned ${id} to its owner's hand`);
      }
      break;
    }
    case 'TapPermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === (effect as any).id);
      if (perm) {
        (perm as any).tapped = true;
        ctx.bumpSeq();
        debug(2, `[resolveSpell] ${spellName} tapped ${(perm as any).card?.name || (effect as any).id}`);
      }
      break;
    }
    case 'UntapPermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === (effect as any).id);
      if (perm) {
        (perm as any).tapped = false;
        ctx.bumpSeq();
        debug(2, `[resolveSpell] ${spellName} untapped ${(perm as any).card?.name || (effect as any).id}`);
      }
      break;
    }
    case 'GainLife': {
      const playerId = (effect as any).playerId as PlayerID;
      const amount = Math.max(0, Number((effect as any).amount ?? 0));
      if (!playerId || amount <= 0) break;

      const { finalAmount } = processLifeChange(ctx as any, playerId, amount, true);
      if (finalAmount === 0) break;

      const players = state.players || [];
      const player = players.find((p: any) => p.id === playerId);
      const startingLife = (state as any).startingLife ?? 40;
      (state as any).life = (state as any).life || {};

      const current = (state as any).life[playerId] ?? (player as any)?.life ?? startingLife;
      const next = current + finalAmount;
      (state as any).life[playerId] = next;
      if (player) (player as any).life = next;
      (ctx as any).life = (ctx as any).life || {};
      (ctx as any).life[playerId] = next;

      ctx.bumpSeq();
      if (finalAmount > 0) {
        try { triggerLifeGainEffects((ctx as any).state, playerId, finalAmount); } catch {}
      }
      debug(2, `[resolveSpell] ${spellName} changed life for ${playerId}: ${finalAmount >= 0 ? '+' : ''}${finalAmount}`);
      break;
    }
    case 'LoseLife': {
      const playerId = (effect as any).playerId as PlayerID;
      const amount = Math.max(0, Number((effect as any).amount ?? 0));
      if (!playerId || amount <= 0) break;

      const { finalAmount } = processLifeChange(ctx as any, playerId, amount, false);
      if (finalAmount === 0) break;

      const players = state.players || [];
      const player = players.find((p: any) => p.id === playerId);
      const startingLife = (state as any).startingLife ?? 40;
      (state as any).life = (state as any).life || {};

      const current = (state as any).life[playerId] ?? (player as any)?.life ?? startingLife;
      const next = current - Math.abs(finalAmount);
      (state as any).life[playerId] = next;
      if (player) (player as any).life = next;
      (ctx as any).life = (ctx as any).life || {};
      (ctx as any).life[playerId] = next;

      ctx.bumpSeq();
      debug(2, `[resolveSpell] ${spellName} changed life for ${playerId}: -${Math.abs(finalAmount)}`);
      break;
    }
    case 'FlickerPermanent': {
      // Flicker effect: Exile a permanent and return it to the battlefield
      // For tokens, they cease to exist when exiled and don't return
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const flickeredPermanentId = (battlefield[idx] as any).id;
        const flickered = battlefield.splice(idx, 1)[0];
        const flickeredCard = (flickered as any).card;
        const flickeredName = flickeredCard?.name || effect.id;
        const owner = (flickered as any).owner || (flickered as any).controller;
        const isToken = (flickered as any).isToken === true;
        
        // Process linked exile returns first - if this was an Oblivion Ring-style card,
        // return any cards it had exiled before the flicker effect
        processLinkedExileReturns(ctx, flickeredPermanentId);
        
        // Tokens cease to exist when exiled (Rule 111.7) - they don't return
        if (isToken) {
          debug(2, `[resolveSpell] ${spellName} exiled token ${flickeredName} - token ceased to exist`);
          break;
        }
        
        // Determine when to return the permanent
        const returnDelay = (effect as any).returnDelay || 'immediate';
        
        if (returnDelay === 'immediate') {
          // Return immediately to the battlefield under owner's control
          // Create a new permanent (new object, no connection to old one)
          // Detect enters-with-counters
          const entersWithCounters = detectEntersWithCounters(flickeredCard);
          const isPlaneswalker = flickeredCard?.type_line?.toLowerCase()?.includes('planeswalker');
          
          const newPermanent = {
            id: uid('perm'),
            card: flickeredCard,
            controller: owner,
            owner: owner,
            tapped: false,
            summoning_sickness: flickeredCard?.type_line?.toLowerCase()?.includes('creature') || false,
            counters: entersWithCounters && Object.keys(entersWithCounters).length > 0 ? entersWithCounters : {},
            attachedTo: undefined, // Equipment/Auras are removed
          };
          
          // Add loyalty for planeswalkers
          if (isPlaneswalker && (flickeredCard as any).loyalty) {
            const loyaltyValue = parseInt((flickeredCard as any).loyalty, 10);
            newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
            (newPermanent as any).loyalty = loyaltyValue;
            (newPermanent as any).baseLoyalty = loyaltyValue;
          }
          
          battlefield.push(newPermanent);
          debug(2, `[resolveSpell] ${spellName} flickered ${flickeredName} - returned immediately as new permanent ${newPermanent.id}`);
          
          // Trigger ETB effects for the returned permanent
          triggerETBEffectsForPermanent(ctx, newPermanent, owner);
          
        } else {
          // Set up delayed trigger for end of turn or end of combat
          const delayedReturns = (state as any).delayedReturns = (state as any).delayedReturns || [];
          delayedReturns.push({
            id: uid('delayed'),
            card: flickeredCard,
            owner: owner,
            returnTime: returnDelay, // 'end_of_turn' or 'end_of_combat'
            source: spellName,
          });
          debug(2, `[resolveSpell] ${spellName} exiled ${flickeredName} - will return at ${returnDelay}`);
        }
      }
      break;
    }
    case 'DamagePermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === effect.id);
      if (perm) {
        const dmg = Math.max(0, Number((effect as any).amount ?? 0));

        // Turn-tracking for intervening-if: creature→creature damage relationships, including non-combat sources.
        // Best-effort: only records when the source is a battlefield creature and the target is a creature permanent.
        if (dmg > 0 && sourcePermanentId) {
          try {
            const srcId = String(sourcePermanentId);
            const tgtId = String((perm as any)?.id ?? (effect as any)?.id ?? '');
            if (tgtId) {
              const sourcePerm = battlefield.find((p: any) => String(p?.id) === srcId);
              const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
              const targetTL = String((perm as any)?.card?.type_line || '').toLowerCase();
              if (sourcePerm && sourceTL.includes('creature') && targetTL.includes('creature')) {
                const stateAny = state as any;
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] = stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId][tgtId] = true;
              }
            }
          } catch {
            // best-effort only
          }
        }

        (perm as any).damage = ((perm as any).damage || 0) + dmg;
        debug(2, `[resolveSpell] ${spellName} dealt ${dmg} damage to ${(perm as any).card?.name || effect.id}`);
        
        // Check for damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
        processDamageReceivedTriggers(ctx, perm, dmg, (triggerInfo) => {
          // Initialize pendingDamageTriggers if needed
          if (!state.pendingDamageTriggers) {
            state.pendingDamageTriggers = {};
          }
          
          // Add the trigger to the pending list for socket layer to process
          state.pendingDamageTriggers[triggerInfo.triggerId] = {
            sourceId: triggerInfo.sourceId,
            sourceName: triggerInfo.sourceName,
            controller: triggerInfo.controller,
            damageAmount: triggerInfo.damageAmount,
            triggerType: 'dealt_damage' as const,
            targetType: triggerInfo.targetType,
            ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
          };
          
          debug(2, `[resolveSpell] Queued damage trigger: ${triggerInfo.sourceName} was dealt ${dmg} damage`);
        });
      }
      break;
    }
    case 'DamagePlayer': {
      const players = state.players || [];
      const player = players.find((p: any) => p.id === effect.playerId);
      if (player) {
        const dmg = Math.max(0, Number((effect as any).amount ?? 0));
        const targetPlayerId = String((effect as any).playerId || '');
        if (dmg <= 0 || !targetPlayerId) break;

        (state as any).life = (state as any).life || {};
        const current = (state as any).life[targetPlayerId] ?? (player as any).life ?? 40;
        const next = current - dmg;
        (state as any).life[targetPlayerId] = next;
        (player as any).life = next;

        // Track per-turn damage/life loss for intervening-if templates.
        try {
          (state as any).damageTakenThisTurnByPlayer = (state as any).damageTakenThisTurnByPlayer || {};
          (state as any).damageTakenThisTurnByPlayer[targetPlayerId] =
            ((state as any).damageTakenThisTurnByPlayer[targetPlayerId] || 0) + dmg;
        } catch {
          /* best-effort */
        }
        try {
          (state as any).lifeLostThisTurn = (state as any).lifeLostThisTurn || {};
          (state as any).lifeLostThisTurn[targetPlayerId] = ((state as any).lifeLostThisTurn[targetPlayerId] || 0) + dmg;
        } catch {
          /* best-effort */
        }

        // Track that a creature dealt damage to a player this turn (used by intervening-if + Reciprocate-style checks).
        try {
          if (sourcePermanentId) {
            const srcId = String(sourcePermanentId);
            const battlefield = state.battlefield || [];
            const sourcePerm = battlefield.find((p: any) => String(p?.id) === srcId);
            const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
            if (sourcePerm && sourceTL.includes('creature')) {
              const creatureName = String(sourcePerm?.card?.name || 'Unknown Creature');
              (state as any).creaturesThatDealtDamageToPlayer = (state as any).creaturesThatDealtDamageToPlayer || {};
              const perPlayer = ((state as any).creaturesThatDealtDamageToPlayer[targetPlayerId] =
                (state as any).creaturesThatDealtDamageToPlayer[targetPlayerId] || {});
              perPlayer[srcId] = {
                creatureName,
                totalDamage: (perPlayer[srcId]?.totalDamage || 0) + dmg,
                lastDamageTime: Date.now(),
              };
            }
          }
        } catch {
          // best-effort only
        }

        debug(2, `[resolveSpell] ${spellName} dealt ${dmg} damage to player ${targetPlayerId}`);

        // If we have a battlefield permanent as the source of this effect, queue its damage-to-player triggers.
        try {
          if (sourcePermanentId) {
            queueDealsDamageToPlayerTriggersFromPermanent(ctx, String(sourcePermanentId), String(targetPlayerId));
          }
        } catch {
          // Defensive: do not block resolution.
        }
      }
      break;
    }
    case 'DrawCards': {
      try {
        const count = Math.max(0, Number((effect as any).count ?? 0));
        if (count > 0) {
          const drawn = drawCardsFromZone(ctx, (effect as any).playerId as PlayerID, count);
          debug(2, `[resolveSpell] ${spellName} caused ${(effect as any).playerId} to draw ${drawn.length} card(s)`);
        }
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} draw failed:`, err);
      }
      break;
    }
    case 'RequestDiscard': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      if (playerId && count > 0) {
        (state as any).pendingDiscard = (state as any).pendingDiscard || {};
        (state as any).pendingDiscard[playerId] = {
          count,
          source: spellName,
          reason: 'spell_effect',
        };
        debug(2, `[resolveSpell] ${spellName} queued discard: ${playerId} discards ${count}`);
      }
      break;
    }
    case 'AddCountersPermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === (effect as any).id);
      if (perm) {
        const counterType = String((effect as any).counterType || '').trim();
        const amount = Math.max(0, Number((effect as any).amount ?? 0));
        if (counterType && amount > 0) {
          const existingCounters = perm.counters || {};
          const current = (existingCounters as any)[counterType] || 0;
          perm.counters = {
            ...existingCounters,
            [counterType]: current + amount,
          } as any;
          debug(2, `[resolveSpell] ${spellName} added ${amount} ${counterType} counter(s) to ${(perm as any).card?.name || perm.id}`);
        }
      }
      break;
    }
    case 'CreateToken': {
      try {
        const controller = (effect as any).controller as PlayerID;
        const name = String((effect as any).name || 'Token');
        const count = Math.max(0, Number((effect as any).count ?? 0));
        const basePower = (effect as any).basePower;
        const baseToughness = (effect as any).baseToughness;
        const options = (effect as any).options;
        if (controller && count > 0) {
          createToken(ctx, controller, name, count, basePower, baseToughness, options);
          debug(2, `[resolveSpell] ${spellName} created ${count} ${name} token(s) for ${controller}`);
        }
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} createToken failed:`, err);
      }
      break;
    }
    case 'QueueScry': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const sourceId = (effect as any).sourceId as string | undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (!playerId || count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;
      try {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.SCRY,
          playerId,
          description: `${spellName}: Scry ${count}`,
          mandatory: true,
          sourceId,
          sourceName: spellName,
          scryCount: count,
        } as any);
        debug(2, `[resolveSpell] ${spellName} queued scry ${count} for ${playerId}`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue scry failed:`, err);
      }
      break;
    }
    case 'QueueSurveil': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const sourceId = (effect as any).sourceId as string | undefined;
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (!playerId || count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;
      try {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.SURVEIL,
          playerId,
          description: `${spellName}: Surveil ${count}`,
          mandatory: true,
          sourceId,
          sourceName: spellName,
          surveilCount: count,
        } as any);
        debug(2, `[resolveSpell] ${spellName} queued surveil ${count} for ${playerId}`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue surveil failed:`, err);
      }
      break;
    }
    case 'QueueBlight': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (!playerId || count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;

      const battlefield = state.battlefield || [];
      const validTargets = battlefield
        .filter((p: any) => p && String(p.controller || '') === String(playerId))
        .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Creature',
          description: p.card?.type_line || 'creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      if (validTargets.length === 0) {
        debug(2, `[resolveSpell] ${spellName} QueueBlight: ${playerId} has no creatures to blight`);
        break;
      }

      try {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId,
          description: `${spellName}: Blight ${count} — choose a creature you control to put ${count} -1/-1 counter${count === 1 ? '' : 's'} on it.`,
          mandatory: true,
          sourceName: spellName,
          validTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',

          // Consumed by the generic Blight hook in socket/resolution.ts
          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: playerId,
          keywordBlightN: count,
          keywordBlightSourceName: `${spellName}: Blight ${count}`,
        } as any);
        debug(2, `[resolveSpell] ${spellName} queued blight ${count} for ${playerId}`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue blight failed:`, err);
      }
      break;
    }
    case 'QueueBlightEachOpponent': {
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;

      const players = (state as any).players || [];
      const turnOrder: PlayerID[] = players.map((p: any) => p?.id).filter((id: any) => typeof id === 'string') as any;
      const activePlayerId: PlayerID =
        (state as any).turnPlayer ||
        (state as any).activePlayerId ||
        players[(state as any).activePlayerIndex || 0]?.id ||
        caster;

      const battlefield = state.battlefield || [];

      const configs: any[] = [];
      for (const pr of players) {
        if (!pr?.id) continue;
        if (String(pr.id) === String(caster)) continue;
        if ((pr as any).hasLost) continue;

        const validTargets = battlefield
          .filter((p: any) => p && String(p.controller || '') === String(pr.id))
          .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
          .map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Creature',
            description: p.card?.type_line || 'creature',
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

        if (validTargets.length === 0) continue;

        configs.push({
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pr.id,
          description: `${spellName}: Blight ${count} — choose a creature you control to put ${count} -1/-1 counter${count === 1 ? '' : 's'} on it.`,
          mandatory: true,
          sourceName: spellName,
          validTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          priority: 0,

          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: pr.id,
          keywordBlightN: count,
          keywordBlightSourceName: `${spellName}: Blight ${count}`,
        });
      }

      if (configs.length === 0) {
        debug(2, `[resolveSpell] ${spellName} QueueBlightEachOpponent: no opponents had creatures to blight`);
        break;
      }

      try {
        ResolutionQueueManager.addStepsWithAPNAP(gameId, configs as any, turnOrder as any, activePlayerId as any);
        debug(2, `[resolveSpell] ${spellName} queued blight ${count} for ${configs.length} opponent(s)`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue blight(each opponent) failed:`, err);
      }

      break;
    }
    case 'QueueBlightEachPlayer': {
      const count = Math.max(0, Number((effect as any).count ?? 0));
      const gameId = (ctx as any).gameId;
      const isReplaying = !!(ctx as any).isReplaying;
      if (count <= 0 || !gameId || gameId === 'unknown' || isReplaying) break;

      const players = (state as any).players || [];
      const turnOrder: PlayerID[] = players.map((p: any) => p?.id).filter((id: any) => typeof id === 'string') as any;
      const activePlayerId: PlayerID =
        (state as any).turnPlayer ||
        (state as any).activePlayerId ||
        players[(state as any).activePlayerIndex || 0]?.id ||
        caster;

      const battlefield = state.battlefield || [];

      const configs: any[] = [];
      for (const pr of players) {
        if (!pr?.id) continue;
        if ((pr as any).hasLost) continue;

        const validTargets = battlefield
          .filter((p: any) => p && String(p.controller || '') === String(pr.id))
          .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
          .map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Creature',
            description: p.card?.type_line || 'creature',
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

        if (validTargets.length === 0) continue;

        configs.push({
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pr.id,
          description: `${spellName}: Blight ${count} — choose a creature you control to put ${count} -1/-1 counter${count === 1 ? '' : 's'} on it.`,
          mandatory: true,
          sourceName: spellName,
          validTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          priority: 0,

          keywordBlight: true,
          keywordBlightStage: 'select_target',
          keywordBlightController: pr.id,
          keywordBlightN: count,
          keywordBlightSourceName: `${spellName}: Blight ${count}`,
        });
      }

      if (configs.length === 0) {
        debug(2, `[resolveSpell] ${spellName} QueueBlightEachPlayer: no players had creatures to blight`);
        break;
      }

      try {
        ResolutionQueueManager.addStepsWithAPNAP(gameId, configs as any, turnOrder as any, activePlayerId as any);
        debug(2, `[resolveSpell] ${spellName} queued blight ${count} for ${configs.length} player(s)`);
      } catch (err) {
        debugWarn(1, `[resolveSpell] ${spellName} queue blight(each player) failed:`, err);
      }

      break;
    }
    case 'MillCards': {
      const playerId = (effect as any).playerId as PlayerID;
      const count = Math.max(0, Number((effect as any).count ?? 0));
      if (!playerId || count <= 0) break;

      const { finalCount } = applyMillReplacements(ctx, count, String(caster), String(playerId));
      const millCount = Math.max(0, Number(finalCount ?? count));
      if (millCount <= 0) break;

      const ctxLibraries = (ctx as any).libraries as Map<string, any[]> | undefined;
      let lib: any[] | undefined;
      if (ctxLibraries && typeof ctxLibraries.get === 'function') {
        lib = ctxLibraries.get(playerId);
      }

      const zones = (state as any).zones || ((state as any).zones = {});
      const z = (zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

      if (lib && Array.isArray(lib)) {
        for (let i = 0; i < millCount && lib.length > 0; i++) {
          const milled = lib.shift();
          if (milled) {
            z.graveyard.push({ ...milled, zone: 'graveyard' });
            recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), milled, { fromBattlefield: false });

            // Check for graveyard triggers (e.g., Eldrazi shuffle).
            try {
              checkGraveyardTrigger(ctx, milled, String(playerId));
            } catch {
              // best-effort
            }
          }
        }
        if (ctxLibraries && typeof ctxLibraries.set === 'function') {
          ctxLibraries.set(playerId, lib);
        }
        z.libraryCount = lib.length;
        z.graveyardCount = z.graveyard.length;
        ctx.bumpSeq();
        debug(2, `[resolveSpell] ${spellName} milled ${millCount} card(s) for ${playerId}`);
      }
      break;
    }
    case 'GoadPermanent': {
      const id = String((effect as any).id || '');
      const goaderId = (effect as any).goaderId as PlayerID;
      if (!id || !goaderId) break;
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === id);
      if (idx < 0) break;
      const currentTurn = Number((state as any).turnNumber ?? 0) || 0;
      const expiryTurn = currentTurn + 1;
      const updated = applyGoadToCreature(battlefield[idx] as any, goaderId, expiryTurn);
      battlefield[idx] = updated as any;
      ctx.bumpSeq();
      debug(2, `[resolveSpell] ${spellName} goaded ${(updated as any).card?.name || id} (by ${goaderId})`);
      break;
    }
    case 'CounterSpell': {
      // Counter a spell on the stack and move it to its controller's graveyard
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const controller = (countered as any).controller;
        const counteredCardName = (countered as any).card?.name || 'spell';
        
        // Move the countered spell's card to the controller's graveyard
        if ((countered as any).card && controller) {
          const zones = ctx.state.zones = ctx.state.zones || {};
          zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
          gy.push({ ...(countered as any).card, zone: 'graveyard' });
          (zones[controller] as any).graveyardCount = gy.length;
        }
        
        debug(2, `[resolveSpell] ${spellName} countered ${counteredCardName}`);
      }
      break;
    }
    case 'CounterAbility': {
      // Counter an ability on the stack (activated or triggered)
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const abilityDesc = (countered as any).description || (countered as any).ability?.text || 'ability';
        debug(2, `[resolveSpell] ${spellName} countered ${abilityDesc}`);
        // Abilities don't go anywhere when countered - they just cease to exist
      }
      break;
    }
    case 'Broadcast': {
      debug(2, `[resolveSpell] ${effect.message}`);
      break;
    }
  }
}

function queueDealsDamageToPlayerTriggersFromPermanent(
  ctx: GameContext,
  sourcePermanentId: string,
  damagedPlayerId: string
): void {
  const state = (ctx as any).state;
  const battlefield = state?.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p?.id === sourcePermanentId);
  if (!sourcePerm?.card) return;

  const triggers = detectCombatDamageTriggers(sourcePerm.card, sourcePerm);
  const damageToPlayerTriggers = triggers.filter((t: any) => t?.triggerType === 'deals_damage' && !t?.batched);
  if (damageToPlayerTriggers.length === 0) return;

  state.stack = state.stack || [];

  for (const trigger of damageToPlayerTriggers) {
    const text = String(trigger.description || trigger.effect || '').trim();
    if (!text) continue;

    // Intervening-if at trigger time (CR 603.4).
    try {
      const synthetic = `Whenever ~ deals damage to a player, ${text}`;
      const needsThatPlayerRef = /\bthat player\b/i.test(synthetic);

      // Some intervening-if templates need to know the damage source(s) (e.g.,
      // "if any of that damage was dealt by a Warrior"). For this trigger family,
      // the damage source is always the same as the trigger source.
      const sourceTypeLine = String(sourcePerm?.card?.type_line || '').toLowerCase();
      const damageIncludedWarriorSource = typeLineHasAllWords(sourceTypeLine, 'warrior');
      const damageSourcePermanentIds = [String(sourcePerm.id)];

      const refs: any = {
        damageSourcePermanentIds,
        damageSourceCreatureIds: damageSourcePermanentIds,
        damageSourceIds: damageSourcePermanentIds,
        damageIncludedWarriorSource,
      };
      if (needsThatPlayerRef) {
        refs.thatPlayerId = String(damagedPlayerId);
        refs.referencedPlayerId = String(damagedPlayerId);
        refs.theirPlayerId = String(damagedPlayerId);
      }
      const ok = isInterveningIfSatisfied(
        ctx as any,
        String(sourcePerm.controller),
        synthetic,
        sourcePerm,
        refs
      );
      if (ok === false) continue;
    } catch {
      // Conservative fallback: keep the trigger.
    }

    state.stack.push({
      id: uid('trigger'),
      type: 'triggered_ability',
      controller: sourcePerm.controller,
      source: sourcePerm.id,
      permanentId: sourcePerm.id,
      sourceName: sourcePerm.card?.name || trigger.cardName,
      description: text,
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      effect: trigger.effect || text,
      targets: [],
      targetPlayer: String(damagedPlayerId),
      defendingPlayer: String(damagedPlayerId),
      // Persist damage-source context so resolution-time intervening-if checks can
      // be deterministic for templates like "if any of that damage was dealt by a Warrior".
      damageSourcePermanentIds: [String(sourcePerm.id)],
      damageIncludedWarriorSource: typeLineHasAllWords(String(sourcePerm?.card?.type_line || '').toLowerCase(), 'warrior'),
      card: sourcePerm.card,
    } as any);
  }
}

/**
 * Check if a spell grants an extra turn
 * Handles cards like: Time Warp, Time Walk, Temporal Mastery, Nexus of Fate,
 * Alrund's Epiphany, Karn's Temporal Sundering, etc.
 */
function isExtraTurnSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known extra turn spell names
  const extraTurnSpells = new Set([
    'time warp',
    'time walk',
    'temporal mastery',
    'nexus of fate',
    'expropriate',
    "alrund's epiphany",
    "karn's temporal sundering",
    'temporal manipulation',
    'time stretch',
    'beacon of tomorrows',
    'capture of jingzhou',
    'temporal trespass',
    'walk the aeons',
    'savor the moment',
    'final fortune',
    "warrior's oath",
    'last chance',
    'chance for glory',
    'medomai the ageless',
    'magistrate\'s scepter',
    'part the waterveil',
    'lighthouse chronologist',
    'wanderwine prophets',
    'emrakul, the promised end',
    'ugin\'s nexus',
    'sage of hours',
    'notorious throng',
  ]);
  
  if (extraTurnSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Take an extra turn" or "takes an extra turn" are the common patterns
  if (oracleTextLower.includes('take an extra turn') ||
      oracleTextLower.includes('takes an extra turn') ||
      oracleTextLower.includes('extra turn after this one')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a spell is a Join Forces spell
 * 
 * Join Forces cards (as of current sets):
 * - Alliance of Arms
 * - Collective Voyage  
 * - Mana-Charged Dragon (triggered ability when attacking, not a spell)
 * - Minds Aglow
 * - Shared Trauma
 * 
 * Join Forces spells have "Join forces — Starting with you, each player may pay any amount of mana"
 */
function isJoinForcesSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known Join Forces spell names (excluding Mana-Charged Dragon which is a triggered ability, not a spell effect)
  const joinForcesSpells = new Set([
    "minds aglow",
    "collective voyage",
    "alliance of arms",
    "shared trauma",
  ]);
  
  if (joinForcesSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Join forces" is the keyword ability
  // Pattern: "Join forces — Starting with you, each player may pay any amount of mana"
  if (oracleTextLower.includes('join forces') &&
      oracleTextLower.includes('starting with you') && 
      oracleTextLower.includes('each player may pay')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a spell is a Tempting Offer spell
 * 
 * Tempting Offer cards (as of current sets):
 * - Tempt with Discovery (search for land)
 * - Tempt with Glory (+1/+1 counters)
 * - Tempt with Immortality (reanimate)
 * - Tempt with Reflections (clone)
 * - Tempt with Vengeance (create tokens)
 * 
 * Tempting Offer pattern: "Tempting offer — [effect]. Each opponent may [accept]. 
 * For each opponent who does, [bonus for caster]"
 */
function isTemptingOfferSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known Tempting Offer spell names (all 7 cards)
  const temptingOfferSpells = new Set([
    "tempt with bunnies",      // Create rabbit tokens
    "tempt with discovery",    // Search for land
    "tempt with glory",        // +1/+1 counters
    "tempt with immortality",  // Reanimate
    "tempt with mayhem",       // Deal damage / goad
    "tempt with reflections",  // Clone
    "tempt with vengeance",    // Create elemental tokens
  ]);
  
  if (temptingOfferSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Tempting offer" is the keyword ability
  if (oracleTextLower.includes('tempting offer')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a spell is a Ponder-style spell
 * 
 * Ponder-style cards (look at top N, reorder, optionally shuffle, then draw):
 * - Ponder: Look at top 3, put back in any order, may shuffle, draw 1
 * - Preordain: Scry 2, then draw (different mechanic, not Ponder-style)
 * - Index: Look at top 5, put back in any order (no shuffle, no draw)
 * - Sage Owl: ETB look at top 4, put back in any order
 * - Mystic Speculation: Look at top 3, put back in any order (buyback)
 * - Telling Time: Look at top 3, put 1 in hand, rest back in any order
 * - Serum Visions: Draw 1, scry 2 (not Ponder-style)
 * 
 * Pattern: "Look at the top N cards of your library" + "put them back in any order"
 */
function isPonderStyleSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known Ponder-style spell names
  const ponderStyleSpells = new Set([
    "ponder",
    "index",
    "mystic speculation",
    "telling time",
    "sage of epityr",
    "halimar depths",
  ]);
  
  if (ponderStyleSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text pattern
  // Must have both "look at the top" and "put them back in any order"
  if (oracleTextLower.includes('look at the top') && 
      oracleTextLower.includes('put them back in any order')) {
    return true;
  }
  
  return false;
}

/**
 * Get configuration for a Ponder-style effect
 */
function getPonderConfig(cardName: string, oracleTextLower: string): {
  cardCount: number;
  variant: 'ponder' | 'index' | 'telling_time' | 'brainstorm' | 'architects';
  canShuffle: boolean;
  drawAfter: boolean;
  pickToHand: number;
} {
  const nameLower = (cardName || '').toLowerCase();
  
  // Type alias for variant
  type PonderVariant = 'ponder' | 'index' | 'telling_time' | 'brainstorm' | 'architects';
  
  // Default config
  let config: {
    cardCount: number;
    variant: PonderVariant;
    canShuffle: boolean;
    drawAfter: boolean;
    pickToHand: number;
  } = {
    cardCount: 3,
    variant: 'ponder',
    canShuffle: false,
    drawAfter: false,
    pickToHand: 0,
  };
  
  // Ponder: Look at top 3, may shuffle, draw 1
  if (nameLower === 'ponder') {
    config = {
      cardCount: 3,
      variant: 'ponder',
      canShuffle: true,
      drawAfter: true,
      pickToHand: 0,
    };
  }
  // Index: Look at top 5, put back in any order (no shuffle, no draw)
  else if (nameLower === 'index') {
    config = {
      cardCount: 5,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  }
  // Telling Time: Look at top 3, put 1 in hand, rest on top
  else if (nameLower === 'telling time') {
    config = {
      cardCount: 3,
      variant: 'telling_time',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 1,
    };
  }
  // Mystic Speculation: Look at top 3, put back in any order
  else if (nameLower === 'mystic speculation') {
    config = {
      cardCount: 3,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  }
  // Halimar Depths: Look at top 3, put back in any order
  else if (nameLower === 'halimar depths') {
    config = {
      cardCount: 3,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  }
  // Generic detection
  else {
    // Try to extract card count from oracle text
    const topMatch = oracleTextLower.match(/look at the top (\d+|three|four|five|six|seven)/i);
    if (topMatch) {
      const numWords: Record<string, number> = { 
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10 
      };
      config.cardCount = numWords[topMatch[1].toLowerCase()] || parseInt(topMatch[1], 10) || 3;
    }
    
    // Check for shuffle option
    if (oracleTextLower.includes('may shuffle')) {
      config.canShuffle = true;
    }
    
    // Check for draw after
    if (oracleTextLower.includes('draw a card') || oracleTextLower.includes('draw 1 card')) {
      config.drawAfter = true;
    }
  }
  
  return config;
}

/**
 * Create a token creature (helper for Beast Within and similar)
 */
function createBeastToken(ctx: GameContext, controller: PlayerID, name: string, power: number, toughness: number, color?: string): void {
  // Determine creature type from name (e.g., "Beast Token" -> "Beast")
  const creatureType = name.replace(/\s*Token\s*/i, '').trim() || 'Beast';
  const typeLine = `Token Creature — ${creatureType}`;

  // Map color names to MTG color letters
  const colorMap: Record<string, string> = {
    'white': 'W', 'w': 'W',
    'blue': 'U', 'u': 'U',  // Blue is U, not B!
    'black': 'B', 'b': 'B',
    'red': 'R', 'r': 'R',
    'green': 'G', 'g': 'G',
    'colorless': 'C', 'c': 'C',
  };
  const lowerColor = (color || 'green').toLowerCase();
  const colorLetter = colorMap[lowerColor] || colorMap[lowerColor.charAt(0)] || 'G';
  const colorLetters = [colorLetter];

  createToken(
    ctx as any,
    controller,
    name,
    1,
    power,
    toughness,
    {
      colors: colorLetters,
      typeLine,
    }
  );

  debug(2, `[resolveSpell] Created ${power}/${toughness} ${color || 'green'} ${name} token for ${controller}`);
}

/**
 * Token creation specification parsed from oracle text
 */
interface TokenSpec {
  count: number;
  power: number;
  toughness: number;
  name: string;
  typeLine: string;
  colors?: string[];
}

/**
 * Calculate token doubling multiplier from battlefield effects
 * Checks for effects like Anointed Procession, Doubling Season, Parallel Lives, Ojer Taq, Elspeth, etc.
 */
function getTokenDoublerMultiplier(controller: PlayerID, state: any): number {
  let multiplier = 1;
  const battlefield = state.battlefield || [];
  
  for (const perm of battlefield) {
    const permName = (perm.card?.name || '').toLowerCase();
    const permOracle = (perm.card?.oracle_text || '').toLowerCase();

    // Primal Vigor is global (applies regardless of controller)
    if (permName.includes('primal vigor')) {
      multiplier *= 2;
      continue;
    }

    if (perm.controller !== controller) continue;
    
    // Ojer Taq, Deepest Foundation: "If one or more creature tokens would be created under your control, three times that many of those tokens are created instead."
    // This is a 3x multiplier and it STACKS with other token multipliers.
    if (permName.includes('ojer taq') ||
        (permOracle.includes('three times that many') && permOracle.includes('token'))) {
      multiplier *= 3;
    }
    
    // Anointed Procession: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead."
    // Parallel Lives: "If an effect would create one or more creature tokens under your control, it creates twice that many of those tokens instead."
    // Doubling Season: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead."
    // Elspeth, Sun's Champion / Elspeth, Storm Slayer: "If one or more tokens would be created under your control, twice that many of those tokens are created instead."
    // Mondrak, Glory Dominus: Same effect
    // Primal Vigor: Affects all players but still doubles tokens
    // Adrix and Nev, Twincasters: "If one or more tokens would be created under your control, twice that many of those tokens are created instead."
    if (permName.includes('anointed procession') ||
        permName.includes('parallel lives') ||
        permName.includes('doubling season') ||
        permName.includes('mondrak, glory dominus') ||
        permName.includes('adrix and nev') ||
        (permName.includes('elspeth') && permOracle.includes('twice that many')) ||
        (permOracle.includes('twice that many') && permOracle.includes('token'))) {
      multiplier *= 2;
    }
  }
  
  return multiplier;
}

/**
 * Parse token creation from spell oracle text
 * Handles patterns like:
 * - "Create two 1/1 blue Merfolk Wizard creature tokens"
 * - "Create X 2/2 green Wolf creature tokens"
 * - "Create a 3/3 green Beast creature token"
 * 
 * For cards like Summon the School that have conditions (e.g., "equal to the number of Merfolk you control"),
 * we count the relevant permanents on the battlefield.
 * 
 * @param xValue - Optional value of X for X spells like Secure the Wastes
 */
function parseTokenCreation(cardName: string, oracleTextLower: string, controller: PlayerID, state: any, xValue?: number): TokenSpec | null {
  // Skip if this doesn't create tokens for the caster
  if (!oracleTextLower.includes('create') || !oracleTextLower.includes('token')) {
    return null;
  }
  
  // Skip "its controller creates" patterns (handled separately for spells like Beast Within)
  if (oracleTextLower.includes('its controller creates')) {
    return null;
  }
  
  const nameLower = (cardName || '').toLowerCase();
  
  // Special handling for known cards
  // Summon the School: "Create two 1/1 blue Merfolk Wizard creature tokens."
  // (The tap four Merfolk ability is a separate activated ability to return it from graveyard)
  if (nameLower.includes('summon the school')) {
    return {
      count: 2,
      power: 1,
      toughness: 1,
      name: 'Merfolk Wizard',
      typeLine: 'Token Creature — Merfolk Wizard',
      colors: ['blue'],
    };
  }
  
  // Generic token creation parsing
  // Pattern: "create (a|one|two|three|four|five|X|number) P/T [color] [type] creature token(s)"
  const tokenPatterns = [
    // "create two 1/1 blue Merfolk Wizard creature tokens"
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+(?:\s+\w+)*)\s+creature\s+tokens?/i,
    // "create a 3/3 green Beast creature token"
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+)\s+(\w+)\s+creature\s+tokens?/i,
  ];
  
  for (const pattern of tokenPatterns) {
    const match = oracleTextLower.match(pattern);
    if (match) {
      const countWord = match[1].toLowerCase();
      let count = 1;
      
      // Parse count word
      const wordToNumber: Record<string, number> = {
        'a': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      };
      
      if (wordToNumber[countWord]) {
        count = wordToNumber[countWord];
      } else if (/^\d+$/.test(countWord)) {
        count = parseInt(countWord, 10);
      } else if (countWord === 'x') {
        // Use the provided xValue from the spell cast, default to 1 if not provided
        count = xValue !== undefined && xValue >= 0 ? xValue : 1;
      }
      
      const power = parseInt(match[2], 10);
      const toughness = parseInt(match[3], 10);
      const typeInfo = match[4]; // Could be "blue Merfolk Wizard" or just "Beast"
      
      // Extract color and creature type from typeInfo
      const colors = ['white', 'blue', 'black', 'red', 'green'];
      const foundColors: string[] = [];
      let creatureType = typeInfo;
      
      for (const color of colors) {
        if (typeInfo.toLowerCase().includes(color)) {
          foundColors.push(color);
          creatureType = creatureType.replace(new RegExp(color, 'gi'), '').trim();
        }
      }
      
      // Also check for colorless
      if (typeInfo.toLowerCase().includes('colorless')) {
        creatureType = creatureType.replace(/colorless/gi, '').trim();
      }
      
      return {
        count,
        power,
        toughness,
        name: creatureType || 'Token',
        typeLine: `Token Creature — ${creatureType || 'Token'}`,
        colors: foundColors.length > 0 ? foundColors : undefined,
      };
    }
  }
  
  return null;
}

/**
 * Create a token from a TokenSpec
 */
function createTokenFromSpec(ctx: GameContext, controller: PlayerID, spec: TokenSpec): void {
  createToken(
    ctx as any,
    controller,
    spec.name,
    spec.count,
    spec.power,
    spec.toughness,
    {
      colors: spec.colors,
      typeLine: spec.typeLine,
    }
  );
}

/**
 * Create a Treasure token on the battlefield
 * Treasure tokens have: "{T}, Sacrifice this artifact: Add one mana of any color."
 */
function createTreasureToken(ctx: GameContext, controller: PlayerID): void {
  createToken(
    ctx as any,
    controller,
    'Treasure',
    1,
    undefined,
    undefined,
    {
      colors: [],
      typeLine: 'Token Artifact — Treasure',
      abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
      isArtifact: true,
    }
  );
}

/* Place a land onto the battlefield for a player (simplified) */
export function playLand(ctx: GameContext, playerId: PlayerID, cardOrId: any) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  let playedFromExile = false;
  let playedFromGraveyard = false;
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the battlefield (idempotency for replay)
  if (cardId && Array.isArray(state.battlefield)) {
    const alreadyOnBattlefield = state.battlefield.some(
      (p: any) => p?.card?.id === cardId && p?.controller === playerId
    );
    if (alreadyOnBattlefield) {
      debug(1, `playLand: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
      return;
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      debugWarn(2, `playLand: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      debugWarn(2, `playLand: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c && c.id === cardOrId);
    if (idx !== -1) {
      // Remove card from hand
      card = handCards.splice(idx, 1)[0];
      z.handCount = handCards.length;
    } else {
      // Fallback: allow playing lands from exile when an effect permits it.
      const exileCards = Array.isArray((z as any).exile) ? ((z as any).exile as any[]) : null;
      const exIdx = exileCards ? exileCards.findIndex((c: any) => c && c.id === cardOrId) : -1;
      if (exileCards && exIdx !== -1) {
        card = exileCards.splice(exIdx, 1)[0];
        (z as any).exileCount = exileCards.length;
        playedFromExile = true;
      } else {
        // Fallback: allow playing lands from graveyard when an effect permits it (e.g., Crucible of Worlds).
        // Socket layer validates permission; we double-check as a sanity guard.
        const hasGraveyardLandPermission = Array.isArray((state as any).landPlayPermissions?.[playerId])
          ? (state as any).landPlayPermissions[playerId].includes('graveyard')
          : false;
        const gyCards = Array.isArray((z as any).graveyard) ? ((z as any).graveyard as any[]) : null;
        const gyIdx = gyCards ? gyCards.findIndex((c: any) => c && c.id === cardOrId) : -1;
        if (hasGraveyardLandPermission && gyCards && gyIdx !== -1) {
          card = gyCards.splice(gyIdx, 1)[0];
          (z as any).graveyardCount = gyCards.length;
          playedFromGraveyard = true;
        } else {
          // During replay, card might not be in its expected zone anymore - this is okay
          debug(1, `playLand: card ${cardOrId} not found in expected zone(s) for player ${playerId} (may be replay)`);
          return;
        }
      }
    }
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      debugWarn(2, `playLand: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }

    // Also try to remove from exile if it exists there (e.g., replay or exile-cast flows).
    if (z && Array.isArray((z as any).exile)) {
      const exileCards = (z as any).exile as any[];
      const exIdx = exileCards.findIndex((c: any) => c && c.id === card.id);
      if (exIdx !== -1) {
        exileCards.splice(exIdx, 1);
        (z as any).exileCount = exileCards.length;
        playedFromExile = true;
      }
    }

    // Also try to remove from graveyard if it exists there (e.g., Conduit/Crucible flows or replay).
    if (z && Array.isArray((z as any).graveyard)) {
      const gyCards = (z as any).graveyard as any[];
      const gyIdx = gyCards.findIndex((c: any) => c && c.id === card.id);
      if (gyIdx !== -1) {
        gyCards.splice(gyIdx, 1);
        (z as any).graveyardCount = gyCards.length;
        playedFromGraveyard = true;
      }
    }
  }
  
  const tl = (card.type_line || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isLand = /\bland\b/.test(tl);
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  
  // Check if the permanent has haste from any source (own text or battlefield effects)
  // Rule 702.10: Haste allows ignoring summoning sickness
  const battlefield = state.battlefield || [];
  const hasHaste = isCreature && creatureWillHaveHaste(card, playerId, battlefield);
  
  // Rule 302.6: Summoning sickness applies to CREATURES (including creature lands like Dryad Arbor)
  // - A pure land (not a creature) does NOT have summoning sickness
  // - A "Land Creature" like Dryad Arbor DOES have summoning sickness because it's a creature
  // - If a land becomes a creature later (via animation), it would need to be checked at that time
  const hasSummoningSickness = isCreature && !hasHaste;
  
  // Check if land enters tapped based on oracle text
  // This handles lands like Emeria, the Sky Ruin, Temples, Guildgates, etc.
  const oracleText = card.oracle_text || '';
  const etbTappedStatus = detectETBTappedPattern(oracleText);
  
  let shouldEnterTapped = false;
  
  if (isLand) {
    if (etbTappedStatus === 'always') {
      // Unconditional ETB tapped (temples, guildgates, etc.)
      shouldEnterTapped = true;
      debug(2, `[playLand] ${card.name || 'Land'} enters tapped (ETB-tapped pattern detected)`);
    } else if (etbTappedStatus === 'conditional') {
      // Conditional ETB tapped - evaluate based on board state
      // Count other lands controlled by this player
      const otherLandCount = battlefield.filter((p: any) => {
        if (p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        return typeLine.includes('land');
      }).length;
      
      // Count BASIC lands specifically for battle lands (BFZ tango lands)
      // Also track land subtypes for check lands
      const controlledLandTypes: string[] = [];
      let basicLandCount = 0;
      for (const p of battlefield) {
        if (p.controller !== playerId) continue;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        
        // Check if this is a basic land (has "basic" in the type line)
        if (typeLine.includes('basic')) {
          basicLandCount++;
        }
        
        const subtypes = getLandSubtypes(typeLine);
        controlledLandTypes.push(...subtypes);
      }
      
      // Check oracle text for the specific conditional pattern
      const oracleTextLower = oracleText.toLowerCase();
      const hasBattleLandPattern = oracleTextLower.includes('two or more basic lands');
      
      // Count opponents (other players in the game, excluding the current player)
      const allPlayers = state.players || [];
      const opponentCount = allPlayers.filter((p: any) => p.id !== playerId).length;
      
      if (hasBattleLandPattern) {
        // Battle land (BFZ tango land) - check basic land count
        shouldEnterTapped = basicLandCount < 2;
        debug(2, `[playLand] ${card.name || 'Land'} battle land check: ${basicLandCount} basic lands - enters ${shouldEnterTapped ? 'tapped' : 'untapped'}`);
      } else {
        // Get controlled permanents (for legendary creature check, etc.)
        const controlledPermanents = battlefield.filter((p: any) => p.controller === playerId);
        
        // Use general conditional evaluation for check lands, fast lands, slow lands, etc.
        const evaluation = evaluateConditionalLandETB(
          oracleText,
          otherLandCount,
          controlledLandTypes,
          undefined,  // cardsInHand - not needed for these land types
          basicLandCount,  // Pass basic land count for battle lands if they reach this code path
          opponentCount,    // Pass opponent count for Luxury Suite and similar lands
          controlledPermanents  // Pass controlled permanents for legendary creature check
        );
        shouldEnterTapped = evaluation.shouldEnterTapped;
        debug(2, `[playLand] ${card.name || 'Land'} conditional ETB: ${evaluation.reason}`);
      }
    }
  }
  
  state.battlefield = state.battlefield || [];
  state.battlefield.push({
    id: uid("perm"),
    controller: playerId,
    owner: playerId,
    tapped: shouldEnterTapped,  // ETB tapped lands enter tapped
    counters: {},
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: { ...card, zone: "battlefield" },
  } as any);
  state.landsPlayedThisTurn = state.landsPlayedThisTurn || {};
  state.landsPlayedThisTurn[playerId] = (state.landsPlayedThisTurn[playerId] ?? 0) + 1;
  
  // Check for ETB triggers on the land (e.g., Wind-Scarred Crag "you gain 1 life")
  // Get the newly created permanent from the battlefield
  const newPermanent = state.battlefield[state.battlefield.length - 1];
  try {
    const etbTriggers = getETBTriggersForPermanent(card, newPermanent);
    
    if (etbTriggers.length > 0) {
      debug(2, `[playLand] Found ${etbTriggers.length} ETB trigger(s) for ${card.name || 'land'}`);
      
      // Put ETB triggers on the stack
      state.stack = state.stack || [];
      for (const trigger of etbTriggers) {
        // Skip "sacrifice unless pay" triggers - those are handled separately via prompts
        if (trigger.triggerType === 'etb_sacrifice_unless_pay') {
          continue;
        }

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          const desc = String(trigger.description || trigger.effect || '').trim();
          let textForEval = desc;
          if (textForEval && !/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `When ~ enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(playerId),
            textForEval,
            newPermanent,
            /\bthat player\b/i.test(textForEval)
              ? {
                  thatPlayerId: String(playerId),
                  referencedPlayerId: String(playerId),
                  theirPlayerId: String(playerId),
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[playLand] Skipping land ETB trigger due to unmet intervening-if: ${card.name || 'Land'} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        // Push trigger onto the stack as a triggered_ability (not etb-trigger)
        // This ensures it's properly handled in resolveTopOfStack without going to graveyard
        state.stack.push({
          id: uid("trigger"),
          type: 'triggered_ability',
          controller: playerId,
          source: newPermanent.id,
          permanentId: newPermanent.id,
          sourceName: card.name || 'Land',
          description: trigger.description || trigger.effect || '',
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory !== false, // Default to true
          effect: trigger.effect || trigger.description || '',
          requiresChoice: trigger.requiresChoice,
          targets: [],
        } as any);
        
        debug(2, `[playLand] Pushed ETB trigger to stack: ${trigger.description || trigger.effect}`);
      }
    }
  } catch (err) {
    debugWarn(1, '[playLand] Failed to check ETB triggers:', err);
  }
  
  // ========================================================================
  // LANDFALL TRIGGERS: Check for and process landfall triggers
  // This is CRITICAL - landfall triggers should fire when a land ETBs
  // ========================================================================
  try {
    const landfallTriggers = getLandfallTriggers(ctx, playerId);
    if (landfallTriggers.length > 0) {
      debug(2, `[playLand] Found ${landfallTriggers.length} landfall trigger(s) for player ${playerId}`);
      
      // Initialize stack if needed
      state.stack = state.stack || [];
      
      // Push each landfall trigger onto the stack
      for (const trigger of landfallTriggers) {
        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        // Landfall triggers are sourced from existing permanents; use that permanent as source context.
        try {
          const sourcePerm = state.battlefield?.find((p: any) => p?.id === trigger.permanentId);
          const raw = String(trigger.effect || '').trim();
          let text = raw;
          if (text && !/^(?:when|whenever|at)\b/i.test(text)) {
            text = `Whenever a land enters the battlefield under your control, ${text}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(playerId),
            text,
            sourcePerm,
            /\bthat player\b/i.test(text)
              ? {
                  thatPlayerId: String(playerId),
                  referencedPlayerId: String(playerId),
                  theirPlayerId: String(playerId),
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[playLand] Skipping landfall trigger due to unmet intervening-if: ${trigger.cardName} - ${text}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }

        const triggerId = uid("trigger");
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: playerId,
          source: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          description: `Landfall - ${trigger.effect}`,
          triggerType: 'landfall',
          mandatory: trigger.mandatory,
          effect: trigger.effect,
          requiresChoice: trigger.requiresChoice,
          // Include target requirement info for triggers like Geode Rager
          requiresTarget: trigger.requiresTarget,
          targetType: trigger.targetType,
          // Modal options for choose X triggers
          isModal: trigger.isModal,
          modalOptions: trigger.modalOptions,
        } as any);
        debug(2, `[playLand] ⚡ Pushed landfall trigger onto stack: ${trigger.cardName} - ${trigger.effect}${trigger.requiresTarget ? ` (requires ${trigger.targetType} target)` : ''}`);
      }
    }
  } catch (err) {
    debugWarn(1, '[playLand] Failed to process landfall triggers:', err);
  }
  
  // ========================================================================
  // UPDATE LAND PLAY PERMISSIONS: Check if this permanent grants graveyard land playing
  // This handles Crucible of Worlds, Conduit of Worlds, and ~19 other cards
  // ========================================================================
  try {
    updateLandPlayPermissions(ctx as any, playerId);
  } catch (err) {
    debugWarn(1, '[playLand] Failed to update land play permissions:', err);
  }
  
  // Recalculate player effects when lands ETB (some lands might have effects)
  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    debugWarn(1, '[playLand] Failed to recalculate player effects:', err);
  }

  // Turn-tracking for intervening-if templates: "if you (didn't) play a card from exile this turn".
  if (playedFromExile) {
    try {
      const stateAny = state as any;
      stateAny.playedCardFromExileThisTurn = stateAny.playedCardFromExileThisTurn || {};
      stateAny.playedCardFromExileThisTurn[String(playerId)] = true;

      // Alias tracking used by some best-effort intervening-if templates.
      stateAny.playedFromExileThisTurn = stateAny.playedFromExileThisTurn || {};
      stateAny.playedFromExileThisTurn[String(playerId)] = true;
      stateAny.cardsPlayedFromExileThisTurn = stateAny.cardsPlayedFromExileThisTurn || {};
      stateAny.cardsPlayedFromExileThisTurn[String(playerId)] = (stateAny.cardsPlayedFromExileThisTurn[String(playerId)] || 0) + 1;

      // More specific per-turn tracking (for "played a land ... other than your hand" templates).
      stateAny.playedLandFromExileThisTurn = stateAny.playedLandFromExileThisTurn || {};
      stateAny.playedLandFromExileThisTurn[String(playerId)] = true;
    } catch {
      // best-effort only
    }
  }

  if (playedFromGraveyard) {
    try {
      const stateAny = state as any;
      stateAny.playedLandFromGraveyardThisTurn = stateAny.playedLandFromGraveyardThisTurn || {};
      stateAny.playedLandFromGraveyardThisTurn[String(playerId)] = true;
    } catch {
      // best-effort only
    }
  }
  
  bumpSeq();
}

/**
 * Cast a spell from hand onto the stack.
 * 
 * @param ctx - Game context
 * @param playerId - Player casting the spell
 * @param cardOrId - Either a card ID string or a card object
 * @param targets - Optional array of target IDs
 */
export function castSpell(
  ctx: GameContext, 
  playerId: PlayerID, 
  cardOrId: any,
  targets?: any[],
  xValue?: number
) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  let castFromExile = false;
  let castFromGraveyard = false;
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the stack or battlefield (idempotency for replay)
  if (cardId) {
    if (Array.isArray(state.stack)) {
      const alreadyOnStack = state.stack.some(
        (s: any) => s?.card?.id === cardId && s?.controller === playerId
      );
      if (alreadyOnStack) {
        debug(1, `castSpell: card ${cardId} already on stack for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
    if (Array.isArray(state.battlefield)) {
      const alreadyOnBattlefield = state.battlefield.some(
        (p: any) => p?.card?.id === cardId && p?.controller === playerId
      );
      if (alreadyOnBattlefield) {
        debug(1, `castSpell: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      debugWarn(2, `castSpell: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      debugWarn(2, `castSpell: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c && c.id === cardOrId);
    if (idx !== -1) {
      // Remove card from hand
      card = handCards.splice(idx, 1)[0];
      z.handCount = handCards.length;
    } else {
      // Fallback: allow casting spells from exile when an effect permits it.
      const exileCards = Array.isArray((z as any).exile) ? ((z as any).exile as any[]) : null;
      const exIdx = exileCards ? exileCards.findIndex((c: any) => c && c.id === cardOrId) : -1;
      if (exileCards && exIdx !== -1) {
        card = exileCards.splice(exIdx, 1)[0];
        (z as any).exileCount = exileCards.length;
        castFromExile = true;
      } else {
        // Fallback: allow casting spells from graveyard when an effect permits it (flashback, etc.).
        const gyCards = Array.isArray((z as any).graveyard) ? ((z as any).graveyard as any[]) : null;
        const gyIdx = gyCards ? gyCards.findIndex((c: any) => c && c.id === cardOrId) : -1;
        if (gyCards && gyIdx !== -1) {
          card = gyCards.splice(gyIdx, 1)[0];
          (z as any).graveyardCount = gyCards.length;
          castFromGraveyard = true;
        } else {
          // During replay, card might not be in its expected zone anymore - this is okay
          debug(1, `castSpell: card ${cardOrId} not found in hand, exile, or graveyard for player ${playerId} (may be replay)`);
          return;
        }
      }
    }
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      debugWarn(2, `castSpell: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c && c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }

    // Also try to remove from exile if it exists there (e.g., replay or exile-cast flows).
    if (z && Array.isArray((z as any).exile)) {
      const exileCards = (z as any).exile as any[];
      const exIdx = exileCards.findIndex((c: any) => c && c.id === card.id);
      if (exIdx !== -1) {
        exileCards.splice(exIdx, 1);
        (z as any).exileCount = exileCards.length;
        castFromExile = true;
      }
    }

    // Also try to remove from graveyard if it exists there (e.g., flashback-like flows).
    if (z && Array.isArray((z as any).graveyard)) {
      const gyCards = (z as any).graveyard as any[];
      const gyIdx = gyCards.findIndex((c: any) => c && c.id === card.id);
      if (gyIdx !== -1) {
        gyCards.splice(gyIdx, 1);
        (z as any).graveyardCount = gyCards.length;
        castFromGraveyard = true;
      }
    }
  }

  // Record cast-time metadata that some intervening-if clauses depend on.
  // Example: "...if you cast it during your main phase..." must be evaluated later at resolution.
  try {
    const stepStr = String((state as any).step || '').toUpperCase();
    const isMainPhase =
      stepStr === 'MAIN1' ||
      stepStr === 'MAIN2' ||
      stepStr === 'MAIN' ||
      stepStr === 'MAIN_1' ||
      stepStr === 'MAIN_2' ||
      stepStr.includes('MAIN');
    const active = String((state as any).activePlayer || (state as any).turnPlayer || '');
    const isOwnTurn = active && active === String(playerId);
    (card as any).castDuringMainPhase = isMainPhase;
    (card as any).castDuringOwnMainPhase = isMainPhase && isOwnTurn;
    (card as any).castStep = (state as any).step;
    (card as any).castPhase = (state as any).phase;
  } catch {
    // Best-effort metadata only.
  }
  
  // Build target details for display
  const targetDetails: Array<{ id: string; type: 'permanent' | 'player'; name?: string; controllerId?: string; controllerName?: string }> = [];
  if (targets && targets.length > 0) {
    for (const target of targets) {
      const targetId = typeof target === 'string' ? target : target.id;
      const targetKind = typeof target === 'object' ? target.kind : undefined;
      
      if (targetKind === 'player') {
        // Find player name
        const player = (state.players || []).find((p: any) => p.id === targetId);
        targetDetails.push({
          id: targetId,
          type: 'player',
          name: player?.name || targetId,
        });
      } else {
        // Find permanent name and controller
        const perm = (state.battlefield || []).find((p: any) => p.id === targetId);
        // Try to get name from multiple sources (card.name, card_faces[0].name for DFCs)
        let permName = perm?.card?.name;
        if (!permName && (perm?.card as any)?.card_faces?.[0]?.name) {
          permName = (perm.card as any).card_faces[0].name;
        }
        // Don't use ID as fallback name - leave it undefined so client can try to look up
        const controllerId = perm?.controller;
        const controllerPlayer = controllerId ? (state.players || []).find((p: any) => p.id === controllerId) : undefined;
        targetDetails.push({
          id: targetId,
          type: 'permanent',
          name: permName,
          controllerId: controllerId,
          controllerName: controllerPlayer?.name,
        });
      }
    }
  }

  const spellManaValue = cardManaValue(card, xValue);

  // Provenance metadata for intervening-if templates.
  // This is authoritative when we actually removed the card from a zone above.
  const castSourceZone = castFromGraveyard ? 'graveyard' : castFromExile ? 'exile' : 'hand';
  
  // Add to stack
  const stackItem: any = {
    id: uid("stack"),
    controller: playerId,
    card: { ...card, zone: "stack" },
    targets: targets || [],
    targetDetails: targetDetails.length > 0 ? targetDetails : undefined,
    xValue,
    manaValue: spellManaValue,
    fromZone: castSourceZone,
    castSourceZone,
    source: castSourceZone,
    castFromHand: castSourceZone === 'hand',
    castFromExile: castSourceZone === 'exile',
    castFromGraveyard: castSourceZone === 'graveyard',
  };

  try {
    if (stackItem.card && typeof stackItem.card === 'object') {
      stackItem.card.fromZone = castSourceZone;
      stackItem.card.castSourceZone = castSourceZone;
      stackItem.card.source = castSourceZone;
      stackItem.card.castFromHand = castSourceZone === 'hand';
      stackItem.card.castFromExile = castSourceZone === 'exile';
      stackItem.card.castFromGraveyard = castSourceZone === 'graveyard';
    }
  } catch {
    // best-effort only
  }

  // Turn-tracking for intervening-if templates like "if you've committed a crime this turn".
  // Conservative: only record `true` when we have positive evidence.
  try {
    const controllerId = String(playerId);
    const committed = targetDetails.some((t) => {
      if (t.type === 'player') return String(t.id) !== controllerId;
      if (t.type === 'permanent') {
        const c = t.controllerId ? String(t.controllerId) : '';
        return Boolean(c) && c !== controllerId;
      }
      return false;
    });
    if (committed) {
      const stateAny = state as any;
      stateAny.committedCrimeThisTurn = stateAny.committedCrimeThisTurn || {};
      stateAny.committedCrimeThisTurn[controllerId] = true;
      stateAny.crimeCommittedThisTurn = stateAny.crimeCommittedThisTurn || {};
      stateAny.crimeCommittedThisTurn[controllerId] = true;
      stateAny.hasCommittedCrimeThisTurn = stateAny.hasCommittedCrimeThisTurn || {};
      stateAny.hasCommittedCrimeThisTurn[controllerId] = true;
    }
  } catch {
    // best-effort only
  }

  // Turn-tracking for intervening-if templates: "if you (didn't) play a card from exile this turn".
  // Casting a spell counts as playing a card.
  if (castFromExile) {
    try {
      const stateAny = state as any;
      stateAny.playedCardFromExileThisTurn = stateAny.playedCardFromExileThisTurn || {};
      stateAny.playedCardFromExileThisTurn[String(playerId)] = true;

      // Alias tracking used by some best-effort intervening-if templates.
      stateAny.playedFromExileThisTurn = stateAny.playedFromExileThisTurn || {};
      stateAny.playedFromExileThisTurn[String(playerId)] = true;
      stateAny.cardsPlayedFromExileThisTurn = stateAny.cardsPlayedFromExileThisTurn || {};
      stateAny.cardsPlayedFromExileThisTurn[String(playerId)] = (stateAny.cardsPlayedFromExileThisTurn[String(playerId)] || 0) + 1;

      // Alias tracking used by some best-effort intervening-if templates.
      stateAny.castFromExileThisTurn = stateAny.castFromExileThisTurn || {};
      stateAny.castFromExileThisTurn[String(playerId)] = true;
    } catch {
      // best-effort only
    }
  }

  // Turn-tracking for intervening-if templates: cast from graveyard.
  if (castFromGraveyard) {
    try {
      const stateAny = state as any;
      stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
      stateAny.castFromGraveyardThisTurn[String(playerId)] = true;
    } catch {
      // best-effort only
    }
  }
  
  // Register cascade triggers for this spell (supports multiple cascade instances)
  const oracleTextLower = (card?.oracle_text || "").toLowerCase();
  const cascadeMatches = oracleTextLower.match(/\bcascade\b/g);
  if (cascadeMatches && cascadeMatches.length > 0) {
    (state as any).pendingCascade = (state as any).pendingCascade || {};
    const queue = (state as any).pendingCascade[playerId] = (state as any).pendingCascade[playerId] || [];
    const baseLen = queue.length;
    for (let i = 0; i < cascadeMatches.length; i++) {
      queue.push({
        sourceName: card?.name || 'Cascade',
        sourceCardId: card?.id,
        manaValue: spellManaValue,
        instance: baseLen + i + 1,
      });
    }
  }
  
  // Include selected modes if this is a modal spell (for stack display)
  // This allows players to see which mode was chosen (e.g., flicker vs destroy for Getaway Glamer)
  if (card.selectedModes && Array.isArray(card.selectedModes)) {
    stackItem.selectedModes = card.selectedModes;
    
    // Also extract mode descriptions for display
    const oracleText = card.oracle_text || '';
    const modeOptionsMatch = oracleText.toLowerCase().match(/(?:choose\s+(?:one|two|three|four|any number)\s*(?:—|[-]))\s*((?:•[^•]+)+)/i);
    if (modeOptionsMatch) {
      const bullets = modeOptionsMatch[1].split('•').filter((s: string) => s.trim().length > 0);
      stackItem.selectedModeDescriptions = card.selectedModes.map((modeId: string) => {
        const modeNum = parseInt(modeId.replace('mode_', ''), 10);
        if (bullets[modeNum - 1]) {
          return bullets[modeNum - 1].trim();
        }
        return `Mode ${modeNum}`;
      });
    }
  }
  
  // Include selected spree modes if this is a spree spell
  if (card.selectedSpreeModes && Array.isArray(card.selectedSpreeModes)) {
    stackItem.selectedSpreeModes = card.selectedSpreeModes;
  }
  
  state.stack = state.stack || [];
  state.stack.push(stackItem as any);
  bumpSeq();
}

/**
 * Exile the entire stack to players' exile zones.
 *
 * Behavior:
 * - Moves all items from state.stack into each item's controller exile array under ctx.state.zones[controller].exile.
 * - Ensures ctx.state.zones[controller] exists and has exile array.
 * - Returns the number of items exiled.
 * - Bumps seq on success.
 *
 * Notes:
 * - This is intended for effects like Sundial of the Infinite. Caller should ensure correct timing/permissions.
 * - If no stack present it returns 0.
 */
export function exileEntireStack(ctx: GameContext, invokedBy?: PlayerID): number {
  const s = ctx.state;
  if (!s || !Array.isArray(s.stack) || s.stack.length === 0) return 0;

  try {
    const zones = s.zones = s.zones || {};
    const moved = s.stack.splice(0, s.stack.length);
    let count = 0;
    for (const item of moved) {
      const controller = (item && (item.controller as PlayerID)) || invokedBy || "unknown";
      // Ensure zones shape exists
      (zones[controller] as any) = (zones[controller] as any) || {
        hand: [],
        handCount: 0,
        libraryCount: ctx.libraries.get(controller)?.length ?? 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      };
      const z = (zones[controller] as any);
      z.exile = z.exile || [];
      // Normalize card record pushed to exile
      if (item.card && typeof item.card === "object") {
        const cardObj = { ...(item.card as any), zone: "exile" };
        z.exile.push(cardObj);
      } else {
        z.exile.push({ id: item.id || uid("ex"), name: item.card?.name || "exiled_effect", zone: "exile" });
      }
      count++;
    }

    // Update counts for all affected players
    for (const pid of Object.keys(zones)) {
      const z = (zones as any)[pid];
      if (z) {
        z.graveyardCount = (z.graveyard || []).length;
        z.libraryCount = (ctx.libraries.get(pid) || []).length;
      }
    }

    ctx.bumpSeq();
    return count;
  } catch (err) {
    debugWarn(1, "exileEntireStack failed:", err);
    return 0;
  }
}

/**
 * Manifest a card onto the battlefield face-down as a 2/2 colorless creature
 * Used by cards like: Cloudform, Lightform, Soul Summons, Whisperwood Elemental
 * 
 * Rule 701.34: To manifest a card, turn it face down. It becomes a 2/2 face-down creature card 
 * with no text, no name, no subtypes, and no mana cost.
 * 
 * @param ctx - Game context
 * @param card - The card to manifest
 * @param controller - The player who controls the manifested permanent
 * @returns The permanent ID of the manifested creature
 */
export function manifestCard(ctx: GameContext, card: any, controller: string): string | null {
  try {
    const state = (ctx as any).state;
    if (!state) return null;
    
    const battlefield = state.battlefield = state.battlefield || [];
    const newPermId = uid("perm");
    
    // Determine if the face-up card is a creature (can be turned face-up for mana cost)
    const actualTypeLine = (card.type_line || '').toLowerCase();
    const isActuallyCreature = actualTypeLine.includes('creature');
    
    const newPermanent: any = {
      id: newPermId,
      controller,
      owner: controller,
      tapped: false,
      basePower: 2,
      baseToughness: 2,
      summoningSickness: true, // Manifested creatures enter with summoning sickness
      card: {
        name: "Face-down Creature",
        type_line: "Creature",
        zone: "battlefield",
        power: "2",
        toughness: "2",
      },
      isFaceDown: true,
      faceDownType: 'manifest',
      faceUpCard: card, // Store the actual card hidden
      // If it's a creature card, it can be turned face-up for its mana cost
      canTurnFaceUp: isActuallyCreature,
    };
    
    battlefield.push(newPermanent);
    
    debug(2, `[manifestCard] Manifested ${card.name} as face-down 2/2 creature (${isActuallyCreature ? 'can turn face-up' : 'cannot turn face-up'})`);
    
    // Trigger ETB effects for the manifested creature
    // Note: Face-down creatures don't trigger abilities based on their actual card type
    triggerETBEffectsForPermanent(ctx, newPermanent, controller);
    
    return newPermId;
  } catch (err) {
    debugWarn(1, "[manifestCard] Failed to manifest card:", err);
    return null;
  }
}
