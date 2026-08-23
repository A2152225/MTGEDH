import { inferManaValueConstraintFromText, type DynamicManaValueContext } from './graveyard-mana-value.js';
import { parseBattlefieldCounterClause } from './triggerDelayedEffectUtils.js';

/**
 * Modal "choose one/two —" effects choose modes before targets (CR 700.2).
 * Stack-time targeting of the full clause would prompt for a fight/destroy
 * target even when the player later picks a non-targeted mode.
 */
export function isModalChooseModesEffectText(effectText: string): boolean {
  const text = String(effectText || '');
  if (!/[\u2022•]/.test(text)) return false;
  return /\b(?:you may )?choose (?:one|two|three|\d+|one or more|any number)(?:\s*[.\u2014\u2013-]| at random)/i.test(text);
}

export function inferTriggeredAbilityTargetMetadata(effectText: string, context?: DynamicManaValueContext): {
  requiresTarget: boolean;
  targetType?: string;
  targetConstraint?: 'opponent' | 'you';
  targetZone?: 'graveyard';
  targetDestination?: 'hand' | 'battlefield' | 'library_top' | 'library_bottom';
  targetGraveyardScope?: 'your' | 'any' | 'opponent';
  destinationUsesSelectedCardOwner?: boolean;
  battlefieldControllerMode?: 'selector' | 'owner';
  battlefieldCounters?: Record<string, number>;
  targetAction?: 'cast';
  targetFilterTypes?: string[];
  targetFilterRequiredTypeWords?: string[];
  targetFilterExcludeTypes?: string[];
  targetFilterPermanentOnly?: boolean;
  targetFilterExactManaValue?: number;
  targetFilterMinManaValue?: number;
  targetFilterMaxManaValue?: number;
  targetTotalPowerLimit?: number;
  targetCastWithoutPayingManaCost?: boolean;
  targetCastIsOptional?: boolean;
  targetFilterRequiresOneOrMoreColors?: boolean;
  minTargets?: number;
  maxTargets?: number;
} {
  if (isModalChooseModesEffectText(effectText)) {
    return { requiresTarget: false };
  }

  const lower = String(effectText || '').toLowerCase();
  const requiresTarget = lower.includes('target');
  let targetType: string | undefined;
  let targetZone: 'graveyard' | undefined;
  let targetDestination: 'hand' | 'battlefield' | 'library_top' | 'library_bottom' | undefined;
  let targetGraveyardScope: 'your' | 'any' | 'opponent' | undefined;
  let destinationUsesSelectedCardOwner = false;
  let battlefieldControllerMode: 'selector' | 'owner' | undefined;
  let battlefieldCounters: Record<string, number> | undefined;
  let targetAction: 'cast' | undefined;
  let targetFilterTypes: string[] | undefined;
  let targetFilterRequiredTypeWords: string[] | undefined;
  let targetFilterExcludeTypes: string[] | undefined;
  let targetFilterPermanentOnly = false;
  let targetFilterExactManaValue: number | undefined;
  let targetFilterMinManaValue: number | undefined;
  let targetFilterMaxManaValue: number | undefined;
  let targetTotalPowerLimit: number | undefined;
  let targetCastWithoutPayingManaCost = false;
  let targetCastIsOptional = false;
  let targetFilterRequiresOneOrMoreColors = false;
  let minTargets: number | undefined;
  let maxTargets: number | undefined;

  if (requiresTarget) {
    const manaValueConstraint = inferManaValueConstraintFromText(effectText, context);
    targetFilterExactManaValue = manaValueConstraint.targetFilterExactManaValue;
    targetFilterMinManaValue = manaValueConstraint.targetFilterMinManaValue;
    targetFilterMaxManaValue = manaValueConstraint.targetFilterMaxManaValue;

    if (!Array.isArray(targetFilterExcludeTypes) || targetFilterExcludeTypes.length === 0) {
      const nonSubtypeCreatureMatch = lower.match(/target\s+non-([a-z0-9'-]+(?:\s+[a-z0-9'-]+)*)\s+creature\b/);
      if (nonSubtypeCreatureMatch) {
        targetFilterTypes = ['creature'];
        targetFilterExcludeTypes = String(nonSubtypeCreatureMatch[1] || '')
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .map((word) => word.trim())
          .filter(Boolean);
      }
    }

    const totalPowerMatch = lower.match(/total power (\d+) or less/);
    if (totalPowerMatch) {
      const parsedTotalPowerLimit = Number.parseInt(String(totalPowerMatch[1] || ''), 10);
      if (Number.isFinite(parsedTotalPowerLimit)) {
        targetTotalPowerLimit = parsedTotalPowerLimit;
      }
    }

    if (
      lower.includes('from your graveyard')
      || lower.includes('from a graveyard')
      || lower.includes('from any graveyard')
      || /from (?:an |target )?opponent['â€™]s graveyard/.test(lower)
      || lower.includes('in your graveyard')
    ) {
      targetZone = 'graveyard';
      targetGraveyardScope = lower.includes('from your graveyard') || lower.includes('in your graveyard')
        ? 'your'
        : /from (?:an |target )?opponent['â€™]s graveyard/.test(lower)
          ? 'opponent'
          : 'any';
      if (lower.includes('cast target')) {
        targetAction = 'cast';
        targetCastWithoutPayingManaCost = lower.includes('without paying its mana cost');
        targetCastIsOptional = lower.includes('you may cast target');
      } else if (/to its owner['â€™]s hand/.test(lower)) {
        targetDestination = 'hand';
        destinationUsesSelectedCardOwner = true;
      } else if (lower.includes('to your hand')) {
        targetDestination = 'hand';
      } else if (/under its owner['â€™]s control/.test(lower)) {
        targetDestination = 'battlefield';
        battlefieldControllerMode = 'owner';
      } else if (lower.includes('to the battlefield')) {
        targetDestination = 'battlefield';
      } else if (/on top of its owner['â€™]s library/.test(lower)) {
        targetDestination = 'library_top';
        destinationUsesSelectedCardOwner = true;
      } else if (lower.includes('on top of your library')) {
        targetDestination = 'library_top';
      } else if (/on the bottom of its owner['â€™]s library/.test(lower)) {
        targetDestination = 'library_bottom';
        destinationUsesSelectedCardOwner = true;
      } else if (lower.includes('on the bottom of your library')) {
        targetDestination = 'library_bottom';
      }

      if (lower.includes('any number of target')) {
        minTargets = 0;
        maxTargets = 99;
      } else if (/\bup to one target\b/.test(lower)) {
        minTargets = 0;
        maxTargets = 1;
      } else if (/\bup to two target\b/.test(lower)) {
        minTargets = 0;
        maxTargets = 2;
      }

      if (targetDestination === 'battlefield') {
        battlefieldCounters = parseBattlefieldCounterClause(effectText);
      }

      if (lower.includes('target nonland permanent card')) {
        targetFilterPermanentOnly = true;
        targetFilterExcludeTypes = ['land'];
      } else if (lower.includes('target permanent card')) {
        targetFilterPermanentOnly = true;
      } else if (lower.includes('target battle card')) {
        targetFilterTypes = ['battle'];
      } else {
        const nonSubtypeCreatureMatch = lower.match(/target\s+non-([a-z0-9'-]+(?:\s+[a-z0-9'-]+)*)\s+creature\s+card/);
        if (nonSubtypeCreatureMatch) {
          targetFilterTypes = ['creature'];
          targetFilterExcludeTypes = String(nonSubtypeCreatureMatch[1] || '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .map((word) => word.trim())
            .filter(Boolean);
        } else {
          const requiredTypeCreatureMatch = lower.match(/target\s+([a-z0-9'-]+(?:\s+[a-z0-9'-]+)*)\s+creature\s+card/);
          if (requiredTypeCreatureMatch) {
            targetFilterTypes = ['creature'];
            targetFilterRequiredTypeWords = String(requiredTypeCreatureMatch[1] || '')
              .trim()
              .toLowerCase()
              .split(/\s+/)
              .map((word) => word.trim())
              .filter(Boolean);
          }
        }

        if (!Array.isArray(targetFilterRequiredTypeWords) || targetFilterRequiredTypeWords.length === 0) {
          if (/target\s+noncreature\s*,\s*nonland\s+card/.test(lower) || /target\s+nonland\s*,\s*noncreature\s+card/.test(lower)) {
            targetFilterExcludeTypes = ['creature', 'land'];
          } else if (lower.includes('target creature or battle card')) {
            targetFilterTypes = ['creature', 'battle'];
          } else if (/\btarget aura or equipment card\b/.test(lower) || /\btarget equipment or aura card\b/.test(lower)) {
            targetFilterTypes = ['aura', 'equipment'];
          } else if (lower.includes('target instant card')) {
            targetFilterTypes = ['instant'];
          } else if (lower.includes('target sorcery card')) {
            targetFilterTypes = ['sorcery'];
          } else if (lower.includes('target instant or sorcery card')) {
            targetFilterTypes = ['instant', 'sorcery'];
          } else if (lower.includes('target creature card')) {
            targetFilterTypes = ['creature'];
          } else if (lower.includes('target artifact card')) {
            targetFilterTypes = ['artifact'];
          } else if (lower.includes('target enchantment card')) {
            targetFilterTypes = ['enchantment'];
          } else if (lower.includes('target land card')) {
            targetFilterTypes = ['land'];
          } else if (lower.includes('target planeswalker card')) {
            targetFilterTypes = ['planeswalker'];
          } else if (lower.includes('target noncreature card')) {
            targetFilterExcludeTypes = ['creature'];
          }
        }
      }
    }

    // Non-GY put-on-library destinations (battlefield bounce-to-library, e.g. Lashweed Lurker).
    if (!targetDestination) {
      if (/on top of (?:its|their) owner['\u2019]?s library/.test(lower)) {
        targetDestination = 'library_top';
        destinationUsesSelectedCardOwner = true;
      } else if (lower.includes('on top of your library') || lower.includes('on the top of your library')) {
        targetDestination = 'library_top';
      } else if (/on the bottom of (?:its|their) owner['\u2019]?s library/.test(lower)) {
        targetDestination = 'library_bottom';
        destinationUsesSelectedCardOwner = true;
      } else if (lower.includes('on the bottom of your library')) {
        targetDestination = 'library_bottom';
      }
    }

    if (lower.includes('target creature or planeswalker')) targetType = 'creature or planeswalker';
    else if (/\btarget aura or equipment\b/.test(lower) || /\btarget equipment or aura\b/.test(lower)) targetType = 'aura or equipment';
    else if (lower.includes('target artifact or enchantment')) targetType = 'artifact or enchantment';
    else if (/target artifact, enchantment, or land\b/.test(lower) || /target artifact, land, or enchantment\b/.test(lower) || /target enchantment, artifact, or land\b/.test(lower)) {
      targetType = 'artifact, enchantment, or land';
    }
    else if (lower.includes('target noncreature artifact')) targetType = 'noncreature artifact';
    else if (/target\s+non-[a-z0-9'-]+(?:\s+[a-z0-9'-]+)*\s+creature\b/.test(lower)) targetType = 'creature';
    // "target attacking creature" / "target blocking creature" / "target attacking or blocking creature"
    // (and optional subtype words) do not contain the contiguous substring "target creature".
    else if (/\btarget\s+(?:attacking(?:\s+or\s+blocking)?|blocking)\s+(?:[a-z0-9'-]+\s+)*creature\b/.test(lower)) targetType = 'creature';
    else if (lower.includes('target creature')) targetType = 'creature';
    else if (lower.includes('target player') || lower.includes('target opponent')) targetType = 'player';
    else if (/target permanent or opponent\b/.test(lower) || /target opponent or permanent\b/.test(lower)) targetType = 'permanent or player';
    else if (lower.includes('target permanent')) targetType = 'permanent';
    else if (lower.includes('target land')) targetType = 'land';
    else if (lower.includes('target artifact')) targetType = 'artifact';
    else if (lower.includes('target enchantment')) targetType = 'enchantment';
    else if (lower.includes('target planeswalker')) targetType = 'planeswalker';
    else if (lower.includes('target battle')) targetType = 'battle';
    else if (lower.includes('target nonland')) targetType = 'nonland permanent';
    else if (lower.includes('target noncreature')) targetType = 'noncreature permanent';
    else if (lower.includes('any target')) targetType = 'any';
  }

  // Non-GY "up to N target" / "N target" counts (GY branch already sets these when applicable).
  if (requiresTarget && minTargets === undefined && maxTargets === undefined) {
    if (lower.includes('any number of target')) {
      minTargets = 0;
      maxTargets = 99;
    } else if (/\bfor each opponent\b/.test(lower) && /\bup to one target\b/.test(lower)) {
      minTargets = 0;
      const players = Array.isArray(context?.gameState?.players) ? context!.gameState.players : [];
      const controllerId = String(context?.controllerId || '').trim();
      const opponentCount = players.filter((pl: any) => {
        const id = String(pl?.id || '').trim();
        return id && id !== controllerId;
      }).length;
      maxTargets = Math.max(1, opponentCount || 3);
    } else if (/\bup to one target\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 1;
    } else if (/\bup to three target\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 3;
    } else if (/\bup to four target\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 4;
    } else if (/\btwo target\b/.test(lower)) {
      minTargets = 2;
      maxTargets = 2;
    }
  }

  // Colored-permanent riders (Ugin Eye of the Storms, etc.).
  if (requiresTarget && /\b(?:that(?:'s| is)|which (?:are|is)) one or more colors\b/i.test(lower)) {
    targetFilterRequiresOneOrMoreColors = true;
  }

  let targetConstraint: 'opponent' | 'you' | undefined;
  if (requiresTarget) {
    // Only inspect the target *noun phrase* (text after "target" before the effect verb).
    // Sentence-wide / [^.]* scans falsely match Bast's X definition in the same sentence:
    // "target attacking creature gets +X/+X ... creatures you control".
    for (const match of lower.matchAll(/\btarget\b([^.]{0,160})/gi)) {
      const afterTarget = String(match[1] || '');
      const nounPhrase = afterTarget.split(
        /\b(?:gets?|gains?|becomes?|deals?|loses?|fights?|blocks?|attacks?|is|are|can't|can|may|returns?|puts?|exiles?|destroys?|sacrifices?|taps?|untaps?|has|have|with)\b/i,
      )[0] || '';
      if (/\ban? opponent controls\b/.test(nounPhrase) || /\bopponent controls\b/.test(nounPhrase)) {
        targetConstraint = 'opponent';
        break;
      }
      if (/\byou control\b/.test(nounPhrase)) {
        targetConstraint = 'you';
        break;
      }
    }
  }

  return {
    requiresTarget,
    targetType,
    targetConstraint,
    targetZone,
    targetDestination,
    targetGraveyardScope,
    destinationUsesSelectedCardOwner,
    battlefieldControllerMode,
    battlefieldCounters,
    targetAction,
    targetFilterTypes,
    targetFilterRequiredTypeWords,
    targetFilterExcludeTypes,
    targetFilterPermanentOnly,
    targetFilterExactManaValue,
    targetFilterMinManaValue,
    targetFilterMaxManaValue,
    targetTotalPowerLimit,
    targetCastWithoutPayingManaCost,
    targetCastIsOptional,
    targetFilterRequiresOneOrMoreColors,
    minTargets,
    maxTargets,
  };
}

