/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: zone/target lookup helpers, spell-target scoring,
 * chooseAITargetsForSpell, chooseAITargetSelectionsForChoiceStep.
 *
 * Public entry symbols: findZoneCardById, chooseAITargetsForSpell,
 * chooseAITargetSelectionsForChoiceStep.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import {
  cardAnalyzer,
  CardCategory,
  SynergyArchetype,
  type DeckArchetypeProfile,
} from "../../../../rules-engine/src/CardAnalyzer.js";
import type { AIEngine } from "../../../../rules-engine/src/AIEngine.js";
import {
  isAttackManaRetentionEquipmentText,
  readPermanentPower,
  scoreAttackManaEngineReconfigureTarget,
} from "../../../../rules-engine/src/aiEngineManaPoolSupport.js";
import { getEffectivePower } from "../util.js";
import {
  categorizeSpell,
  type SpellSpec,
  type TargetRef,
} from "../../rules-engine/targeting.js";
import {
  calculateCardSynergyPressure,
  calculateCardThemeAlignment,
  ensureAIDeckProfile,
  scoreCardForAIAcquisition,
  scoreHostileGraveyardCardDisruption,
} from "./aiDeckProfileHandlers.js";
import { scoreGraveyardExileTarget } from "../../../../rules-engine/src/aiGraveyardExileActivation.js";
import { aiEngine } from "./aiScheduler.js";
import { isTargetPlayerMillText, scoreAIMillTargetPlayer } from "./aiMillTargetChoice.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { getPermanentCombatStats } from "./aiPermanentCombatStats.js";
import { classifyAuraPolarity, isAuraLikeSourceText } from "./aiAuraPolarity.js";

function getPermanentForTarget(game: any, target: TargetRef): any | null {
  if (target.kind !== 'permanent') return null;
  const battlefield = game?.state?.battlefield || [];
  return battlefield.find((perm: any) => perm?.id === target.id) || null;
}

function getStackItemForTarget(game: any, target: TargetRef): any | null {
  if (target.kind !== 'stack') return null;
  return (game?.state?.stack || []).find((item: any) => String(item?.id || '') === String(target.id)) || null;
}

function getPlayerForTarget(game: any, target: TargetRef): any | null {
  if (target.kind !== 'player') return null;
  return (game?.state?.players || []).find((player: any) => player?.id === target.id) || null;
}

export function findZoneCardById(
  game: any,
  cardId: string,
  preferredZones?: string[],
): { card: any; ownerId: string; zone: string } | null {
  const zonesToSearch = Array.isArray(preferredZones) && preferredZones.length > 0
    ? preferredZones.map((zone) => String(zone || '').trim().toLowerCase()).filter(Boolean)
    : ['graveyard', 'exile', 'hand', 'library'];
  const stateZones = game?.state?.zones || {};

  for (const [ownerId, playerZones] of Object.entries(stateZones)) {
    for (const zoneName of zonesToSearch) {
      const zoneCards = Array.isArray((playerZones as any)?.[zoneName]) ? (playerZones as any)[zoneName] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '') === String(cardId));
      if (card) {
        return { card, ownerId: String(ownerId), zone: zoneName };
      }
    }
  }

  return null;
}

function getZoneCardForTarget(
  game: any,
  target: TargetRef,
): { card: any; ownerId: string; zone: string } | null {
  if (target.kind !== 'card') return null;
  const preferredZone = String((target as any)?.zone || '').trim().toLowerCase();
  return findZoneCardById(game, String(target.id), preferredZone ? [preferredZone] : undefined);
}

function isHelpfulSpellOp(op: SpellSpec['op']): boolean {
  return op === 'UNTAP_TARGET' ||
    op === 'FLICKER_TARGET' ||
    op === 'ADD_COUNTERS_TARGET' ||
    op === 'GAIN_LIFE_TARGET_PLAYER' ||
    op === 'DRAW_TARGET_PLAYER' ||
    op === 'SURVEIL_TARGET_PLAYER';
}

