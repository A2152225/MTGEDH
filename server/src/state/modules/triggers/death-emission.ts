/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover death emission (getDeathTriggers family)
 * Public: getDeathTriggers, getDeathTriggersForCreature, processUndyingPersist,
 *   getPlayersWhoMustSacrifice, DeathTriggerResult
 */

import type { GameContext } from "../../context.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { collectDeathTriggerEffectText } from "./death-detection.js";
import { KNOWN_DEATH_TRIGGERS } from "./card-data-tables.js";
import {
  hydrateBattlefieldOracleText,
  hydratePermanentCardOracleInPlace,
} from "../cardOracleHydration.js";
import { escapeCardNameForRegex } from "./types.js";
import { stripReminderParentheticals } from "../../../../../rules-engine/src/oracleReminderText.js";
import type { DeathTriggerResult } from "./death-emission-helpers.js";
import {
  appendDetectedDeathWatcherTriggers,
  appendDetectedSelfDeathTriggers,
  appendHauntLeaveDeathTriggers,
  appendParsedDiesTriggerLines,
  countControlledAurasAttachedTo,
  deathTriggerClauseMatchesDyingCreature,
  dyingCreatureIsEnchanted,
  getPermanentRulesTextFragments,
} from "./death-emission-helpers.js";
import { collectDelayedDiesWatcherTriggers } from "./delayed-dies-watchers.js";
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

export type { DeathTriggerResult } from "./death-emission-helpers.js";

/**
 * Handle undying/persist return from graveyard
 */
export function processUndyingPersist(
  ctx: GameContext,
  card: any,
  owner: string,
  ability: 'undying' | 'persist'
): void {
  const battlefield = ctx.state?.battlefield || [];
  const counterType = ability === 'undying' ? '+1/+1' : '-1/-1';
  
  // Create permanent on battlefield with counter
  const newPermanent = {
    id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    controller: owner,
    owner: owner,
    tapped: false,
    counters: { [counterType]: 1 },
    card: { ...card, zone: "battlefield" },
    returnedWith: ability,
  };
  
  battlefield.push(newPermanent as any);
  stampPermanentEntryTimestamp(ctx.state, battlefield[battlefield.length - 1]);
  ctx.bumpSeq();
}

/**
 * Find all death triggers that should fire when a creature dies.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_DEATH_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * @param ctx Game context
 * @param dyingCreature The creature that died
 * @param dyingCreatureController The controller of the dying creature
 * @returns Array of triggered abilities that should fire
 */
