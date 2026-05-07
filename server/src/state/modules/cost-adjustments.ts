import type { PlayerID } from '../../../../shared/src';
import { collectStaticEffectSources, type StaticEffectSourceType } from './static-effect-sources';

export interface CostAdjustmentEntry {
  name: string;
  amount: number;
  color?: string;
}

export interface CostAdjustmentPlan {
  genericAdjustment: number;
  coloredReductions: Record<string, number>;
  totalAdjustment: number;
  sources: Array<{ name: string; amount: number }>;
  entries: CostAdjustmentEntry[];
}

export interface ParsedCostLike {
  colors: Record<string, number>;
  generic: number;
  hasX: boolean;
  hybrid?: Array<string[]>;
}

export interface LiveSpellCostAdjustment {
  genericReduction: number;
  coloredReductions: Record<string, number>;
  genericTax: number;
  reductionMessages: string[];
  taxMessages: string[];
}

function buildEmptyCostAdjustmentPlan(): CostAdjustmentPlan {
  return {
    genericAdjustment: 0,
    coloredReductions: {},
    totalAdjustment: 0,
    sources: [],
    entries: [],
  };
}

function getSpellCostAdjustmentTraits(card: any) {
  const typeLine = String(card?.type_line || '').toLowerCase();
  const manaCostRaw = String(card?.mana_cost || '').toUpperCase();
  const colors = (card?.colors || card?.color_identity || []).map((color: string) => String(color || '').toUpperCase());

  return {
    typeLine,
    isWhiteSpell: /{W}/i.test(manaCostRaw) || colors.includes('W'),
    isBlueSpell: /{U}/i.test(manaCostRaw) || colors.includes('U'),
    isBlackSpell: /{B}/i.test(manaCostRaw) || colors.includes('B'),
    isRedSpell: /{R}/i.test(manaCostRaw) || colors.includes('R'),
    isGreenSpell: /{G}/i.test(manaCostRaw) || colors.includes('G'),
    isCreatureSpell: typeLine.includes('creature'),
    isArtifactSpell: typeLine.includes('artifact'),
    isEnchantmentSpell: typeLine.includes('enchantment'),
    isInstantOrSorcerySpell: typeLine.includes('instant') || typeLine.includes('sorcery'),
    isArtifactOrEnchantment: typeLine.includes('artifact') || typeLine.includes('enchantment'),
  };
}

function dynamicCostTextAppliesToCard(
  traits: ReturnType<typeof getSpellCostAdjustmentTraits>,
  colorOrType1?: string,
  type2?: string,
): boolean {
  const primary = String(colorOrType1 || '').toLowerCase();
  const secondary = String(type2 || '').toLowerCase();

  if (primary === 'white' && !traits.isWhiteSpell) return false;
  if (primary === 'blue' && !traits.isBlueSpell) return false;
  if (primary === 'black' && !traits.isBlackSpell) return false;
  if (primary === 'red' && !traits.isRedSpell) return false;
  if (primary === 'green' && !traits.isGreenSpell) return false;

  if ((primary === 'creature' || secondary === 'creature') && !traits.isCreatureSpell) return false;
  if (primary === 'noncreature' && traits.isCreatureSpell) return false;
  if ((primary === 'artifact' || secondary === 'artifact') && !traits.isArtifactSpell) return false;
  if ((primary === 'enchantment' || secondary === 'enchantment') && !traits.isEnchantmentSpell) return false;
  if ((primary === 'instant' || primary === 'sorcery') && !traits.isInstantOrSorcerySpell) return false;

  return true;
}

function sourceControllerMatchesPlayer(sourceController: string, playerId: string): boolean {
  return String(sourceController || '') === String(playerId || '');
}

function scopedSpellCostTextAppliesToPlayer(oracleText: string, sourceController: string, playerId: string, affectsAllPlayers?: boolean): boolean {
  const text = String(oracleText || '').toLowerCase();
  const hasController = String(sourceController || '').trim().length > 0;
  const controlledByPlayer = sourceControllerMatchesPlayer(sourceController, playerId);
  const referencesOpponents = /\b(?:your\s+opponents|opponents)\s+cast\b/.test(text);
  const referencesYou = /\byou\s+cast\b/.test(text);

  if (referencesOpponents) {
    return hasController ? !controlledByPlayer : Boolean(affectsAllPlayers);
  }

  if (referencesYou) {
    return hasController ? controlledByPlayer : Boolean(affectsAllPlayers);
  }

  return true;
}