function isHostileSpellOp(op: SpellSpec['op']): boolean {
  return op === 'DESTROY_TARGET' ||
    op === 'EXILE_TARGET' ||
    op === 'BOUNCE_TARGET' ||
    op === 'TAP_TARGET' ||
    op === 'GOAD_TARGET' ||
    op === 'DAMAGE_TARGET' ||
    op === 'ANY_TARGET_DAMAGE' ||
    op === 'LOSE_LIFE_TARGET_PLAYER' ||
    op === 'DAMAGE_TARGET_PLAYER' ||
    op === 'DISCARD_TARGET_PLAYER' ||
    op === 'BLIGHT_TARGET_OPPONENT' ||
    op === 'BLIGHT_TARGET_PLAYER' ||
    op === 'MILL_TARGET_PLAYER';
}

function scorePermanentTargetForSpell(
  game: any,
  playerId: PlayerID,
  card: any,
  spellSpec: SpellSpec,
  target: TargetRef,
  profile: DeckArchetypeProfile | null,
  threatAssessment: ReturnType<AIEngine['assessBattlefieldThreats']>
): number {
  const permanent = getPermanentForTarget(game, target);
  if (!permanent) return -9999;

  const analysis = cardAnalyzer.analyzeCard(permanent);
  const isOwnPermanent = permanent.controller === playerId;
  const typeLine = String(permanent.card?.type_line || '').toLowerCase();
  const oracleText = String(permanent.card?.oracle_text || '').toLowerCase();
  const { power, toughness } = getPermanentCombatStats(permanent, game?.state);
  const amount = Number(spellSpec.amount || 0) || 0;
  let score = 0;

  if (isHelpfulSpellOp(spellSpec.op)) {
    score += isOwnPermanent ? 40 : -60;
    score += calculateCardThemeAlignment(permanent.card || permanent, profile);
    score += calculateCardSynergyPressure(
      permanent.card || permanent,
      Array.isArray(game?.state?.zones?.[playerId]?.hand) ? game.state.zones[playerId].hand : [],
      (game?.state?.battlefield || []).filter((perm: any) => perm?.controller === playerId),
      playerId,
      profile,
    );

    if (spellSpec.op === 'FLICKER_TARGET') {
      if (analysis.details.hasETBTrigger) score += 22;
      if (analysis.categories.includes(CardCategory.TOKEN_GENERATOR)) score += 8;
      if (analysis.categories.includes(CardCategory.REANIMATOR)) score += 6;
      if (permanent.isToken) score -= 100;
    }

    if (spellSpec.op === 'UNTAP_TARGET') {
      if (analysis.details.producesMana) score += 16;
      if (typeLine.includes('creature') && power >= 4) score += 6;
      if (permanent.tapped === false) score -= 10;
    }

    if (spellSpec.op === 'ADD_COUNTERS_TARGET') {
      if ((permanent as any).isCommander) score += 10;
      if (profile?.primaryArchetypes.includes(SynergyArchetype.COUNTERS)) score += 10;
      if (profile?.primaryArchetypes.includes(SynergyArchetype.VOLTRON)) score += 10;
      score += power + toughness;
    }

    return score;
  }

  score += isOwnPermanent ? -120 : 50;
  score += analysis.removalTargetPriority * 6;
  score += analysis.comboPotential * 8;
  if (analysis.comboPotential >= 9) {
    score += 40;
  } else if (analysis.comboPotential >= 7) {
    score += 20;
  }
  score += threatAssessment.highestThreatPlayer === permanent.controller ? 10 : 0;

  const recommended = threatAssessment.recommendedTargets.find((entry) => entry.permanentId === permanent.id);
  if (recommended) {
    score += recommended.priority * 5;
  }

  if (spellSpec.op === 'EXILE_TARGET' && analysis.details.hasDeathTrigger && analysis.details.deathTriggerBenefitsMe) {
    score += 10;
  }
  if (spellSpec.op === 'BOUNCE_TARGET' && analysis.details.hasETBTrigger) {
    score -= 8;
  }
  if (spellSpec.op === 'TAP_TARGET') {
    score += permanent.tapped ? -20 : 10;
    score += power * 3;
  }
  if (spellSpec.op === 'GOAD_TARGET') {
    score += power * 4;
    score += permanent.tapped ? -15 : 0;
  }
  if ((spellSpec.op === 'DAMAGE_TARGET' || spellSpec.op === 'ANY_TARGET_DAMAGE') && amount > 0) {
    if (toughness <= amount) score += 20;
    else score -= 8;
  }
  if (typeLine.includes('planeswalker')) {
    score += 12;
  }
  if (oracleText.includes('draw') || oracleText.includes('whenever')) {
    score += 4;
  }

  return score;
}