export function getDeathTriggers(
  ctx: GameContext,
  dyingCreature: any,
  dyingCreatureController: string
): DeathTriggerResult[] {
  const results: DeathTriggerResult[] = [];
  const battlefield = ctx.state?.battlefield || [];
  try {
    hydrateBattlefieldOracleText(battlefield);
    hydratePermanentCardOracleInPlace(dyingCreature);
  } catch {
    // best-effort: triggers must not depend on hydration succeeding
  }
  const dyingTypeLine = (dyingCreature?.card?.type_line || '').toLowerCase();
  const isCreature = dyingTypeLine.includes('creature');

  results.push(...collectDelayedDiesWatcherTriggers(ctx, dyingCreature));

  appendDetectedSelfDeathTriggers(results, dyingCreature, dyingCreatureController, ctx.state);

  const dyingCard = dyingCreature?.card;
  const dyingCardName = String(dyingCard?.name || 'Unknown');
  const lowerDyingCardName = dyingCardName.toLowerCase();
  const dyingPermanentId = String(dyingCreature?.id || '').trim();
  const permanentsToScan: any[] = [...battlefield];
  if (dyingPermanentId && !permanentsToScan.some((perm) => String(perm?.id || '') === dyingPermanentId)) {
    permanentsToScan.push(dyingCreature);
  }

  appendDetectedDeathWatcherTriggers(
    ctx,
    results,
    permanentsToScan,
    dyingCreature,
    dyingCreatureController,
  );
  appendParsedDiesTriggerLines(ctx, results, permanentsToScan, dyingCreature, dyingCreatureController);

  if (!isCreature) {
    appendHauntLeaveDeathTriggers(ctx, results, dyingCreature);
    return results;
  }
  const extractChooseOneModalOptions = (effectText: string): string[] | undefined => {
    const effect = String(effectText || '').trim();
    if (!/^choose one\b/i.test(effect)) return undefined;

    const modalBody = effect.replace(/^choose one\s*[—:.-]\s*/i, '').trim();
    const hasBulletOptions = /(?:^|\n)\s*[•]\s*/.test(modalBody);
    const bulletOptions = hasBulletOptions
      ? modalBody
          .split(/(?:^|\n)\s*[•]\s*/)
          .map((option) => option.trim())
          .filter(Boolean)
      : [];
    if (bulletOptions.length > 0) {
      return bulletOptions;
    }

    const inlineOptions = modalBody
      .split(/\s*;\s*or\s+/i)
      .map((option) => option.trim())
      .filter(Boolean);
    return inlineOptions.length > 0 ? inlineOptions : undefined;
  };
  const selfDiesPattern = new RegExp(
    `when(?:ever)?\\s+(?:~|this creature|${escapeCardNameForRegex(dyingCardName)})(?:\\s+or\\s+another\\s+(?:nontoken\\s+)?creature(?:s)?(?:\\s+you\\s+control)?)?\\s+dies,?\\s*([^.]+)`,
    'ig'
  );
  const seenSelfEffects = new Set<string>();
  const normalizeDeathEffectKey = (text: string): string =>
    String(text || '')
      .trim()
      .toLowerCase()
      .replace(/['’]/g, "'")
      .replace(/^when(?:ever)? this creature dies,?\s*/, '')
      .replace(/[.]+$/g, '')
      .trim();
  for (const existing of results) {
    const key = normalizeDeathEffectKey(String(existing?.effect || ''));
    if (key) seenSelfEffects.add(key);
  }
  for (const rulesText of getPermanentRulesTextFragments(dyingCreature, ctx.state)) {
    const textForScan = stripReminderParentheticals(rulesText);
    const matches = textForScan.matchAll(selfDiesPattern);
    for (const match of matches) {
      let effect = collectDeathTriggerEffectText(textForScan, match as RegExpMatchArray, 1);
      if (/^choose one\b/i.test(effect)) {
        const matchText = String(match?.[0] || '');
        const matchIndex = typeof match?.index === 'number' ? match.index : -1;
        const effectOffset = matchText.lastIndexOf(effect);
        if (matchIndex >= 0 && effectOffset >= 0) {
          const remainder = String(rulesText || '').slice(matchIndex + effectOffset).trim();
          const collectedLines: string[] = [];
          for (const [index, lineValue] of remainder.split(/\n/).entries()) {
            const line = String(lineValue || '').trim();
            if (!line) continue;
            if (index === 0 || /^[•]/.test(line)) {
              collectedLines.push(line);
              continue;
            }
            break;
          }
          if (collectedLines.length > 0) {
            effect = collectedLines.join('\n').trim();
          }
        }
      }
      if (!effect) continue;
      const effectKey = normalizeDeathEffectKey(effect);
      if (seenSelfEffects.has(effectKey)) continue;
      seenSelfEffects.add(effectKey);
      const modalOptions = extractChooseOneModalOptions(effect);
      results.push({
        source: {
          permanentId: String(dyingCreature?.id || ''),
          cardName: dyingCardName,
          controllerId: String(dyingCreatureController || ''),
        },
        effect,
        ...(Array.isArray(modalOptions) && modalOptions.length > 0 ? { requiresChoice: true, modalOptions } : null),
        requiresSacrificeSelection: effectKey.includes('sacrifice'),
      });
    }
  }

  for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
    if (info.triggerOn !== 'own') continue;
    if (!lowerDyingCardName.includes(knownName)) continue;
    if (results.some((result) => String(result?.source?.permanentId || '') === String(dyingCreature?.id || ''))) {
      continue;
    }

    const effect = String(info.effect || '').trim();
    const modalOptions = extractChooseOneModalOptions(effect);
    results.push({
      source: {
        permanentId: String(dyingCreature?.id || ''),
        cardName: dyingCardName,
        controllerId: String(dyingCreatureController || ''),
      },
      effect,
      ...(Array.isArray(modalOptions) && modalOptions.length > 0 ? { requiresChoice: true, modalOptions } : null),
      requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
    });
  }
  
  // Check all permanents on the battlefield for death triggers
  for (const permanent of permanentsToScan) {
    if (!permanent) continue;
    
    const card = permanent.card;
    if (!card) continue;
    
    const cardName = (card.name || '').toLowerCase();
    const oracleText = getPermanentRulesTextFragments(permanent, ctx.state).join('\n');
    const lowerOracleText = oracleText.toLowerCase();
    const permanentController = String(permanent.controller || '').trim();
    const attachedTo = String((permanent as any)?.attachedTo || '').trim();
    
    // ===== DYNAMIC DETECTION (Primary) =====

    const anEnchantedCreatureDiesMatch = oracleText.match(/when(?:ever)? an enchanted creature dies,?\s*([^.]+)/i);
    if (anEnchantedCreatureDiesMatch && dyingCreatureIsEnchanted(ctx, dyingCreature)) {
      const effect = collectDeathTriggerEffectText(oracleText, anEnchantedCreatureDiesMatch, 1);
      if (effect && !results.some((result) => String(result?.source?.permanentId || '') === String(permanent.id || ''))) {
        const auraCount = countControlledAurasAttachedTo(
          ctx,
          permanentController,
          String(dyingCreature?.id || ''),
        );
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          referenceAmount: auraCount,
          value: {
            attachedAuraCount: auraCount,
            dyingPermanentId: String(dyingCreature?.id || ''),
          },
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }

    if ((lowerOracleText.includes('when enchanted creature dies') || lowerOracleText.includes('whenever enchanted creature dies')) &&
        attachedTo && attachedTo === String(dyingCreature?.id || '')) {
      const effectMatch = oracleText.match(/when(?:ever)? enchanted creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }

    else if ((lowerOracleText.includes('when equipped creature dies') || lowerOracleText.includes('whenever equipped creature dies')) &&
        attachedTo && attachedTo === String(dyingCreature?.id || '')) {
      const effectMatch = oracleText.match(/when(?:ever)? equipped creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }

    else {
      const genericDiesMatch = oracleText.match(/when(?:ever)?\s+([^.]+?)\s+dies,?\s*([^.]+)/i);
      if (
        genericDiesMatch &&
        deathTriggerClauseMatchesDyingCreature(ctx, genericDiesMatch[1], permanent, dyingCreature, dyingCreatureController) &&
        !results.some(r => r.source.permanentId === permanent.id)
      ) {
        const effect = collectDeathTriggerEffectText(oracleText, genericDiesMatch, 2);
        const returnsUnderControl = effect.toLowerCase().includes('return') &&
          effect.toLowerCase().includes('under your control');
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          returnsUnderControl,
          dyingCreatureCard: returnsUnderControl ? dyingCreature?.card : undefined,
        });
      }
    }
    
    // "Whenever a creature you control dies" or "Whenever another creature you control dies"
        if ((lowerOracleText.includes('whenever a creature you control dies') ||
          lowerOracleText.includes('whenever another creature you control dies') ||
          lowerOracleText.includes('whenever a nontoken creature you control dies') ||
          lowerOracleText.includes('whenever another nontoken creature you control dies')) && 
        dyingCreatureController === permanentController) {
      const effectMatch = oracleText.match(/whenever (?:a|another) (?:nontoken )?creature you control dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
    
    // "Whenever a creature dies" (any creature, not specific to controller)
    else if (lowerOracleText.includes('whenever a creature dies') && 
      !lowerOracleText.includes('whenever a creature you control dies') &&
      !lowerOracleText.includes("whenever a creature you don't control dies") &&
      !lowerOracleText.includes("whenever a creature an opponent controls dies")) {
      const effectMatch = oracleText.match(/whenever a creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
    
    // "Whenever a creature you don't control dies" or "Whenever a creature an opponent controls dies"
        else if ((lowerOracleText.includes("whenever a creature you don't control dies") ||
          lowerOracleText.includes("whenever a creature an opponent controls dies")) &&
        dyingCreatureController !== permanentController) {
      const effectMatch = oracleText.match(/whenever (?:a|another) (?:nontoken )?creature (?:you don't control|an opponent controls) dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        const returnsUnderControl = effect.toLowerCase().includes('return') && 
                                    effect.toLowerCase().includes('under your control');
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          returnsUnderControl,
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }
    
    // ===== KNOWN CARDS TABLE (Fallback/Enhancement) =====
    // Use the table only when dynamic oracle parsing did not already match this permanent.
    if (results.some((result) => String(result?.source?.permanentId || '') === String(permanent.id || ''))) {
      continue;
    }
    for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
      if (!cardName.includes(knownName)) continue;
        let shouldTrigger = false;
        
        switch (info.triggerOn) {
          case 'controlled':
            shouldTrigger = dyingCreatureController === permanentController;
            break;
          case 'any':
            shouldTrigger = true;
            break;
          case 'own':
            shouldTrigger = false;
            break;
          case 'opponent':
            shouldTrigger = dyingCreatureController !== permanentController;
            break;
        }
        
        if (shouldTrigger) {
          const requiresSacrifice = info.effect.toLowerCase().includes('sacrifice');
          const returnsUnderControl = info.effect.toLowerCase().includes('return') && 
                                      info.effect.toLowerCase().includes('under your control');
          
          results.push({
            source: {
              permanentId: permanent.id,
              cardName: card.name,
              controllerId: permanentController,
            },
            effect: info.effect,
            requiresSacrificeSelection: requiresSacrifice,
            returnsUnderControl,
            dyingCreatureCard: returnsUnderControl ? dyingCreature?.card : undefined,
          });
        }
    }
  }

  // Emblem death triggers (e.g. Sephiroth Super Nova emblem)
  const emblems = Array.isArray((ctx.state as any)?.emblems) ? (ctx.state as any).emblems : [];
  for (const emblem of emblems) {
    if (!emblem) continue;
    const emblemId = String(emblem.id || '').trim();
    const emblemController = String(emblem.controller || '').trim();
    const emblemEffect = String(emblem.effect || '').trim();
    const lowerEmblemEffect = emblemEffect.toLowerCase();
    if (!emblemId || !emblemController || !lowerEmblemEffect) continue;
    if (results.some((r) => String(r?.source?.permanentId || '') === emblemId)) continue;

    const emblemName = String(emblem.sourceName || 'Emblem').trim() || 'Emblem';
    const displayName = /emblem/i.test(emblemName) ? emblemName : `${emblemName} Emblem`;

    // "Whenever a creature you control dies"
    if (
      (lowerEmblemEffect.includes('whenever a creature you control dies')
        || lowerEmblemEffect.includes('whenever another creature you control dies'))
      && dyingCreatureController === emblemController
    ) {
      const effectMatch = emblemEffect.match(/whenever (?:a|another) (?:nontoken )?creature you control dies,?\s*([^.]+)/i);
      if (effectMatch) {
        results.push({
          source: {
            permanentId: emblemId,
            cardName: displayName,
            controllerId: emblemController,
            isEmblem: true,
          },
          effect: collectDeathTriggerEffectText(emblemEffect, effectMatch, 1),
        });
      }
      continue;
    }

    // "Whenever a creature dies" (any creature)
    if (
      lowerEmblemEffect.includes('whenever a creature dies')
      && !lowerEmblemEffect.includes('whenever a creature you control dies')
      && !lowerEmblemEffect.includes("whenever a creature you don't control dies")
      && !lowerEmblemEffect.includes('whenever a creature an opponent controls dies')
    ) {
      const effectMatch = emblemEffect.match(/whenever a creature dies,?\s*([^.]+)/i);
      if (effectMatch) {
        results.push({
          source: {
            permanentId: emblemId,
            cardName: displayName,
            controllerId: emblemController,
            isEmblem: true,
          },
          effect: collectDeathTriggerEffectText(emblemEffect, effectMatch, 1),
        });
      }
    }
  }

  appendHauntLeaveDeathTriggers(ctx, results, dyingCreature);
  return dedupeDeathTriggerResults(results);
}

function deathEffectsOverlap(left: string, right: string): boolean {
  const a = String(left || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const b = String(right || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const prefixLen = Math.min(48, a.length, b.length);
  return prefixLen >= 24 && a.slice(0, prefixLen) === b.slice(0, prefixLen);
}

function dedupeDeathTriggerResults(results: DeathTriggerResult[]): DeathTriggerResult[] {
  const deduped: DeathTriggerResult[] = [];
  for (const result of results) {
    const sourceId = String(result?.source?.permanentId || '');
    const effect = String(result?.effect || '');
    if (!sourceId || !effect) continue;
    if (deduped.some((existing) => (
      String(existing.source.permanentId) === sourceId
      && deathEffectsOverlap(String(existing.effect || ''), effect)
    ))) {
      continue;
    }
    deduped.push(result);
  }
  return deduped;
}

/**
 * Get list of players who need to sacrifice a creature due to Grave Pact-style effects
 * @param ctx Game context
 * @param triggerController The controller of the trigger source
 * @returns Array of player IDs who must sacrifice
 */
export function getPlayersWhoMustSacrifice(
  ctx: GameContext,
  triggerController: string
): string[] {
  const players = ctx.state?.players || [];
  return players
    .map((p: any) => p.id)
    .filter((pid: string) => pid !== triggerController);
}

/**
 * Process death triggers when a creature dies
 */
export function getDeathTriggersForCreature(
  ctx: GameContext, 
  dyingPermanent: any,
  dyingController: string
): TriggeredAbility[] {
  return getDeathTriggers(ctx, dyingPermanent, dyingController).map((result) => ({
    permanentId: result.source.permanentId,
    cardName: result.source.cardName,
    triggerType: result.triggerType || 'creature_dies',
    description: result.effect,
    effect: result.effect,
    mandatory: true,
    controllerId: result.source.controllerId,
    ...(typeof result.referenceAmount === 'number' ? { value: result.referenceAmount } : null),
    ...(result.reflexiveWhenYouDo ? { reflexiveWhenYouDo: result.reflexiveWhenYouDo } : null),
    ...(result.delayedEndStep ? { delayedEndStep: result.delayedEndStep } : null),
  }));
}