export function buildCostAdjustmentPlan(
  state: any,
  playerId: string,
  card: any,
  options?: { sourceTypes?: StaticEffectSourceType[] },
): CostAdjustmentPlan {
  if (!card) return buildEmptyCostAdjustmentPlan();

  const traits = getSpellCostAdjustmentTraits(card);
  const redCostReducers = [
    { nameMatch: 'fire crystal', applies: (_creature: boolean) => true },
    { nameMatch: 'ruby medallion', applies: (_creature: boolean) => true },
    { nameMatch: "hazoret's monument", applies: (creature: boolean) => creature },
  ];
  const monumentCostReducers = [
    { nameMatch: "oketra's monument", colorCheck: traits.isWhiteSpell },
    { nameMatch: "bontu's monument", colorCheck: traits.isBlackSpell },
    { nameMatch: "hazoret's monument", colorCheck: traits.isRedSpell },
    { nameMatch: "kefnet's monument", colorCheck: traits.isBlueSpell },
    { nameMatch: "rhonas's monument", colorCheck: traits.isGreenSpell },
  ];
  const taxEffects = [
    { nameMatch: 'aura of silence', textMatch: 'artifact and enchantment spells your opponents cast cost {2} more', applies: (isArtifactOrEnchantment: boolean) => isArtifactOrEnchantment, amount: 2 },
  ];

  const plan = buildEmptyCostAdjustmentPlan();
  const costSources = collectStaticEffectSources(state, options);

  const addGenericAdjustment = (sourceName: string, amount: number) => {
    if (!Number.isFinite(amount) || amount === 0) return;
    plan.genericAdjustment += amount;
    plan.totalAdjustment += amount;
    plan.sources.push({ name: sourceName, amount });
    plan.entries.push({ name: sourceName, amount });
  };

  const addColoredReduction = (sourceName: string, color: string, amount: number) => {
    const normalizedColor = String(color || '').toUpperCase();
    if (!normalizedColor) return;
    const normalizedAmount = Math.max(0, Number(amount) || 0);
    if (!normalizedAmount) return;
    plan.coloredReductions[normalizedColor] = (plan.coloredReductions[normalizedColor] || 0) + normalizedAmount;
    plan.totalAdjustment -= normalizedAmount;
    plan.sources.push({ name: sourceName, amount: -normalizedAmount });
    plan.entries.push({ name: sourceName, amount: -normalizedAmount, color: normalizedColor });
  };

  for (const source of costSources) {
    if (source.phasedOut) continue;

    const sourceName = source.sourceName || 'Unknown';
    const permName = sourceName.toLowerCase();
    const permOracle = String(source.oracleText || '').toLowerCase();
    const controlledByPlayer = sourceControllerMatchesPlayer(source.controller, playerId);
    const sourceTextAppliesToPlayer = scopedSpellCostTextAppliesToPlayer(permOracle, source.controller, playerId, source.affectsAllPlayers);
    const sourceAppliesReductionToPlayer = sourceTextAppliesToPlayer;
    const sourceAppliesTaxToPlayer = sourceTextAppliesToPlayer;

    if (sourceAppliesReductionToPlayer && permOracle.includes('spells') && permOracle.includes('cost') && permOracle.includes('less')) {
      const costReductionMatch = permOracle.match(/(?:(white|blue|black|red|green|colorless|artifact|enchantment|noncreature|creature|instant|sorcery)\s+)?(?:(creature|artifact|enchantment)\s+)?spells(?:\s+you\s+cast)?\s+cost\s+\{(\d+|[wubrgc])\}\s+less/i);
      if (costReductionMatch && dynamicCostTextAppliesToCard(traits, costReductionMatch[1], costReductionMatch[2])) {
        const reductionToken = String(costReductionMatch[3] || '').toUpperCase();
        if (/^\d+$/.test(reductionToken)) {
          addGenericAdjustment(sourceName, -parseInt(reductionToken, 10));
        } else {
          addColoredReduction(sourceName, reductionToken, 1);
        }
      }
    }

    if (controlledByPlayer && traits.isRedSpell) {
      for (const reducer of redCostReducers) {
        if (reducer.applies(traits.isCreatureSpell) && permName.includes(reducer.nameMatch)) {
          if (!permOracle.includes('spells you cast cost') || !permOracle.includes('less')) {
            addGenericAdjustment(sourceName, -1);
          }
        }
      }
    }

    if (controlledByPlayer && traits.isCreatureSpell) {
      for (const monument of monumentCostReducers) {
        if (monument.colorCheck && permName.includes(monument.nameMatch)) {
          if (!permOracle.includes('spells you cast cost') || !permOracle.includes('less')) {
            addGenericAdjustment(sourceName, -1);
          }
        }
      }
    }

    if (sourceAppliesTaxToPlayer && permOracle.includes('spells') && permOracle.includes('cost') && permOracle.includes('more')) {
      const taxMatch = permOracle.match(/(?:(artifact|enchantment|noncreature|nonartifact)\s+(?:and\s+\w+\s+)?)?spells(?: your opponents cast| opponents cast)? cost \{(\d+)\} more/i);
      if (taxMatch) {
        const typeRestriction = String(taxMatch[1] || '').toLowerCase();
        const taxAmount = parseInt(taxMatch[2], 10) || 1;

        let applies = true;
        if (typeRestriction === 'artifact' && !traits.isArtifactSpell) applies = false;
        if (typeRestriction === 'enchantment' && !traits.isEnchantmentSpell) applies = false;
        if (typeRestriction === 'noncreature' && traits.isCreatureSpell) applies = false;
        if (typeRestriction === 'nonartifact' && traits.isArtifactSpell) applies = false;
        if (permOracle.includes('artifact and enchantment') && !traits.isArtifactOrEnchantment) applies = false;

        if (applies) {
          addGenericAdjustment(sourceName, taxAmount);
        }
      }
    }

    if (sourceAppliesTaxToPlayer && traits.isArtifactOrEnchantment) {
      for (const tax of taxEffects) {
        if (tax.applies(traits.isArtifactOrEnchantment) && (permName.includes(tax.nameMatch) || permOracle.includes(tax.textMatch))) {
          if (!permOracle.includes('spells') || !permOracle.includes('cost') || !permOracle.includes('more')) {
            addGenericAdjustment(sourceName, tax.amount);
          }
        }
      }
    }
  }

  return plan;
}