function scorePlayerTargetForSpell(
  game: any,
  playerId: PlayerID,
  card: any,
  spellSpec: SpellSpec,
  target: TargetRef,
  profile: DeckArchetypeProfile | null,
  threatAssessment: ReturnType<AIEngine['assessBattlefieldThreats']>
): number {
  const player = getPlayerForTarget(game, target);
  if (!player) return -9999;

  const isSelf = player.id === playerId;
  const comboWarning = aiEngine.detectOpponentCombo(game.state as any, playerId);
  let score = 0;

  if (spellSpec.op === 'MILL_TARGET_PLAYER') {
    return scoreAIMillTargetPlayer(game, playerId, String(player.id), {
      highestThreatPlayer: threatAssessment.highestThreatPlayer,
      comboPlayers: comboWarning.comboPlayers,
    });
  }

  if (isHelpfulSpellOp(spellSpec.op)) {
    score += isSelf ? 80 : -40;
    if (spellSpec.op === 'SURVEIL_TARGET_PLAYER' && !isSelf && profile?.primaryArchetypes.includes(SynergyArchetype.GRAVEYARD)) {
      score -= 20;
    }
    return score;
  }

  score += isSelf ? -120 : 40;
  score += player.life <= 10 ? 20 : player.life <= 20 ? 10 : 0;
  score += threatAssessment.highestThreatPlayer === player.id ? 18 : 0;

  if (comboWarning.comboPlayers.includes(player.id)) {
    score += comboWarning.comboThreat === 'imminent' ? 30 : 15;
  }

  const oracleText = String(card?.oracle_text || card?.oracleText || '').toLowerCase();
  if (/\btarget (?:player|opponent) sacrifices an? attacking creature\b/.test(oracleText)) {
    const controlledAttackers = getAIHandlerDeps().getAIAttackingPermanents(game).filter(
      (attacker: any) => String(attacker?.controller || '') === String(player.id),
    );
    if (controlledAttackers.length === 0) {
      score -= 1000;
    } else {
      const greatestToughness = Math.max(
        ...controlledAttackers.map((attacker: any) => {
          const raw = attacker?.baseToughness ?? attacker?.toughness ?? attacker?.card?.toughness ?? 0;
          const parsed = Number.parseInt(String(raw), 10);
          return Number.isFinite(parsed) ? parsed : 0;
        }),
      );
      score += 80 + greatestToughness * 5;
    }
  }

  return score;
}

function scoreStackTargetChoice(
  game: any,
  playerId: PlayerID,
  target: TargetRef,
): number {
  const stackItem = getStackItemForTarget(game, target);
  if (!stackItem?.card) return -9999;

  const analysis = cardAnalyzer.analyzeCard(stackItem.card);
  let score = stackItem.controller === playerId ? -120 : 50;

  score += analysis.comboPotential * 8;
  if (analysis.categories.includes(CardCategory.TUTOR)) score += 12;
  if (analysis.categories.includes(CardCategory.REMOVAL)) score += 8;
  if (analysis.categories.includes(CardCategory.DRAW)) score += 6;
  if (analysis.categories.includes(CardCategory.FINISHER)) score += 8;

  return score;
}

function inferChoiceCardDestination(sourceCard: any): string {
  const oracleText = String(sourceCard?.oracle_text || '').toLowerCase();
  if (/to the battlefield|onto the battlefield/.test(oracleText)) return 'battlefield';
  if (/to (?:your |their )?hand|into (?:your |their )?hand/.test(oracleText)) return 'hand';
  if (/on top of .*library|into .*library/.test(oracleText)) return 'library';
  if (/\bexile\b/.test(oracleText)) return 'exile';
  return 'hand';
}

