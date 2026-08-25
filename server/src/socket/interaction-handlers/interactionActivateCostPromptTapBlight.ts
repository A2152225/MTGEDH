/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility cost-prompt families for tap-other,
 * return-to-hand, and blight.
 *
 * Public entry symbols: tryHandleActivateCostPromptTapBlight.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { parseWordNumber } from "../../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { broadcastGame, getEffectivePower, getEffectiveToughness } from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

export async function tryHandleActivateCostPromptTapBlight(
  ctx: ActivateBattlefieldAbilityContext,
  manaCost: string | undefined,
  abilityText: string,
  requiresTap: boolean,
  abilityConditionText: string,
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
    cardName,
    scopedAbilityFullText,
    card,
  } = ctx;

  // ========================================================================
  // TAP OTHER PERMANENTS AS AN ACTIVATION COST (generic)
  // Examples:
  // - "Tap an untapped creature you control: ..."
  // - "Tap two untapped artifacts you control: ..."
  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
  // "Tap N untapped <type/subtype> you control" clause. No mixed sacrifice/discard/etc.
  // ========================================================================
  {
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();

    // Avoid mixing multiple interactive cost types for now.
    if (costLower.includes('tap') && (costLower.includes('discard') || costLower.includes('sacrifice') || costLower.includes('exile'))) {
      // Let other cost handlers (discard/sacrifice/etc.) handle their own errors/prompts.
    } else {
      const tapOtherMatchRestrictionAfter = costLower.match(
        /\btap\s+(another\s+|other\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+([a-z]+(?:\s+[a-z]+)*)\s+you\s+control\s+with\s+(power|toughness)\s+(\d+)\s+or\s+(less|greater)\b/i
      );

      const tapOtherMatchRestrictionBefore = costLower.match(
        /\btap\s+(another\s+|other\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+([a-z]+(?:\s+[a-z]+)*(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?)\s+you\s+control\b/i
      );

      const tapOtherMatchBase = costLower.match(
        /\btap\s+(another\s+|other\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+([a-z]+(?:\s+[a-z]+)*)\s+you\s+control\b/i
      );

      const tapOtherMatch = tapOtherMatchRestrictionAfter || tapOtherMatchRestrictionBefore || tapOtherMatchBase;

      if (tapOtherMatch) {
        // Optional supported additional clause: "Pay N life" (non-interactive).
        // IMPORTANT: do not actually pay life until the tap-target step resolves;
        // otherwise canceling the step would incorrectly charge life.
        let lifeToPayForCost: number | undefined;
        {
          const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
          if (payLifeMatch) {
            // Conservative: reject choice-based pay-life costs ("or") and multiple pay-life clauses.
            const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
            if (multiple > 1 || /\bor\b/i.test(costStr)) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
              });
              return true;
            }

            const raw = String(payLifeMatch[1] || '').trim();
            const n = parseWordNumber(raw, 1);
            if (!Number.isFinite(n) || n <= 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid life payment amount.`,
              });
              return true;
            }

            const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
            if (!Number.isFinite(currentLife) || currentLife < n) {
              socket.emit('error', {
                code: 'INSUFFICIENT_LIFE',
                message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
              });
              return true;
            }

            lifeToPayForCost = n;
          }
        }

        const mustBeOther = Boolean(tapOtherMatch[1]);
        const rawCount = String(tapOtherMatch[2] || '').trim();
        const targetCount = parseWordNumber(rawCount, 1);
        const rawTypePhrase = String(tapOtherMatch[3] || '').trim();

        // Optional supported restriction: "with power/toughness N or less/greater".
        let baseTypePhrase = rawTypePhrase;
        let minPower: number | undefined;
        let maxPower: number | undefined;
        let minToughness: number | undefined;
        let maxToughness: number | undefined;

        const hasRestrictionAfter = tapOtherMatch === tapOtherMatchRestrictionAfter;

        const powerRestr = rawTypePhrase.match(/^(.*?)\s+with\s+power\s+(\d+)\s+or\s+(less|greater)\b/i);
        const toughRestr = rawTypePhrase.match(/^(.*?)\s+with\s+toughness\s+(\d+)\s+or\s+(less|greater)\b/i);

        const afterKind = hasRestrictionAfter ? String((tapOtherMatchRestrictionAfter as any)?.[4] || '') : '';
        const afterN = hasRestrictionAfter ? String((tapOtherMatchRestrictionAfter as any)?.[5] || '') : '';
        const afterDir = hasRestrictionAfter ? String((tapOtherMatchRestrictionAfter as any)?.[6] || '') : '';

        const afterIsPower = hasRestrictionAfter && afterKind.toLowerCase() === 'power';
        const afterIsToughness = hasRestrictionAfter && afterKind.toLowerCase() === 'toughness';

        const afterRestr = hasRestrictionAfter
          ? { kind: afterKind.toLowerCase(), n: parseInt(afterN, 10), dir: afterDir.toLowerCase() }
          : null;

        const afterHasValid = Boolean(afterRestr && Number.isFinite(afterRestr.n) && (afterRestr.dir === 'less' || afterRestr.dir === 'greater') && (afterRestr.kind === 'power' || afterRestr.kind === 'toughness'));
        if ((powerRestr && toughRestr) || ((powerRestr || toughRestr) && afterHasValid)) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: multiple tap-other restrictions are not supported yet.`,
          });
          return true;
        }

        if (afterHasValid && afterIsPower) {
          baseTypePhrase = rawTypePhrase;
          const n = afterRestr!.n;
          if (!Number.isFinite(n) || n < 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid power restriction.`,
            });
            return true;
          }
          if (afterRestr!.dir === 'less') maxPower = n;
          else minPower = n;
        } else if (afterHasValid && afterIsToughness) {
          baseTypePhrase = rawTypePhrase;
          const n = afterRestr!.n;
          if (!Number.isFinite(n) || n < 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid toughness restriction.`,
            });
            return true;
          }
          if (afterRestr!.dir === 'less') maxToughness = n;
          else minToughness = n;
        } else if (powerRestr) {
          baseTypePhrase = String(powerRestr[1] || '').trim();
          const n = parseInt(String(powerRestr[2] || '0'), 10);
          const dir = String(powerRestr[3] || '').toLowerCase();
          if (!Number.isFinite(n) || n < 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid power restriction.`,
            });
            return true;
          }
          if (dir === 'less') maxPower = n;
          else minPower = n;
        } else if (toughRestr) {
          baseTypePhrase = String(toughRestr[1] || '').trim();
          const n = parseInt(String(toughRestr[2] || '0'), 10);
          const dir = String(toughRestr[3] || '').toLowerCase();
          if (!Number.isFinite(n) || n < 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid toughness restriction.`,
            });
            return true;
          }
          if (dir === 'less') maxToughness = n;
          else minToughness = n;
        }

        // Conservative: reject other complex phrases.
        if (/(\bthat\b|\bwithout\b|\battacking\b|\bblocking\b|\bequipped\b|\benchanted\b)/i.test(rawTypePhrase)) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: complex tap-other cost restrictions are not supported yet.`,
          });
          return true;
        }

        // If we parsed a power/toughness restriction, the base type must be creature-like.
        if ((minPower !== undefined || maxPower !== undefined || minToughness !== undefined || maxToughness !== undefined) && !/\bcreature\b/i.test(baseTypePhrase)) {
          // Allow subtype-only phrasing (e.g. "soldier") which we interpret as creature.
          // But still reject clearly non-creature types.
          const isClearlyNonCreature = /\b(artifact|enchantment|land|planeswalker|battle)\b/i.test(baseTypePhrase);
          if (isClearlyNonCreature) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: power/toughness restrictions are only supported for creatures.`,
            });
            return true;
          }
        }

        // Ensure there are no other non-mana cost components besides the tap-other clause.
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\btap\s+(?:another\s+|other\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+[a-z]+(?:\s+[a-z]+)*(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?\s+you\s+control(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?\b/gi,
            ' '
          )
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: tap-other cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        // Derive a simple type filter for TAP_UNTAP_TARGET.
        const ignored = new Set(['token', 'legendary', 'snow', 'basic', 'nontoken', 'nonbasic']);
        const words = baseTypePhrase
          .toLowerCase()
          .split(/\s+/)
          .map((w) => w.trim())
          .filter((w) => w && !ignored.has(w))
          .map((w) => (w.endsWith('s') ? w.slice(0, -1) : w));

        const typesFilter: string[] = [];
        const subtypesFilter: string[] = [];

        const knownPermanentTypes = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle']);
        for (const w of words) {
          if (knownPermanentTypes.has(w)) {
            typesFilter.push(w);
          } else {
            subtypesFilter.push(w);
          }
        }

        // When only creature subtypes were parsed (e.g. "Merfolk", "Soldier"), the target
        // is implicitly a creature. Add 'creature' AND the subtype words to typesFilter so
        // the TAP_UNTAP_TARGET validation matches creatures of that subtype, and tests can
        // verify both dimensions are present.
        if (typesFilter.length === 0 && subtypesFilter.length > 0) {
          typesFilter.push('creature');
          // Also push the subtype words into typesFilter so callers can see the full
          // requirement without having to merge types + subtypes themselves.
          typesFilter.push(...subtypesFilter);
        }

        const requireAllTypes = typesFilter.length > 1;

        if (typesFilter.length < 1 && subtypesFilter.length < 1) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: could not parse tap-other cost type.`,
          });
          return true;
        }

        const battlefieldNow = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const validNow = battlefieldNow.filter((p: any) => {
          if (!p || String(p.controller) !== String(pid)) return false;
          if ((p as any).tapped) return false;
          if (mustBeOther && String(p.id) === String(permanentId)) return false;
          const tl = String(p.card?.type_line || '').toLowerCase();
          
          if (typesFilter.length > 0) {
            if (requireAllTypes) {
              const matchesAll = typesFilter.every((t) => tl.includes(String(t).toLowerCase()));
              if (!matchesAll) return false;
            } else {
              const matchesAny = typesFilter.some((t) => tl.includes(String(t).toLowerCase()));
              if (!matchesAny) return false;
            }
          }

          if (subtypesFilter.length > 0) {
            const matchesAllSub = subtypesFilter.every((sub) => tl.includes(String(sub).toLowerCase()));
            if (!matchesAllSub) return false;
          }

          if (minPower !== undefined || maxPower !== undefined) {
            const pwr = getEffectivePower(p);
            if (minPower !== undefined && pwr < minPower) return false;
            if (maxPower !== undefined && pwr > maxPower) return false;
          }
          if (minToughness !== undefined || maxToughness !== undefined) {
            const tgh = getEffectiveToughness(p);
            if (minToughness !== undefined && tgh < minToughness) return false;
            if (maxToughness !== undefined && tgh > maxToughness) return false;
          }

          return true;
        });

        if (validNow.length < targetCount) {
          socket.emit('error', {
            code: 'INSUFFICIENT_TARGETS',
            message: `Need ${targetCount} untapped ${rawTypePhrase}${targetCount === 1 ? '' : 's'} you control, but you only have ${validNow.length}.`,
          });
          return true;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find((s: any) => s?.type === ResolutionStepType.TAP_UNTAP_TARGET && (s as any)?.tapOtherAbilityAsCost === true && String((s as any)?.permanentId || s?.sourceId) === String(permanentId));

        if (!existing) {
          const activatedAbilityText = (() => {
            const scopedAbilityText = String(abilityConditionText || '').trim();
            if (scopedAbilityText.includes(':')) return scopedAbilityText;
            return costStr ? `${costStr}: ${abilityText}` : (scopedAbilityText || abilityText);
          })();
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TAP_UNTAP_TARGET,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
            description: `${cardName}: Tap ${targetCount} untapped ${rawTypePhrase}${targetCount === 1 ? '' : 's'} you control to activate: ${abilityText}`,
            mandatory: false,
            action: 'tap',
            targetFilter: {
              controller: 'you',
              tapStatus: 'untapped',
              excludeSource: mustBeOther,
              types: typesFilter,
              subtypes: subtypesFilter,
              requireAllTypes,
              minPower,
              maxPower,
              minToughness,
              maxToughness,
            },
            targetCount,

            // Custom payload consumed by socket/resolution.ts
            tapOtherAbilityAsCost: true,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            activatedAbilityText,
            manaCost: costStr,
            requiresTap: Boolean(requiresTap),
            lifeToPayForCost,
          } as any);
        }

        debug(2, `[activateBattlefieldAbility] ${cardName} requires tapping ${targetCount} permanent(s) (${rawTypePhrase}) as a cost. Queued TAP_UNTAP_TARGET.`);
        broadcastGame(io, game, gameId);
        return true;
      }
    }
  }

  // ========================================================================
  // RETURN A PERMANENT YOU CONTROL TO ITS OWNER'S HAND AS AN ACTIVATION COST (generic)
  // Examples:
  // - "Return a creature you control to its owner's hand: Draw a card."
  // - "{1}, Return another land you control to its owner's hand: ..."
  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus exactly one
  // "Return (another/other)? (a|an|one|1)? <type> you control to its owner's hand" clause.
  // No mixing with discard/sacrifice/remove-counters/tap-other/exile/pay-life/etc.
  // ========================================================================
  {
    const costStr = String(manaCost || '');
    const costLower = costStr.toLowerCase();

    if (costLower.includes('return') && costLower.includes("you control") && (costLower.includes("owner's hand") || costLower.includes("owner’s hand"))) {
      const returnMatch = costStr.match(
        /\breturn\s+(?:(another|other)\s+(creature|artifact|enchantment|land|permanent|nonland\s+permanent)|(a|an|one|1)\s+(creature|artifact|enchantment|land|permanent|nonland\s+permanent))\s+you\s+control\s+to\s+its\s+owner(?:'|’)s\s+hand\b/i
      );

      if (returnMatch) {
        // Optional supported additional clause: "Pay N life" (non-interactive).
        // IMPORTANT: do not actually pay life until the target-selection step resolves;
        // otherwise canceling the step would incorrectly charge life.
        let lifeToPayForCost: number | undefined;
        {
          const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
          if (payLifeMatch) {
            const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
            if (multiple > 1 || /\bor\b/i.test(costStr)) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
              });
              return true;
            }

            const raw = String(payLifeMatch[1] || '').trim();
            const n = parseWordNumber(raw, 1);
            if (!Number.isFinite(n) || n <= 0) {
              socket.emit('error', {
                code: 'UNSUPPORTED_COST',
                message: `Cannot activate ${cardName}: invalid life payment amount.`,
              });
              return true;
            }

            const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
            if (!Number.isFinite(currentLife) || currentLife < n) {
              socket.emit('error', {
                code: 'INSUFFICIENT_LIFE',
                message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
              });
              return true;
            }

            lifeToPayForCost = n;
          }
        }

        // Reject choice-based or mixed costs for now.
        if (/\bor\b/i.test(costStr)) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: return-to-hand costs with choices ("or") are not supported yet.`,
          });
          return true;
        }

        const mustBeOther = Boolean(returnMatch[1]);
        const rawType = String(returnMatch[2] || returnMatch[4] || '').trim().toLowerCase();

        // Ensure there are no other non-mana cost components besides the return clause.
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
          .replace(
            /\breturn\s+(?:(?:another|other)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent)|(?:a|an|one|1)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent))\s+you\s+control\s+to\s+its\s+owner(?:'|’)s\s+hand\b/gi,
            ' '
          )
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: return-to-hand cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        const battlefieldNow = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const matchesType = (perm: any): boolean => {
          if (!perm) return false;
          if (String(perm.controller || '') !== String(pid)) return false;
          if (mustBeOther && String(perm.id) === String(permanentId)) return false;
          const tl = String(perm.card?.type_line || '').toLowerCase();
          if (rawType === 'permanent') return true;
          if (rawType === 'nonland permanent') return !tl.includes('land');
          return tl.includes(rawType);
        };

        const eligible = battlefieldNow.filter(matchesType);
        if (eligible.length < 1) {
          socket.emit('error', {
            code: 'INSUFFICIENT_TARGETS',
            message: `Cannot activate ${cardName}: you control no valid ${rawType} to return to hand for the cost.`,
          });
          return true;
        }

        const validTargets = eligible.map((p: any) => ({
          id: String(p.id),
          label: String(p.card?.name || 'Permanent'),
          description: String(p.card?.type_line || rawType),
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, pid as any)
          .find(
            (s: any) =>
              s?.type === ResolutionStepType.TARGET_SELECTION &&
              (s as any)?.returnToHandAbilityAsCost === true &&
              String((s as any)?.permanentId || s?.sourceId) === String(permanentId)
          );

        if (!existing) {
          const activatedAbilityText = String(abilityConditionText || '').trim() || `${costStr}: ${abilityText}`;

          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
            description: `${cardName}: Return ${mustBeOther ? 'another ' : ''}${rawType} you control to its owner's hand to activate: ${abilityText}`,
            mandatory: false,
            validTargets,
            targetTypes: ['return_to_hand_cost'],
            minTargets: 1,
            maxTargets: 1,
            targetDescription: `${rawType} you control`,

            // Custom payload consumed by socket/resolution.ts
            returnToHandAbilityAsCost: true,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            manaCost: costStr,
            requiresTap,
            returnType: rawType,
            mustBeOther,
            activatedAbilityText,
            lifeToPayForCost,
          } as any);
        }

        debug(2, `[activateBattlefieldAbility] ${cardName} requires returning ${mustBeOther ? 'another ' : ''}${rawType} you control to hand as a cost. Queued TARGET_SELECTION.`);
        broadcastGame(io, game, gameId);
        return true;
      }
    }
  }

  // ========================================================================
  // Blight as an activated-ability cost (e.g., "{T}, Blight 1: ...")
  // Queue a TARGET_SELECTION step to pay Blight, then resume activation from resolution.ts.
  // ========================================================================
  const blightCostStr = String(manaCost || '');
  const blightCostMatch = blightCostStr.match(/\bblight\s+(\w+)\b/i);
  if (blightCostMatch) {
    const raw = String(blightCostMatch[1] || '').trim();
    if (raw.toLowerCase() === 'x') {
      // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus "Blight X".
      const remainingNonManaCostText = blightCostStr
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bblight\s+\w+\b/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();

      if (remainingNonManaCostText.length > 0) {
        socket.emit('error', {
          code: 'UNSUPPORTED_COST',
          message: `Cannot activate ${cardName}: Blight cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
        });
        return true;
      }

      // Store pending activation to resume after X selection + Blight target selection.
      const activationId = `blight_activation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      (game.state as any).pendingBlightAbilityActivations = (game.state as any).pendingBlightAbilityActivations || {};
      (game.state as any).pendingBlightAbilityActivations[activationId] = {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText,
        manaCost,
        requiresTap,
        timestamp: Date.now(),
        activatedAbilityText: String(abilityConditionText || '').trim() || `${blightCostStr}: ${abilityText}`,
      };

      // Choose X (min 0, max 20 for UI sanity).
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.X_VALUE_SELECTION,
        playerId: pid as PlayerID,
        description: `${cardName}: Choose X for Blight X (cancel to abort activation).`,
        mandatory: false,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,

        minValue: 0,
        maxValue: 20,

        // Custom payload consumed by resolution.ts.
        keywordBlight: true,
        keywordBlightStage: 'ability_activation_cost_choose_x',
        keywordBlightController: pid,
        keywordBlightSourceName: `${cardName} — Blight X`,
        keywordBlightActivationId: activationId,
      } as any);

      debug(2, `[activateBattlefieldAbility] ${cardName} requires Blight X as activation cost; queued X_VALUE_SELECTION (activationId: ${activationId})`);
      broadcastGame(io, game, gameId);
      return true;
    }

    const blightN = parseWordNumber(raw) || parseInt(raw, 10) || 0;
    if (blightN > 0) {
      // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus "Blight N".
      // If the cost contains other text (e.g., sacrifice/discard/exile/tap a creature), reject up-front
      // so we don't take Blight payment and then fail to resume correctly.
      const remainingNonManaCostText = blightCostStr
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bblight\s+\w+\b/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();

      if (remainingNonManaCostText.length > 0) {
        socket.emit('error', {
          code: 'UNSUPPORTED_COST',
          message: `Cannot activate ${cardName}: Blight cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
        });
        return true;
      }

      const validTargets = battlefield
        .filter((p: any) => p && p.controller === pid)
        .filter((p: any) => ((p.card?.type_line || '').toLowerCase().includes('creature')))
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Creature',
          description: p.card?.type_line || 'creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      if (validTargets.length === 0) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `Cannot pay Blight ${blightN} (you control no creatures).`,
        });
        return true;
      }

      // Store pending activation to resume after Blight payment.
      const activationId = `blight_activation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      (game.state as any).pendingBlightAbilityActivations = (game.state as any).pendingBlightAbilityActivations || {};
      (game.state as any).pendingBlightAbilityActivations[activationId] = {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText,
        manaCost,
        requiresTap,
        timestamp: Date.now(),
      };

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        description: `${cardName}: Blight ${blightN} — Choose a creature you control to put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on it (cancel to abort activation).`,
        mandatory: false,
        sourceName: cardName,
        sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature you control',

        // Custom payload consumed by resolution.ts.
        keywordBlight: true,
        keywordBlightStage: 'ability_activation_cost',
        keywordBlightController: pid,
        keywordBlightN: blightN,
        keywordBlightSourceName: `${cardName} — Blight ${blightN}`,
        keywordBlightActivationId: activationId,
      } as any);

      debug(2, `[activateBattlefieldAbility] ${cardName} requires Blight ${blightN} as activation cost; queued TARGET_SELECTION (activationId: ${activationId})`);
      broadcastGame(io, game, gameId);
      return true;
    }
  }

  return false;
}