export function getCostAdjustmentForCard(state: any, playerId: PlayerID, card: any): number {
  return buildCostAdjustmentPlan(state, playerId, card).totalAdjustment;
}

export function applyCostAdjustmentToParsedCost(
  parsedCost: ParsedCostLike,
  adjustment: number | CostAdjustmentPlan,
  extraGenericAdjustment = 0,
): ParsedCostLike {
  const hasStructuredAdjustment = typeof adjustment !== 'number';
  const genericAdjustment = (hasStructuredAdjustment ? adjustment.genericAdjustment : adjustment) + extraGenericAdjustment;
  const coloredReductions = hasStructuredAdjustment ? adjustment.coloredReductions : {};

  if (!genericAdjustment && Object.keys(coloredReductions).length === 0) return parsedCost;

  const result: ParsedCostLike = {
    colors: { ...parsedCost.colors },
    generic: parsedCost.generic,
    hasX: Boolean(parsedCost.hasX),
    ...(Array.isArray(parsedCost.hybrid)
      ? { hybrid: parsedCost.hybrid.map((entry) => [...entry]) }
      : {}),
  };

  if (genericAdjustment > 0) {
    result.generic += genericAdjustment;
  }

  for (const [color, count] of Object.entries(coloredReductions)) {
    let remainingColorReduction = Math.max(0, Number(count) || 0);
    if (remainingColorReduction <= 0) continue;

    const available = result.colors[color] || 0;
    const colorReduction = Math.min(available, remainingColorReduction);
    result.colors[color] = available - colorReduction;
    remainingColorReduction -= colorReduction;

    if (remainingColorReduction > 0) {
      const genericReduction = Math.min(result.generic, remainingColorReduction);
      result.generic -= genericReduction;
    }
  }

  let remainingReduction = Math.abs(Math.min(genericAdjustment, 0));
  const genericReduction = Math.min(result.generic, remainingReduction);
  result.generic -= genericReduction;
  remainingReduction -= genericReduction;

  if (remainingReduction > 0) {
    const colorReductionOrder = Object.entries(result.colors)
      .filter(([, count]) => Number(count) > 0)
      .sort((left, right) => {
        const countDelta = Number(right[1]) - Number(left[1]);
        if (countDelta !== 0) return countDelta;
        return String(left[0]).localeCompare(String(right[0]));
      })
      .map(([color]) => color);

    for (const color of colorReductionOrder) {
      if (remainingReduction <= 0) break;
      const available = result.colors[color] || 0;
      if (available <= 0) continue;
      const colorReduction = Math.min(available, remainingReduction);
      result.colors[color] = available - colorReduction;
      remainingReduction -= colorReduction;
    }
  }

  return result;
}

export function buildLiveSpellCostAdjustment(plan: CostAdjustmentPlan): LiveSpellCostAdjustment {
  const coloredReductions: Record<string, number> = {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
  const symbolToColorName: Record<string, keyof typeof coloredReductions> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
    C: 'colorless',
  };

  let genericReduction = 0;
  let genericTax = 0;
  const reductionMessages: string[] = [];
  const taxMessages: string[] = [];

  for (const entry of plan.entries) {
    if (entry.amount > 0) {
      genericTax += entry.amount;
      taxMessages.push(`${entry.name}: +{${entry.amount}}`);
      continue;
    }

    const reductionAmount = Math.abs(entry.amount);
    if (entry.color) {
      const colorName = symbolToColorName[String(entry.color || '').toUpperCase()];
      if (!colorName) continue;
      coloredReductions[colorName] = (coloredReductions[colorName] || 0) + reductionAmount;
      reductionMessages.push(`${entry.name}: -{${String(entry.color).toUpperCase()}}`);
      continue;
    }

    genericReduction += reductionAmount;
    reductionMessages.push(`${entry.name}: -{${reductionAmount}}`);
  }

  return {
    genericReduction,
    coloredReductions,
    genericTax,
    reductionMessages,
    taxMessages,
  };
}