function scoreChoiceCardTarget(
  game: any,
  playerId: PlayerID,
  target: TargetRef,
  sourceCard: any,
  profile: DeckArchetypeProfile | null,
): number {
  const targetCard = getZoneCardForTarget(game, target);
  if (!targetCard?.card) return -9999;

  const { card, ownerId, zone } = targetCard;
  const oracleText = String(sourceCard?.oracle_text || '').toLowerCase();
  const destination = inferChoiceCardDestination(sourceCard);
  const analysis = cardAnalyzer.analyzeCard(card);
  const acquisitionScore = scoreCardForAIAcquisition(game, playerId, card, destination, profile);
  const manaValue = Number(card?.cmc || 0) || 0;

  if (zone === 'graveyard') {
    const helpfulGraveyardEffect = /(return|put)[\s\S]*graveyard[\s\S]*(to|onto|into)/i.test(oracleText);
    const hostileGraveyardEffect = /\bexile\b[\s\S]*graveyard/i.test(oracleText);

    if (helpfulGraveyardEffect) {
      let score = acquisitionScore;
      if (destination === 'battlefield' && analysis.details.hasETBTrigger) score += 10;
      if (destination === 'battlefield' && analysis.details.producesMana) score += 6;
      return score;
    }

    if (hostileGraveyardEffect && /exile target card from (?:a|target) graveyard/i.test(oracleText)) {
      return scoreGraveyardExileTarget(game?.state, String(playerId), sourceCard, card, ownerId);
    }

    if (hostileGraveyardEffect) {
      let score = scoreHostileGraveyardCardDisruption(card);
      return ownerId === playerId ? -score : score + 40;
    }

    return acquisitionScore + (ownerId === playerId ? 5 : 0);
  }

  return acquisitionScore;
}

export function chooseAITargetsForSpell(
  game: any,
  playerId: PlayerID,
  card: any,
  spellSpec: SpellSpec,
  validTargets: TargetRef[],
  targetCount?: number
): TargetRef[] {
  const desiredTargetCount = Math.max(
    1,
    Number.isFinite(targetCount as number)
      ? Number(targetCount)
      : Math.max(spellSpec.minTargets || 1, 1)
  );
  const profile = ensureAIDeckProfile(game, playerId);
  const threatAssessment = aiEngine.assessBattlefieldThreats(game.state as any, playerId);

  const scoredTargets = validTargets.map((target) => {
    let score = -9999;
    if (target.kind === 'permanent') {
      score = scorePermanentTargetForSpell(game, playerId, card, spellSpec, target, profile, threatAssessment);
      score += auraPolarityTargetBias(game, playerId, card, target);
    } else if (target.kind === 'player') {
      score = scorePlayerTargetForSpell(game, playerId, card, spellSpec, target, profile, threatAssessment);
    } else if (target.kind === 'stack') {
      score = scoreStackTargetChoice(game, playerId, target);
    } else if (target.kind === 'card') {
      score = scoreChoiceCardTarget(game, playerId, target, card, profile);
    }
    return { target, score };
  });

  scoredTargets.sort((left, right) => right.score - left.score);
  return scoredTargets.slice(0, desiredTargetCount).map((entry) => entry.target);
}

function resolveChoiceStepSourceCard(game: any, step: any): any | null {
  const spellCastContext = step?.spellCastContext;
  if (spellCastContext && (spellCastContext.oracleText || spellCastContext.cardName)) {
    return {
      id: spellCastContext.cardId || step?.sourceId || step?.id,
      name: spellCastContext.cardName || step?.sourceName || 'Effect',
      oracle_text: spellCastContext.oracleText || '',
      mana_cost: spellCastContext.manaCost || '',
      type_line: 'Spell',
    };
  }

  const sourceId = String(step?.sourceId || '');
  const battlefield = game?.state?.battlefield || [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === sourceId);
  if (permanent?.card) {
    return permanent.card;
  }

  const stack = game?.state?.stack || [];
  const stackItem = stack.find((entry: any) =>
    String(entry?.id || '') === sourceId ||
    String(entry?.source || '') === sourceId ||
    String(entry?.card?.id || '') === sourceId ||
    (step?.sourceName && String(entry?.sourceName || '') === String(step.sourceName))
  );
  if (stackItem?.card) {
    return stackItem.card;
  }

  if (step?.abilityDescription || step?.description || step?.sourceName || step?.permanentName) {
    return {
      id: sourceId || step?.id,
      name: step?.sourceName || step?.permanentName || 'Ability',
      oracle_text: step?.abilityDescription || step?.description || '',
      type_line: 'Ability',
    };
  }

  return null;
}

