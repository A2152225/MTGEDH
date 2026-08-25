/**
 * socket/resolution-handlers/modeSelectionGenericChoiceHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse, MODE_SELECTION case).
 * Cluster moved: everything after the cast-resume prefix - the legacy `modalSpellResolve` bridge and
 * the generic mode pick, which stamps the chosen mode onto the next TARGET_SELECTION step for the
 * same source and recomputes that step's valid targets from the mode's oracle text.
 * Public entry symbols: handleModeSelectionGenericChoice.
 *
 * The target-option/spec builders live in modeSelectionTargetOptionBuilders.ts.
 * Runs last in the case, so the original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { categorizeSpell, evaluateTargeting, parseTargetRequirements } from "../../rules-engine/targeting";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { broadcastGame, getPlayerName } from "../util.js";
import {
  applyModeRestrictionsToSpec,
  buildModeChoiceOptionsFromTargetRefs,
  buildModeSpellSpecFromTargetRequirements,
} from "./modeSelectionTargetOptionBuilders.js";

/** MODE_SELECTION tail: legacy modal-spell resume plus generic mode-aware target recomputation. */
export async function handleModeSelectionGenericChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;

  if (
    String(stepData?.modeSelectionPurpose || '') === 'modalSpellResolve'
    && stepData?.spellId
    && !response.cancelled
  ) {
    const { resumeLegacyModalSpellModeSelection } = await import('../../state/modules/stackResolveSpellLegacyModalUtils.js');
    if (resumeLegacyModalSpellModeSelection(game, step, response)) {
      broadcastGame(io, game, gameId);
      return;
    }
  }

  const selected = (response.selections as any);
  // NOTE: for generic mode selection steps, selectedMode is used below.
  const selectedMode = Array.isArray(selected) ? selected[0] : selected;

  // Attach selected mode to the next target selection step (same source/effect), if present.
  // This allows the client to show the chosen mode and do mode-aware highlighting.
  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const modeOption = Array.isArray((step as any).modes)
      ? ((step as any).modes as any[]).find(m => String(m.id) === String(selectedMode))
      : undefined;

    const modeText = `${modeOption?.description || ''}`.toLowerCase();
    const modeLabel = String(modeOption?.label || '').trim();

    for (const pending of queue.steps) {
      if (pending.type === ResolutionStepType.TARGET_SELECTION && pending.sourceId && step.sourceId && pending.sourceId === step.sourceId) {
        (pending as any).selectedMode = modeOption
          ? { id: modeOption.id, label: modeOption.label, description: modeOption.description }
          : { id: selectedMode, label: `Mode ${selectedMode}`, description: '' };

        // Engine-backed recomputation of valid targets based on chosen mode text.
        // Fallback: keep the original validTargets if we can't recompute safely.
        const original = Array.isArray((pending as any).validTargets) ? ([...(pending as any).validTargets] as any[]) : [];
        const cardName = String((pending as any).sourceName || step.sourceName || 'spell');
        const modeSpellSpec = categorizeSpell(cardName, modeText);
        const modeTargetReqs = parseTargetRequirements(modeText, {
          gameState: game.state,
          controllerId: String(pid),
          sourceName: String((pending as any).sourceName || step.sourceName || ''),
        });
        const nextMinTargets = Number(modeSpellSpec?.minTargets ?? modeTargetReqs?.minTargets ?? (pending as any).minTargets ?? 1);
        const nextMaxTargets = Number(modeSpellSpec?.maxTargets ?? modeTargetReqs?.maxTargets ?? (pending as any).maxTargets ?? 1);
        const nextTargetDescription = String(
          (modeSpellSpec?.targetDescription || modeTargetReqs?.targetDescription || (pending as any).targetDescription || (pending as any).description || '')
        ).trim();

        // If the mode implies a per-opponent targeting structure, the step is usually not a plain TARGET_SELECTION.
        // Don't override it here.
        if (modeTargetReqs?.perOpponent) {
          (pending as any).validTargets = original;
          break;
        }

        const modeConstraintText = `${modeLabel} ${modeText}`.toLowerCase();
        const requiresNonland = modeConstraintText.includes('nonland');
        const requiresNoncreature = modeConstraintText.includes('noncreature');
        const requiresNonartifact = modeConstraintText.includes('nonartifact');
        const requiresNonenchantment = modeConstraintText.includes('nonenchantment');
        const requiresYouControl = /\byou control\b/.test(modeConstraintText);
        const requiresOpponentControls = /\ban opponent controls\b|\bopponent controls\b/.test(modeConstraintText);
        const requiresYouDontControl = /\byou don't control\b|\byou do not control\b/.test(modeConstraintText);

        let recomputed: any[] | null = null;

        // First: best path, full heuristic spec.
        if (modeSpellSpec && modeSpellSpec.minTargets > 0) {
          const spec = applyModeRestrictionsToSpec(modeSpellSpec, modeConstraintText);
          const sourceIdForExclude = spec.excludeSource && (game.state.battlefield || []).some((p: any) => p?.id === pending.sourceId)
            ? String(pending.sourceId)
            : undefined;
          const refs = evaluateTargeting(game.state as any, pid as any, spec, sourceIdForExclude);
          const opts = buildModeChoiceOptionsFromTargetRefs(game, String(pid), refs);
          recomputed = opts;
        }

        // Second: build a minimal spec from parsed target requirements.
        if ((!recomputed || recomputed.length === 0) && modeTargetReqs?.needsTargets) {
          const specFromReqs = buildModeSpellSpecFromTargetRequirements(modeText, modeTargetReqs, nextMinTargets, nextMaxTargets);
          if (specFromReqs) {
            const spec = applyModeRestrictionsToSpec(specFromReqs, modeConstraintText);
            const sourceIdForExclude = spec.excludeSource && (game.state.battlefield || []).some((p: any) => p?.id === pending.sourceId)
              ? String(pending.sourceId)
              : undefined;
            const refs = evaluateTargeting(game.state as any, pid as any, spec, sourceIdForExclude);
            const opts = buildModeChoiceOptionsFromTargetRefs(game, String(pid), refs);
            recomputed = opts;
          } else {
            // Player-only targeting is not represented in evaluateTargeting (non-"any target"), so handle it directly.
            const targetTypes = Array.isArray(modeTargetReqs?.targetTypes)
              ? (modeTargetReqs.targetTypes as any[]).map(t => String(t).toLowerCase())
              : [];
            const isOpponentOnly = targetTypes.includes('opponent') || /\btarget\s+opponent\b/.test(modeText);
            const isSelfOnly = /\btarget\s+(yourself|you)\b/.test(modeText);
            const isPlayerOnly = targetTypes.includes('player') || isOpponentOnly || isSelfOnly;
            if (isPlayerOnly) {
              recomputed = (game.state.players || [])
                .filter((p: any) => {
                  if (isOpponentOnly) return p?.id && p.id !== pid;
                  if (isSelfOnly) return p?.id && p.id === pid;
                  return true;
                })
                .map((p: any) => ({
                  id: p.id,
                  label: p.name || p.id,
                  description: 'player',
                  type: 'player',
                  life: p.life,
                  isOpponent: p.id !== pid,
                }));
            }
          }
        }

        // Apply additional constraints that the current engine spec does not model.
        if (recomputed && recomputed.length > 0) {
          const applyConstraints = (list: any[]): any[] => {
            const normalizeColorArray = (value: any): string[] => {
              if (!Array.isArray(value)) return [];
              return value
                .map((c: any) => String(c || '').trim())
                .filter(Boolean)
                .map((c: string) => c.toUpperCase());
            };

            const normalizeTypeLine = (value: any): string => {
              return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
            };

            const splitTypeLine = (typeLineRaw: any): { types: string; subtypes: string } => {
              const tl = normalizeTypeLine(typeLineRaw);
              if (!tl) return { types: '', subtypes: '' };
              // Scryfall uses an em dash; keep a fallback for other dash styles.
              if (tl.includes('—')) {
                const [types, subtypes] = tl.split('—', 2);
                return { types: (types || '').trim(), subtypes: (subtypes || '').trim() };
              }
              if (tl.includes(' - ')) {
                const [types, subtypes] = tl.split(' - ', 2);
                return { types: (types || '').trim(), subtypes: (subtypes || '').trim() };
              }
              return { types: tl.trim(), subtypes: '' };
            };

            const hasKeyword = (opt: any, keyword: string): boolean => {
              const k = String(keyword || '').toLowerCase().trim();
              if (!k) return false;
              const keywords = Array.isArray(opt?.keywords)
                ? (opt.keywords as any[]).map((x: any) => String(x || '').toLowerCase())
                : [];
              if (keywords.includes(k)) return true;
              const oracle = String(opt?.oracleText || '').toLowerCase();
              return oracle.includes(k);
            };

            const getColorCodes = (opt: any): string[] => {
              // Prefer explicit colors; fall back to color identity.
              const colors = normalizeColorArray(opt?.colors);
              if (colors.length > 0) return colors;
              return normalizeColorArray(opt?.colorIdentity);
            };

            const COLOR_CODE: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
            const colorWords = ['white', 'blue', 'black', 'red', 'green'] as const;

            // Parse color constraints from mode text (simple/common oracle patterns).
            const requiredColors: string[] = [];
            const forbiddenColors: string[] = [];
            for (const w of colorWords) {
              const code = COLOR_CODE[w];
              if (new RegExp(`\\bnon${w}\\b`).test(modeConstraintText)) forbiddenColors.push(code);
              // Require color only when the word appears in a typical target phrase.
              if (new RegExp(`\\b${w}\\s+(?:creature|permanent|spell|card)\\b`).test(modeConstraintText)) requiredColors.push(code);
            }
            const requiresColorless = /\\bcolorless\\b/.test(modeConstraintText);
            const requiresMulticolored = /\\bmulticolou?red\\b/.test(modeConstraintText);
            const requiresMonocolored = /\\bmonocolou?red\\b/.test(modeConstraintText);
            const requiresNoncolorless = /\\bnoncolorless\\b|\\bnot colorless\\b/.test(modeConstraintText);

            // Supertypes and type-line constraints.
            const requiresBasicLand = /\\bbasic\\s+land\\b/.test(modeConstraintText);
            const requiresNonbasicLand = /\\bnonbasic\\s+land\\b/.test(modeConstraintText);
            const requiresLegendary = /\\blegendary\\b/.test(modeConstraintText) && !/\\bnonlegendary\\b/.test(modeConstraintText);
            const requiresNonlegendary = /\\bnonlegendary\\b/.test(modeConstraintText);
            const requiresSnow = /\\bsnow\\b/.test(modeConstraintText) && !/\\bnonsnow\\b/.test(modeConstraintText);
            const requiresNonsnow = /\\bnonsnow\\b/.test(modeConstraintText);

            // Keyword constraints (best-effort, creatures only).
            const keywordAbilities = [
              'flying',
              'reach',
              'trample',
              'deathtouch',
              'lifelink',
              'vigilance',
              'haste',
              'menace',
              'hexproof',
              'indestructible',
              'first strike',
              'double strike',
              'ward',
              'defender',
            ];
            const keywordGroup = keywordAbilities
              .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('|');
            const requiredKeywordMatch = modeConstraintText.match(
              new RegExp(`\\b(?:creature\\s+)?(?:with|that\\s+has)\\s+(${keywordGroup})\\b`)
            );
            const requiredKeyword = requiredKeywordMatch?.[1] ? requiredKeywordMatch[1] : null;
            const forbiddenKeywordMatch = modeConstraintText.match(
              new RegExp(`\\b(?:without|doesn't\\s+have|does\\s+not\\s+have|that\\s+doesn't\\s+have|that\\s+does\\s+not\\s+have)\\s+(${keywordGroup})\\b`)
            );
            const forbiddenKeyword = forbiddenKeywordMatch?.[1] ? forbiddenKeywordMatch[1] : null;

            // Creature subtype constraints (best-effort): support negative subtype like "non-Human creature".
            // Avoid false positives by only recognizing "non-<word> creature" patterns.
            const nonSubtypeMatch = modeConstraintText.match(/\\bnon[-\s]?([a-z][a-z']*)\\s+creature\\b/);
            const forbiddenCreatureSubtype = nonSubtypeMatch?.[1] ? nonSubtypeMatch[1].toLowerCase() : null;

            // Compound type-line constraints.
            const requiresArtifactCreature = /\\bartifact\\s+creature\\b/.test(modeConstraintText);
            const requiresEnchantmentCreature = /\\benchantment\\s+creature\\b/.test(modeConstraintText);
            const requiresArtifactLand = /\\bartifact\\s+land\\b/.test(modeConstraintText);

            // Token/nontoken constraints (best-effort, only when part of a target phrase).
            const requiresNontoken = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*nontoken\\b/.test(modeConstraintText);
            const requiresToken = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*token\\b/.test(modeConstraintText) && !requiresNontoken;

            // Tapped/untapped constraints (best-effort, works for both creatures and permanents).
            const requiresTapped = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*tapped\\b/.test(modeConstraintText);
            const requiresUntapped = /\\btarget\\s+(?:[a-z'\\-]+\\s+)*untapped\\b/.test(modeConstraintText);

            // Mana value constraints (best-effort).
            // Example: "target creature with mana value 3 or less".
            const mvRangeMatch = /\\b(?:mana value|converted mana cost)\\s+(\\d+)\\s+or\\s+(less|fewer|greater|more)\\b/.exec(modeConstraintText);
            const mvConstraint = mvRangeMatch && /\\btarget\\b/.test(modeConstraintText)
              ? {
                  value: parseInt(mvRangeMatch[1], 10),
                  cmp: mvRangeMatch[2] === 'less' || mvRangeMatch[2] === 'fewer' ? '<=' : '>=',
                }
              : null;
            const mvExactMatch = !mvConstraint && /\\btarget\\b/.test(modeConstraintText)
              ? /\\b(?:mana value|converted mana cost)\\s+(?:exactly\\s+)?(\\d+)\\b(?!\\s+or\\b)/.exec(modeConstraintText)
              : null;
            const mvExact = mvExactMatch ? parseInt(mvExactMatch[1], 10) : null;

            // Positive creature subtype targeting (best-effort).
            // Example: "target elf creature", "target human soldier creature".
            const subtypeStop = new Set([
              'another',
              'tapped',
              'untapped',
              'attacking',
              'blocking',
              'legendary',
              'nonlegendary',
              'snow',
              'nonsnow',
              'basic',
              'nonbasic',
              'nonland',
              'noncreature',
              'nonartifact',
              'nonenchantment',
              'artifact',
              'enchantment',
              'token',
              'nontoken',
              'colorless',
              'noncolorless',
              'monocolored',
              'multicolored',
              'white',
              'blue',
              'black',
              'red',
              'green',
              'nonwhite',
              'nonblue',
              'nonblack',
              'nonred',
              'nongreen',
            ]);
            const subtypePhraseMatch = modeConstraintText.match(/\\btarget\\s+((?:[a-z][a-z'\\-]*\\s+){0,3})creature\\b/);
            const requiredCreatureSubtypes = subtypePhraseMatch?.[1]
              ? subtypePhraseMatch[1]
                  .trim()
                  .split(/\\s+/)
                  .map(t => t.trim())
                  .filter(Boolean)
                  .filter(t => !subtypeStop.has(t) && !t.startsWith('non'))
              : [];

            // Common permanent subtype targeting.
            // Examples: "target Aura"; "target Equipment".
            const requiresAura = /\\btarget\\s+aura\\b/.test(modeConstraintText);
            const requiresEquipment = /\\btarget\\s+equipment\\b/.test(modeConstraintText);

            return list.filter((opt: any) => {
              const optType = String(opt?.type || '').toLowerCase();
              const typeLine = normalizeTypeLine(opt?.typeLine);
              const controller = String(opt?.controller || '');
              const isOpponent = typeof opt?.isOpponent === 'boolean' ? (opt.isOpponent as boolean) : undefined;

              if (optType !== 'player') {
                // Color constraints apply to permanents/spells, not players.
                const colors = getColorCodes(opt);
                if (requiresColorless && colors.length > 0) return false;
                if (requiresNoncolorless && colors.length === 0) return false;
                if (requiresMonocolored && colors.length !== 1) return false;
                if (requiresMulticolored && colors.length < 2) return false;
                for (const fc of forbiddenColors) {
                  if (colors.includes(fc)) return false;
                }
                for (const rc of requiredColors) {
                  if (!colors.includes(rc)) return false;
                }

                // Compound type requirements (when oracle is explicit).
                if (requiresArtifactCreature && !(typeLine.includes('artifact') && typeLine.includes('creature'))) return false;
                if (requiresEnchantmentCreature && !(typeLine.includes('enchantment') && typeLine.includes('creature'))) return false;
                if (requiresArtifactLand && !(typeLine.includes('artifact') && typeLine.includes('land'))) return false;

                // Token / nontoken filtering.
                if (requiresNontoken) {
                  const isToken = opt?.isToken === true;
                  if (isToken) return false;
                }
                if (requiresToken) {
                  const isToken = opt?.isToken === true;
                  if (!isToken) return false;
                }

                // Tapped / untapped filtering.
                if (requiresTapped && opt?.tapped !== true) return false;
                if (requiresUntapped && opt?.tapped === true) return false;

                // Mana value filtering.
                if (mvConstraint && Number.isFinite(mvConstraint.value)) {
                  const mv = Number(opt?.cmc ?? 0);
                  if (mvConstraint.cmp === '<=' && !(mv <= mvConstraint.value)) return false;
                  if (mvConstraint.cmp === '>=' && !(mv >= mvConstraint.value)) return false;
                }

                if (mvExact !== null && Number.isFinite(mvExact)) {
                  const mv = Number(opt?.cmc ?? 0);
                  if (!(mv === mvExact)) return false;
                }

                // Keyword constraints (creatures only).
                if (typeLine.includes('creature')) {
                  if (requiredKeyword && !hasKeyword(opt, requiredKeyword)) return false;
                  if (forbiddenKeyword && hasKeyword(opt, forbiddenKeyword)) return false;
                }

                // Positive creature subtype filtering.
                if (requiredCreatureSubtypes.length > 0 && typeLine.includes('creature')) {
                  const { subtypes } = splitTypeLine(typeLine);
                  const subtypeList = subtypes ? subtypes.split(/\s+/).filter(Boolean) : [];
                  for (const st of requiredCreatureSubtypes) {
                    if (!subtypeList.includes(st)) return false;
                  }
                }

                // Common permanent subtype filtering.
                if ((requiresAura || requiresEquipment) && optType !== 'player') {
                  const { subtypes } = splitTypeLine(typeLine);
                  const subtypeList = subtypes ? subtypes.split(/\s+/).filter(Boolean) : [];
                  if (requiresAura && !subtypeList.includes('aura')) return false;
                  if (requiresEquipment && !subtypeList.includes('equipment')) return false;
                }

                // Basic/nonbasic land.
                if (requiresBasicLand) {
                  if (!(typeLine.includes('land') && typeLine.includes('basic'))) return false;
                }
                if (requiresNonbasicLand) {
                  if (!typeLine.includes('land')) return false;
                  if (typeLine.includes('basic')) return false;
                }

                // Legendary/nonlegendary.
                if (requiresLegendary && !typeLine.includes('legendary')) return false;
                if (requiresNonlegendary && typeLine.includes('legendary')) return false;

                // Snow/nonsnow.
                if (requiresSnow && !typeLine.includes('snow')) return false;
                if (requiresNonsnow && typeLine.includes('snow')) return false;

                // Negative creature subtype (non-Human, non-Elf, etc.).
                // Only apply when the target is actually a creature.
                if (forbiddenCreatureSubtype && typeLine.includes('creature')) {
                  // Type line uses proper case, but we normalize to lowercase.
                  // Subtypes appear after the em dash.
                  const { subtypes } = splitTypeLine(typeLine);
                  if (subtypes && subtypes.split(/\s+/).includes(forbiddenCreatureSubtype)) return false;
                }

                if (requiresNonland && typeLine.includes('land')) return false;
                if (requiresNoncreature && typeLine.includes('creature')) return false;
                if (requiresNonartifact && typeLine.includes('artifact')) return false;
                if (requiresNonenchantment && typeLine.includes('enchantment')) return false;
                if (requiresYouControl) {
                  if (controller) {
                    if (controller !== pid) return false;
                  } else if (isOpponent !== undefined) {
                    if (isOpponent) return false;
                  }
                }
                if (requiresOpponentControls) {
                  if (controller) {
                    if (controller === pid) return false;
                  } else if (isOpponent !== undefined) {
                    if (!isOpponent) return false;
                  }
                }
                if (requiresYouDontControl) {
                  if (controller) {
                    if (controller === pid) return false;
                  } else if (isOpponent !== undefined) {
                    if (!isOpponent) return false;
                  }
                }
              }

              return true;
            });
          };

          const constrained = applyConstraints(recomputed);
          if (constrained.length >= Math.max(0, nextMinTargets)) {
            recomputed = constrained;

            // Prefer the requirements' phrasing when we applied extra constraints.
            if ((requiresNonland || requiresNoncreature || requiresNonartifact || requiresNonenchantment || requiresYouControl || requiresOpponentControls || requiresYouDontControl) && modeTargetReqs?.targetDescription) {
              (pending as any).targetDescription = String(modeTargetReqs.targetDescription);
            }
          }
        }

        if (recomputed && recomputed.length >= Math.max(0, nextMinTargets)) {
          (pending as any).validTargets = recomputed;
          (pending as any).minTargets = nextMinTargets;
          // Don't allow selecting more targets than exist.
          const clampedMaxTargets = Math.max(nextMinTargets, Math.min(nextMaxTargets, recomputed.length));
          (pending as any).maxTargets = clampedMaxTargets;
          (pending as any).targetDescription = nextTargetDescription;
          if (modeLabel) {
            const desc = String((pending as any).targetDescription || nextTargetDescription || 'target');
            (pending as any).description = `Choose ${desc} for ${cardName} (${modeLabel})`;
          }

          const effectIdForCast = pending.sourceId;
          if (effectIdForCast && (game.state as any)?.pendingSpellCasts?.[effectIdForCast]) {
            (game.state as any).pendingSpellCasts[effectIdForCast].validTargetIds = recomputed.map((t: any) => t.id);
          }
        } else {
          // If engine recomputation isn't possible, keep the precomputed original list.
          (pending as any).validTargets = original;
        }
      }
    }
  } catch {
    // Best-effort only.
  }

  // Best-effort: stash on pendingSpellCasts for later stages (targets/payment), if applicable.
  const effectId = step.sourceId;
  if (effectId && (game.state as any)?.pendingSpellCasts?.[effectId]) {
    (game.state as any).pendingSpellCasts[effectId].selectedMode = selectedMode;
  }

  // Inform players (helps debugging/clarity).
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} chose a mode for ${step.sourceName || 'a spell'}.`,
    ts: Date.now(),
  });
}
