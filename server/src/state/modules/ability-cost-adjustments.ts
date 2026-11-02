import {
  applyActivatedAbilityCostReductions,
  applyTotalManaReductionWithFloor,
  getTotalMana,
  type ActivatedAbilitySourceZone,
} from '../../../../rules-engine/src/activatedAbilityCostReduction.js';
import type { ManaCost } from '../../../../rules-engine/src/types/mana.js';
import { getSelfAbilityTrekCountReduction } from './spellSelfTrekCountCostReduction.js';
import { normalizeParsedManaCost, parseManaCost, stringifyParsedManaCost, type ParsedManaCost } from './mana-check.js';

export interface AbilityCostAdjustmentParams {
  state: any;
  activatorId: string;
  sourceCard: any;
  sourceZone: ActivatedAbilitySourceZone;
  sourceController: string;
  sourcePermanent?: any;
  isManaAbility: boolean;
  manaCostString: string;
  sourceName?: string;
  sourceId?: string;
  /** Text of the activated ability being paid (enables self "This ability costs {X} less to activate"). */
  abilityText?: string;
}

export interface AbilityCostAdjustmentResult {
  adjustedManaCost: string;
  messages: string[];
}

function parsedCostToManaCost(parsedCost: ParsedManaCost): ManaCost {
  return {
    white: parsedCost.colors.W || 0,
    blue: parsedCost.colors.U || 0,
    black: parsedCost.colors.B || 0,
    red: parsedCost.colors.R || 0,
    green: parsedCost.colors.G || 0,
    colorless: parsedCost.colors.C || 0,
    generic: parsedCost.generic,
    ...(parsedCost.hasX ? { x: 1 } : {}),
  };
}

function manaCostToParsedCost(manaCost: ManaCost, original: ParsedManaCost): ParsedManaCost {
  return normalizeParsedManaCost({
    colors: {
      W: Number(manaCost.white || 0),
      U: Number(manaCost.blue || 0),
      B: Number(manaCost.black || 0),
      R: Number(manaCost.red || 0),
      G: Number(manaCost.green || 0),
      C: Number(manaCost.colorless || 0),
    },
    generic: Number(manaCost.generic || 0),
    hasX: original.hasX,
    hybrid: original.hybrid,
    hybrids: original.hybrids,
  });
}

export function isActivatedManaAbilityText(abilityText: string): boolean {
  const text = String(abilityText || '');
  return /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(text)
    && !/target/i.test(text);
}

export function adjustActivationManaCostForPayment(
  params: AbilityCostAdjustmentParams,
): AbilityCostAdjustmentResult {
  const manaCostString = String(params.manaCostString || '').trim();
  if (!manaCostString) {
    return { adjustedManaCost: manaCostString, messages: [] };
  }

  const parsedPrinted = normalizeParsedManaCost(parseManaCost(manaCostString));
  const selfMessages: string[] = [];
  const selfReduction = params.abilityText
    ? getSelfAbilityTrekCountReduction(params.abilityText, params.state?.battlefield || [], String(params.sourceController || params.activatorId))
    : 0;
  const parsedOriginal = selfReduction > 0
    ? normalizeParsedManaCost({ ...parsedPrinted, generic: Math.max(0, Number(parsedPrinted.generic || 0) - selfReduction) })
    : parsedPrinted;
  if (selfReduction > 0) selfMessages.push(`${String(params.sourceName || params.sourceCard?.name || 'Ability')}: ability costs {${selfReduction}} less`);
  const sourcePermanent = params.sourcePermanent || (params.sourceZone === 'battlefield'
    ? {
      id: params.sourceId,
      controller: params.sourceController,
      card: params.sourceCard,
      isToken: params.sourceCard?.isToken === true,
    }
    : undefined);

  const reduced = applyActivatedAbilityCostReductions({
    state: params.state,
    playerId: params.activatorId,
    ability: {
      sourceId: String(params.sourceId || params.sourcePermanent?.id || params.sourceCard?.id || ''),
      sourceName: String(params.sourceName || params.sourceCard?.name || 'Ability'),
      manaCost: parsedCostToManaCost(parsedOriginal),
      isManaAbility: params.isManaAbility,
    } as any,
    sourceZone: params.sourceZone,
    sourceCard: params.sourceCard,
    sourcePermanent,
  });

  const adjustedParsed = manaCostToParsedCost(reduced.manaCost || parsedCostToManaCost(parsedOriginal), parsedOriginal);
  return {
    adjustedManaCost: stringifyParsedManaCost(adjustedParsed),
    messages: [...selfMessages, ...reduced.log],
  };
}

export function getTotalManaFromParsedCost(parsedCost: ParsedManaCost): number {
  return getTotalMana(parsedCostToManaCost(parsedCost));
}

export function applyParsedCostReductionWithFloor(
  parsedCost: ParsedManaCost,
  reduction: number,
  minimumTotalMana: number,
): ParsedManaCost {
  const applied = applyTotalManaReductionWithFloor(
    parsedCostToManaCost(parsedCost),
    reduction,
    minimumTotalMana,
  );
  return manaCostToParsedCost(applied.manaCost, parsedCost);
}