function mapChoiceOptionToTargetRef(game: any, option: any): TargetRef | null {
  const optionId = String(option?.id || '');
  if (!optionId) {
    return null;
  }

  const optionType = String(option?.type || option?.kind || option?.description || '').trim().toLowerCase();

  const battlefield = game?.state?.battlefield || [];
  if (battlefield.some((perm: any) => String(perm?.id || '') === optionId)) {
    return { kind: 'permanent', id: optionId };
  }

  const players = game?.state?.players || [];
  if (players.some((player: any) => String(player?.id || '') === optionId)) {
    return { kind: 'player', id: optionId };
  }

  const stack = game?.state?.stack || [];
  if (stack.some((item: any) => String(item?.id || '') === optionId) || optionType === 'stack' || optionType === 'spell') {
    return { kind: 'stack', id: optionId };
  }

  if (optionType === 'graveyard_card' || optionType.includes('graveyard')) {
    return { kind: 'card', id: optionId, zone: 'graveyard' };
  }

  const graveyardCard = findZoneCardById(game, optionId, ['graveyard']);
  if (graveyardCard) {
    return { kind: 'card', id: optionId, zone: 'graveyard' };
  }

  const zoneCard = findZoneCardById(game, optionId);
  if (zoneCard) {
    return { kind: 'card', id: optionId, zone: zoneCard.zone };
  }

  return null;
}

/**
 * +300 for the right side of an Aura (own permanent for a beneficial aura, opponent's for a
 * harmful one), -300 for the wrong side, 0 when the source isn't an aura or gives no signal.
 */
function auraPolarityTargetBias(game: any, playerId: PlayerID, sourceCard: any, target: TargetRef): number {
  if (target.kind !== 'permanent') return 0;
  const oracle = String(sourceCard?.oracle_text || '');
  if (!isAuraLikeSourceText(oracle, sourceCard?.type_line)) return 0;
  const polarity = classifyAuraPolarity(oracle);
  if (!polarity) return 0;
  const permanent = getPermanentForTarget(game, target);
  if (!permanent) return 0;
  const isOwn = String(permanent.controller || '') === String(playerId || '');
  return (polarity === 'beneficial') === isOwn ? 300 : -300;
}

function scoreChoiceTargetFallback(
  game: any,
  playerId: PlayerID,
  target: TargetRef,
  sourceCard: any,
  profile: DeckArchetypeProfile | null
): number {
  const oracleText = String(sourceCard?.oracle_text || '').toLowerCase();
  const helpful = /(draw|gain life|return .*to the battlefield|untap|flicker|put .*counter|proliferate|hexproof|indestructible|you control)/i.test(oracleText);
  const hostile = /(destroy|exile|damage|fight|goad|tap target|discard|lose life|sacrifice|counter target|return target .* to .* hand)/i.test(oracleText);

  if (target.kind === 'permanent') {
    const permanent = getPermanentForTarget(game, target);
    if (!permanent) return -9999;

    // Auras: polarity of what it does to the enchanted object decides the side, not stray
    // words like umbra armor's "would be destroyed" (issue #54, Bear Umbra).
    const auraBias = auraPolarityTargetBias(game, playerId, sourceCard, target);
    if (auraBias !== 0) {
      return auraBias + getPermanentCombatStats(permanent, game?.state).power * 2;
    }

    const isOwnPermanent = permanent.controller === playerId;
    const analysis = cardAnalyzer.analyzeCard(permanent);
    const power = getPermanentCombatStats(permanent, game?.state).power;
    let score = 0;

    if (helpful) {
      score += isOwnPermanent ? 50 : -50;
      score += calculateCardThemeAlignment(permanent.card || permanent, profile);
      if (analysis.details.hasETBTrigger) score += 18;
      if ((permanent as any).isCommander) score += 8;
      if (analysis.details.producesMana) score += 6;
    }

    if (hostile) {
      score += isOwnPermanent ? -120 : 40;
      score += analysis.removalTargetPriority * 5;
      score += analysis.comboPotential * 6;
      score += power * 2;
    }

    return score;
  }

  if (target.kind === 'stack') {
    return scoreStackTargetChoice(game, playerId, target);
  }

  if (target.kind === 'card') {
    return scoreChoiceCardTarget(game, playerId, target, sourceCard, profile);
  }

  const player = getPlayerForTarget(game, target);
  if (!player) return -9999;

  const isSelf = player.id === playerId;
  if (helpful) {
    return isSelf ? 80 : -40;
  }
  if (hostile) {
    return isSelf ? -120 : 40 + Math.max(0, 20 - Number(player.life || 20));
  }
  return isSelf ? 5 : 0;
}

