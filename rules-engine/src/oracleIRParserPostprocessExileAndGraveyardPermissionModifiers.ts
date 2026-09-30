/**
 * Exile and graveyard permission modifier lowering for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 16627-17220 of the
 * pre-split file).
 * Cluster moved: the `unknown` step re-parsers that produce `grant_exile_permission` and
 * `modify_graveyard_permissions` steps, the graveyard exile-replacement modifier attachment,
 * the pay-mana unknown recovery, and the blight prefix expansion.
 * Public entry symbols: expandExilePermissionUnknownAbilities, expandPayManaUnknownAbilities,
 * expandBlightPrefixAbilities, expandGraveyardPermissionModifierUnknownAbilities.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parseGraveyardAdditionalCostFromText } from './oracleIRParserPostprocessGraveyardAdditionalCostPermission';
import {
  normalizeCounterName,
  normalizeLeadingConditionalCondition,
} from './oracleIRParserSacrificeHelpers';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';

function parseExilePermissionUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  abilityType: OracleIRAbility['type']
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/["\s]+$/g, '')
    .trim();
  if (!normalized) return null;

  {
    const asLongAsExiledPermissionMatch = normalized.match(
      /^(?:for\s+as\s+long\s+as\s+(?:it|that\s+card|the\s+exiled\s+card|the\s+exiled\s+cards?)\s+remains?\s+exiled,\s+)?(?:(you|they|that player|the player|that opponent|an opponent|its owner|the exiled card's owner)\s+)?may\s+(cast|play)\s+(it|that card|the exiled card|this card|the exiled cards|those cards)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+if\s+[^.]+)?(?:\s+for\s+as\s+long\s+as\s+(?:it|that\s+card|the\s+exiled\s+card|they|those\s+cards)\s+remains?\s+exiled)?(?:,\s+and\s+mana\s+of\s+any\s+type\s+can\s+be\s+spent\s+to\s+cast\s+that\s+spell)?\.?$/i
    );
    if (asLongAsExiledPermissionMatch && /\bfor\s+as\s+long\s+as\b/i.test(normalized)) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(asLongAsExiledPermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(asLongAsExiledPermissionMatch[3] || '').trim()),
        duration: 'as_long_as_remains_exiled',
        permission: String(asLongAsExiledPermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const asLongAsControlSourcePermissionMatch = normalized.match(
      /^(?:(you|they|that player|the player|that opponent|an opponent|its owner|the exiled card's owner)\s+)?may\s+(cast|play)\s+(it|that card|the exiled card|this card)(?:\s+without\s+paying\s+its\s+mana\s+cost)?\s+for\s+as\s+long\s+as\s+this\s+permanent\s+remains\s+on\s+the\s+battlefield\.?$/i
    );
    if (asLongAsControlSourcePermissionMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(asLongAsControlSourcePermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(asLongAsControlSourcePermissionMatch[3] || '').trim()),
        duration: 'as_long_as_control_source',
        permission: String(asLongAsControlSourcePermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+its\s+mana\s+cost/i.test(normalized) || undefined,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const directPermissionWithManaSpendMatch = normalized.match(
      /^(until\s+end\s+of\s+turn,\s+)?(?:(you|they|that player|the player|that opponent|an opponent|each player|each opponent)\s+)?(?:may\s+)?(cast|play)s?\s+(it|that card|the exiled card|this card|that spell|them|those cards|the exiled cards)(?:\s+from\s+exile)?(?:\s+this\s+turn)?(?:\s+until\s+the\s+end\s+of\s+your\s+next\s+turn)?(?:\s+and\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\b.+|,\s+and\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\b.+)?\.?$/i
    );
    if (directPermissionWithManaSpendMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(directPermissionWithManaSpendMatch[2] || 'you').trim()),
        what: parseObjectSelector(String(directPermissionWithManaSpendMatch[4] || '').trim()),
        duration: /until\s+the\s+end\s+of\s+your\s+next\s+turn/i.test(normalized)
          ? 'until_end_of_next_turn'
          : directPermissionWithManaSpendMatch[1] || /\bthis\s+turn\b/i.test(normalized)
            ? 'this_turn'
            : 'during_resolution',
        permission: String(directPermissionWithManaSpendMatch[3] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        optional: /\bmay\b/i.test(normalized) || undefined,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const broadExilePermissionMatch = normalized.match(
      /^(?:(you|they|that player|the player|that opponent|an opponent|each player|each opponent)\s+)?may\s+(cast|play)\s+((?:a|one)\s+(?:nonland\s+)?card|a\s+spell|one\s+spell|one\s+of\s+those\s+cards)(?:\s+(?:from\s+exile|they\s+exiled|exiled\s+this\s+way|from\s+among\s+the\s+exiled\s+cards))?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+this\s+turn)?\.?$/i
    );
    if (broadExilePermissionMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(broadExilePermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(broadExilePermissionMatch[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(normalized) ? 'this_turn' : 'during_resolution',
        permission: String(broadExilePermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const eachPlayerExiledCardFreeCastMatch = normalized.match(
      /^each\s+player\s+may\s+cast\s+(the\s+nonland\s+card\s+they\s+exiled|the\s+card\s+they\s+exiled|a\s+card\s+they\s+exiled)\s+without\s+paying\s+its\s+mana\s+cost\.?$/i
    );
    if (eachPlayerExiledCardFreeCastMatch) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'each_player' },
        what: parseObjectSelector(String(eachPlayerExiledCardFreeCastMatch[1] || '').trim()),
        duration: 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const amongThemFreeCastMatch = normalized.match(
      /^(until\s+end\s+of\s+turn,\s+)?(?:for\s+each\s+[^,]+,\s+)?you\s+may\s+cast\s+(.+?)\s+from\s+among\s+(?:them|those\s+cards|the\s+exiled\s+cards|(?:the\s+)?other\s+cards\s+exiled\s+this\s+way|cards\s+exiled\s+this\s+way|cards\s+revealed\s+this\s+way)\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?(?:\.\s*then\s+put\s+the\s+rest\b.+)?\.?$/i
    );
    if (amongThemFreeCastMatch) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(amongThemFreeCastMatch[2] || '').trim()),
        duration: amongThemFreeCastMatch[1] ? 'this_turn' : 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const simpleFreePermissionMatch = normalized.match(
      /^(until\s+end\s+of\s+turn,\s+)?you\s+may\s+(cast|play)\s+(.+?)\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?\.?$/i
    );
    if (simpleFreePermissionMatch && !/\b(?:from\s+exile|from\s+(?:your|their|that\s+player's|an\s+opponent's|target\s+opponent's)\s+graveyard|from\s+your\s+hand|from\s+your\s+hand\s+or\s+the\s+top\s+of\s+your\s+library|from\s+the\s+top\s+of\s+your\s+library)\b/i.test(normalized)) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(simpleFreePermissionMatch[3] || '').trim()),
        duration: simpleFreePermissionMatch[1] ? 'this_turn' : 'during_resolution',
        permission: String(simpleFreePermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: true,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const amongThemPermissionThisTurnMatch = normalized.match(
      /^(until\s+(?:end\s+of\s+turn|the\s+end\s+of\s+your\s+next\s+turn),\s+)?you\s+may\s+(cast|play)\s+(.+?)\s+from\s+among\s+(?:them|those\s+cards|the\s+exiled\s+cards|cards\s+exiled\s+this\s+way)(?:\s+this\s+turn)?\.?$/i
    );
    if (amongThemPermissionThisTurnMatch) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(amongThemPermissionThisTurnMatch[3] || '').trim()),
        duration: /next\s+turn/i.test(normalized) ? 'until_end_of_next_turn' : 'this_turn',
        permission: String(amongThemPermissionThisTurnMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const directPermissionMatch = normalized.match(
      /^(?:(you|they|that player|the player|that opponent|an opponent|each player|each opponent|its owner|the exiled card's owner)\s+)?(?:may\s+)?(cast|play)s?\s+(it|that card|the exiled card|this card|that spell|them|those cards|the exiled cards)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+this\s+turn)?(?:\s+if\s+.+)?\.?$/i
    );
    if (directPermissionMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(directPermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(directPermissionMatch[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(normalized) ? 'this_turn' : 'during_resolution',
        permission: String(directPermissionMatch[2] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
        optional: /\bmay\b/i.test(normalized) || undefined,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const mandatoryFreeCastMatch = normalized.match(/^(?:otherwise,?\s*)?(?:the player|that player|they)\s+casts?\s+(it|that card|the exiled card)\s+without\s+paying\s+its\s+mana\s+cost(?:\s+if\s+able)?(?:\s+or\s+put\s+it\s+into\s+their\s+hand)?\.?$/i);
    if (mandatoryFreeCastMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(/\bthey\b/i.test(normalized) ? 'they' : 'that player'),
        what: parseObjectSelector(String(mandatoryFreeCastMatch[1] || '').trim()),
        duration: 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

  {
    const conditionalModifierMatch = normalized.match(/^if\s+([^,]+),\s*(.+)$/i);
    if (conditionalModifierMatch) {
      const conditionRaw = normalizeLeadingConditionalCondition(String(conditionalModifierMatch[1] || '').trim());
      const modifierStep = parseExilePermissionModifierUnknownStep({
        ...step,
        raw: String(conditionalModifierMatch[2] || '').trim(),
      });
      if (conditionRaw && modifierStep) {
        return {
          kind: 'conditional',
          condition: { kind: 'if', raw: conditionRaw },
          steps: [modifierStep],
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: normalized,
        };
      }
    }
  }

  if (/^(?:at the beginning of your next upkeep,?\s*)?you may cast this card from exile without paying its mana cost\.?$/i.test(normalized)) {
    return {
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: { kind: 'raw', text: 'this card' },
      duration: 'during_resolution',
      permission: 'cast',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const match = normalized.match(
    /^(.+?)\s+may\s+(cast|play)\s+(.+?)\s+from\s+among\s+cards?\s+(?:(you)\s+own\s+)?exiled\s+with\s+this\s+(?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i
  );
  if (!match) return null;

  return {
    kind: 'grant_exile_permission',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    permission: String(match[2] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
    what: parseObjectSelector(String(match[3] || '').trim()),
    // "cards exiled with this creature" can only be granted by a permanent, so a standalone sentence
    // is a static permission that lasts while you control the source (Intrepid Paleontologist). Only a
    // trigger or activation wraps it in a one-shot resolution (Boiling Rock Rioter's attack trigger).
    duration:
      abilityType === 'triggered' || abilityType === 'activated'
        ? 'during_resolution'
        : 'as_long_as_control_source',
    linkedToSource: true,
    ...(match[4] ? { ownedByWho: 'granted_player' as const } : {}),
    optional: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseExilePermissionModifierUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const conditionalAmongThemFreeCastMatch = normalized.match(
    /^(until\s+end\s+of\s+turn,\s+)?(?:(you|they|that player|the player)\s+)?may\s+cast\s+(.+?)\s+from\s+among\s+(?:them|those\s+cards|the\s+exiled\s+cards|(?:the\s+)?other\s+cards\s+exiled\s+with\s+this\s+(?:artifact|enchantment|permanent|creature|card)|cards\s+exiled\s+this\s+way|cards\s+revealed\s+this\s+way|cards\s+exiled\s+with\s+this\s+(?:artifact|enchantment|permanent|creature|card))\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?\.?$/i
  );
  if (conditionalAmongThemFreeCastMatch) {
    return {
      kind: 'grant_exile_permission',
      who: parsePlayerSelector(String(conditionalAmongThemFreeCastMatch[2] || 'you').trim()),
      what: parseObjectSelector(String(conditionalAmongThemFreeCastMatch[3] || '').trim()),
      duration: conditionalAmongThemFreeCastMatch[1] ? 'this_turn' : 'during_resolution',
      permission: 'cast',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const exiledCardPermissionMatch = normalized.match(
    /^(you|they|that player|the player|that opponent|an opponent)?\s*may\s+(cast|play)\s+(the exiled card|that card|it|them|those cards)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+this\s+turn)?(?:\s+if\s+.+)?$/i
  );
  if (exiledCardPermissionMatch) {
    return {
      kind: 'grant_exile_permission',
      who: parsePlayerSelector(String(exiledCardPermissionMatch[1] || 'you').trim()),
      what: parseObjectSelector(String(exiledCardPermissionMatch[3] || '').trim()),
      duration: /\bthis turn\b/i.test(normalized) ? 'this_turn' : 'during_resolution',
      permission: String(exiledCardPermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
      withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (
    /^you may (?:cast|play) (?:(?:cards?|spells?) this way|(?:cards?|spells?) exiled this way|(?:those|the exiled) (?:cards?|spells?)|that card|that spell|it|them) without paying (?:its|their|that spell(?:'s)?|those spells(?:')?) mana costs?$/i.test(
      normalized
    )
  ) {
    return {
      kind: 'modify_exile_permissions',
      scope: 'last_exiled_cards',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^you may cast this card from exile without paying its mana cost\.?$/i.test(normalized)) {
    return {
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: { kind: 'raw', text: 'this card' },
      duration: 'during_resolution',
      permission: 'cast',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  return null;
}

export function expandExilePermissionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseExilePermissionUnknownStep(step, ability.type);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseGraveyardPermissionModifierUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (
    /^(?:the )?(?:flashback|escape|retrace|jump-start|harmonize) cost is equal to (?:its|their|that card's|that spell's|those cards'|those spells') mana cost$/i.test(
      normalized
    )
  ) {
    return {
      kind: 'modify_graveyard_permissions',
      scope: 'last_granted_graveyard_cards',
      castCost: 'mana_cost',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  {
    const match = normalized.match(
      /^(?:the )?(?:flashback|escape|retrace|jump-start|harmonize) cost is equal to (?:its|their|that card's|that spell's|those cards'|those spells'|the card's) mana cost plus (.+)$/i
    );
    if (match) {
      const additionalCost = parseGraveyardAdditionalCostFromText(String(match[1] || '').trim());
      if (additionalCost) {
        return {
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          castCost: 'mana_cost',
          additionalCost,
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: normalized,
        };
      }
    }
  }

  {
    const match = normalized.match(
      /^(?:this creature|this permanent|it)\s+escapes with\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it$/i
    );
    if (match) {
      const amount = parseQuantity(String(match[1] || '').trim());
      if (amount.kind !== 'number' || amount.value <= 0) return null;

      const counter = normalizeCounterName(String(match[2] || '').trim());
      if (!counter) return null;

      return {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        castedPermanentEntersWithCounters: { [counter]: Math.max(0, amount.value | 0) },
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

  return null;
}

function isGraveyardExileReplacementText(rawText: string): boolean {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    /^if\s+(?:that spell|that card|this card|it|the spell|the card|a card)\s+would be put into (?:your|its|their)\s+graveyard(?: from anywhere)?(?: this turn)?,?\s*exile (?:it|that card) instead\.?$/i.test(
      normalized
    )
    || /^if\s+a card would be put into your graveyard from anywhere this turn,?\s*exile that card instead\.?$/i.test(
      normalized
    )
  );
}

function attachGraveyardExileReplacementModifier(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] {
  const nextSteps: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind === 'conditional') {
      const nestedSteps = attachGraveyardExileReplacementModifier(step.steps);
      const updatedConditional =
        nestedSteps === step.steps ? step : { ...step, steps: nestedSteps };

      if (
        step.steps.length === 1 &&
        step.steps[0]?.kind === 'exile' &&
        isGraveyardExileReplacementText(step.raw)
      ) {
        const previous = nextSteps[nextSteps.length - 1];
        if (previous?.kind === 'modify_graveyard_permissions') {
          nextSteps[nextSteps.length - 1] = {
            ...previous,
            exileInsteadOfGraveyard: true,
            raw: `${String(previous.raw || '').trim()} ${String(step.raw || '').trim()}`.trim(),
          };
          continue;
        }
        if (previous?.kind === 'grant_graveyard_permission') {
          nextSteps.push({
            kind: 'modify_graveyard_permissions',
            scope: 'last_granted_graveyard_cards',
            exileInsteadOfGraveyard: true,
            raw: String(step.raw || '').trim(),
          });
          continue;
        }
      }

      nextSteps.push(updatedConditional);
      continue;
    }

    if (step.kind === 'unknown' && isGraveyardExileReplacementText(step.raw)) {
      const previous = nextSteps[nextSteps.length - 1];
      if (previous?.kind === 'modify_graveyard_permissions') {
        nextSteps[nextSteps.length - 1] = {
          ...previous,
          exileInsteadOfGraveyard: true,
          raw: `${String(previous.raw || '').trim()} ${String(step.raw || '').trim()}`.trim(),
        };
        continue;
      }
      if (previous?.kind === 'grant_graveyard_permission') {
        nextSteps.push({
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          exileInsteadOfGraveyard: true,
          raw: String(step.raw || '').trim(),
        });
        continue;
      }
    }

    nextSteps.push(step);
  }

  return nextSteps;
}

function parseLifeGainedBoundedPayManaStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown' && step.kind !== 'grant_static_ability') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  // Wordings: "less than or equal to / no more than / at most / up to the amount of life you gained (this turn)".
  if (!/^you may pay \{x\}, where x is (?:less than or equal to|no more than|at most|up to) (?:the amount of |the )?life you(?:'ve| have)? gained(?: this turn)?$/i.test(raw)) {
    return null;
  }
  return {
    kind: 'pay_mana',
    who: { kind: 'you' },
    mana: '{X}',
    optional: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw,
  };
}

function parsePayManaUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalizedParse = normalizeClauseForParse(String(step.raw || ''));
  const normalized = normalizeOracleText(String(normalizedParse.clause || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (/^(?:at\s+the\s+beginning\s+of\s+your\s+upkeep,\s+)?this\s+creature\s+phases\s+out\s+unless\s+you\s+pay\s+(?:\{[^}]+\})+$/i.test(normalized)) {
    return null;
  }

  let whoRaw = 'you';
  let manaRaw = '';
  let optional = Boolean(step.optional);

  {
    const match = normalized.match(/^as\s+an\s+additional\s+cost\s+to\s+cast\s+this\s+spell,\s+discard\s+a\s+card\s+or\s+pay\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      manaRaw = String(match[1] || '').trim();
      optional = true;
    }
  }

  {
    const match = normalized.match(/^pay\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      manaRaw = String(match[1] || '').trim();
    }
  }

  if (!manaRaw) {
    const match = normalized.match(/^(.+?)\s+may\s+pay\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      whoRaw = String(match[1] || '').trim();
      manaRaw = String(match[2] || '').trim();
      optional = true;
    }
  }

  if (!manaRaw) {
    const match = normalized.match(/^(.+?)\s+pays?\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      whoRaw = String(match[1] || '').trim();
      manaRaw = String(match[2] || '').trim();
    }
  }

  if (!manaRaw) {
    const lifeBounded = normalized.match(
      /^pay\s+(\{x\}),\s*where\s+x\s+is\s+less\s+than\s+or\s+equal\s+to\s+the\s+amount\s+of\s+life\s+you\s+gained$/i,
    );
    if (lifeBounded) {
      manaRaw = '{X}';
      optional = true;
      whoRaw = 'you';
    }
  }

  if (!manaRaw) return null;

  const normalizedMana = manaRaw.replace(/\s+/g, '');
  if (!normalizedMana) return null;

  return {
    kind: 'pay_mana',
    who: parsePlayerSelector(whoRaw),
    mana: normalizedMana,
    ...(optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandPayManaUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      const lifeBounded = parseLifeGainedBoundedPayManaStep(step);
      if (lifeBounded) {
        changed = true;
        return lifeBounded;
      }
      if (step.kind !== 'unknown') return step;
      const expanded = parsePayManaUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandBlightPrefixAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const effectText = String(ability.effectText || ability.text || '').trim();
    const match = effectText.match(/\byou may blight (\d+)\b/i);
    if (!match) return ability;
    const count = parseInt(String(match[1] || ''), 10);
    if (!Number.isFinite(count) || count < 1) return ability;
    if (ability.steps.some(step => /\bblight\b/i.test(String(step.raw || '')))) return ability;

    const blightStep = {
      kind: 'add_counter',
      amount: { kind: 'number', value: count },
      counter: '-1/-1',
      target: parseObjectSelector('a creature you control'),
      optional: true,
      raw: `you may blight ${count}`,
    } as unknown as OracleEffectStep;

    return { ...ability, steps: [blightStep, ...ability.steps] };
  });
}

export function expandGraveyardPermissionModifierUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseGraveyardPermissionModifierUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export { attachGraveyardExileReplacementModifier, parseExilePermissionModifierUnknownStep };