export function chooseAITargetSelectionsForChoiceStep(
  game: any,
  playerId: PlayerID,
  step: any
): string[] {
  const validTargets = Array.isArray(step?.validTargets) ? step.validTargets : [];
  const targetGrouping = step?.targetGrouping;
  if (targetGrouping?.groupBy === 'controller' && Array.isArray(targetGrouping.groups)) {
    const sourceCard = resolveChoiceStepSourceCard(game, step) || {
      name: step?.sourceName || 'Effect',
      oracle_text: step?.description || '',
    };
    const profile = ensureAIDeckProfile(game, playerId);
    return targetGrouping.groups.flatMap((group: any) => {
      const groupTargets = Array.isArray(group?.targets) ? group.targets : [];
      const minForGroup = Math.max(0, Number(group?.minTargets ?? targetGrouping.minTargetsPerGroup ?? 0));
      const maxForGroup = Math.max(minForGroup, Number(group?.maxTargets ?? targetGrouping.maxTargetsPerGroup ?? 1));
      const desiredForGroup = Math.min(groupTargets.length, maxForGroup);
      return groupTargets
        .map((option: any) => {
          const target = mapChoiceOptionToTargetRef(game, option);
          return {
            id: String(option?.id || ''),
            score: target ? scoreChoiceTargetFallback(game, playerId, target, sourceCard, profile) : -9999,
          };
        })
        .filter((entry: any) => entry.id)
        .sort((left: any, right: any) => right.score - left.score)
        .slice(0, desiredForGroup)
        .map((entry: any) => entry.id);
    });
  }
  const minTargets = Math.max(0, Number(step?.minTargets ?? 0));
  const rawMaxTargets = Number(step?.maxTargets ?? minTargets);
  const maxTargets = Math.max(minTargets, Number.isFinite(rawMaxTargets) ? rawMaxTargets : minTargets);
  const desiredCount = Math.min(
    validTargets.length,
    Math.max(minTargets, Math.min(maxTargets || minTargets || 1, maxTargets || minTargets || 1))
  );

  if (validTargets.length === 0 || desiredCount <= 0) {
    return [];
  }

  if (String(step?.abilityType || '') === 'reconfigure_attach') {
    const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
    const reconfigureId = String(step?.reconfigureId || step?.permanentId || step?.sourceId || '').trim();
    const equipment = battlefield.find((entry: any) => String(entry?.id || '') === reconfigureId);
    const equipOracle = String(equipment?.card?.oracle_text || '');
    if (isAttackManaRetentionEquipmentText(equipOracle)) {
      return validTargets
        .map((option: any) => {
          const permanent = battlefield.find((entry: any) => String(entry?.id || '') === String(option?.id || ''));
          if (!permanent) return { id: '', score: -9999 };
          const score = scoreAttackManaEngineReconfigureTarget(
            game.state,
            playerId,
            permanent,
            (entry) => getEffectivePower(entry, game.state) ?? readPermanentPower(entry, game.state),
          );
          return { id: String(option?.id || '').trim(), score };
        })
        .filter((entry) => entry.id.length > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, desiredCount)
        .map((entry) => entry.id);
    }
  }

  const choiceJson = String(step?.oracleIrChoiceStepJson || '').trim();
  if (choiceJson) {
    try {
      const parsed = JSON.parse(choiceJson);
      const choiceSteps = Array.isArray(parsed) ? parsed : [];
      const sacrificeStep = choiceSteps.find((entry: any) => String(entry?.kind || '') === 'sacrifice');
      if (sacrificeStep) {
        const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
        const toughnessOf = (targetId: string): number => {
          const permanent = battlefield.find((entry: any) => String(entry?.id || '') === String(targetId || ''));
          const card = permanent?.card || permanent || {};
          const raw = permanent?.baseToughness ?? card?.toughness ?? permanent?.toughness ?? '0';
          const parsedToughness = Number.parseInt(String(raw).replace(/\D.*$/, ''), 10);
          return Number.isFinite(parsedToughness) ? parsedToughness : 0;
        };

        return validTargets
          .map((option: any) => ({
            id: String(option?.id || '').trim(),
            toughness: toughnessOf(String(option?.id || '')),
          }))
          .filter((entry) => entry.id.length > 0)
          .sort((left, right) => left.toughness - right.toughness)
          .slice(0, desiredCount)
          .map((entry) => entry.id);
      }
    } catch {
      // fall through to generic targeting
    }
  }

  const sourceCard = resolveChoiceStepSourceCard(game, step) || { name: step?.sourceName || 'Effect', oracle_text: step?.description || '' };
  const oracleText = String(sourceCard?.oracle_text || step?.description || '');
  const spellSpec = categorizeSpell(String(sourceCard?.name || step?.sourceName || ''), oracleText);
  const mappedTargets = validTargets
    .map((option: any) => ({ option, target: mapChoiceOptionToTargetRef(game, option) }))
    .filter((entry: any) => Boolean(entry.target));

  // "Target player mills ..." (Drowner of Secrets): mill an opponent unless self-mill pays off.
  // Judge the ability being resolved, not the whole card (Jace: "-1: draw" vs "-10: mills").
  const stepAbilityText = String(
    step?.abilityText || step?.activatedAbilityText || step?.planeswalkerAbility?.abilityText || step?.abilityDescription || '',
  ).trim();
  const stepDescription = String(step?.description || '');
  const millJudgeText = stepAbilityText
    || (isTargetPlayerMillText(stepDescription) ? stepDescription : oracleText);
  if (
    isTargetPlayerMillText(millJudgeText)
    && mappedTargets.length > 0
    && mappedTargets.every((entry: any) => entry.target.kind === 'player')
  ) {
    const threat = aiEngine.assessBattlefieldThreats(game.state as any, playerId);
    const combo = aiEngine.detectOpponentCombo(game.state as any, playerId);
    const ranked = mappedTargets
      .map((entry: any) => ({
        id: String(entry.option?.id || entry.target.id || ''),
        score: scoreAIMillTargetPlayer(game, playerId, String(entry.target.id), {
          highestThreatPlayer: threat.highestThreatPlayer,
          comboPlayers: combo.comboPlayers,
        }),
      }))
      .filter((entry: any) => entry.id)
      .sort((left: any, right: any) => right.score - left.score);
    const acceptable = ranked.filter((entry: any) => entry.score > -10000);
    // A mandatory target with no acceptable choice still has to pick someone.
    const pool = acceptable.length >= Math.min(minTargets, ranked.length) ? acceptable : ranked;
    return pool.slice(0, desiredCount).map((entry: any) => entry.id);
  }

  if (spellSpec && mappedTargets.length > 0) {
    const selectedTargets = chooseAITargetsForSpell(
      game,
      playerId,
      sourceCard,
      spellSpec,
      mappedTargets.map((entry: any) => entry.target),
      desiredCount
    );
    if (selectedTargets.length > 0) {
      return selectedTargets.map((entry) => entry.id);
    }
  }

  const profile = ensureAIDeckProfile(game, playerId);
  return validTargets
    .map((option: any) => {
      const target = mapChoiceOptionToTargetRef(game, option);
      return {
        id: String(option?.id || ''),
        score: target ? scoreChoiceTargetFallback(game, playerId, target, sourceCard, profile) : 0,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, desiredCount)
    .map((entry: any) => entry.id)
    .filter(Boolean);
}
