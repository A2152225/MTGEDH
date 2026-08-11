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
  strictColoredReductions: Record<string, number>;
  totalAdjustment: number;
  sources: Array<{ name: string; amount: number }>;
  entries: CostAdjustmentEntry[];
}

export interface ParsedCostLike {
  colors: Record<string, number>;
  generic: number;
  hasX: boolean;
  hybrid?: Array<string[]>;
  hybrids?: Array<string[]>;
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
    strictColoredReductions: {},
    totalAdjustment: 0,
    sources: [],
    entries: [],
  };
}

function getSpellCostAdjustmentTraits(card: any) {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  const manaCostRaw = String(card?.mana_cost || card?.manaCost || '').toUpperCase();
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
  const addStrictColoredReduction = (sourceName: string, color: string, amount: number) => {
    const normalizedColor = String(color || '').toUpperCase();
    const normalizedAmount = Math.max(0, Number(amount) || 0);
    if (!normalizedColor || !normalizedAmount) return;
    plan.strictColoredReductions[normalizedColor] = (plan.strictColoredReductions[normalizedColor] || 0) + normalizedAmount;
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

    const chosenType = String(source.chosenCreatureType || '').trim().toLowerCase();
    const spellMatchesChosenType = Boolean(chosenType) && (
      traits.typeLine.includes(chosenType)
      || String(card?.oracle_text || card?.oracleText || '').toLowerCase().includes('changeling')
      || (Array.isArray(card?.keywords) && card.keywords.some((keyword: unknown) => String(keyword || '').toLowerCase() === 'changeling'))
    );
    if (sourceAppliesReductionToPlayer && spellMatchesChosenType) {
      const chosenTypeGenericReduction = permOracle.match(
        /(?:creature\s+)?spells(?:\s+you\s+cast)?\s+of\s+the\s+chosen\s+type(?:\s+you\s+cast)?\s+cost\s+\{(\d+)\}\s+less/i,
      );
      if (chosenTypeGenericReduction && (!chosenTypeGenericReduction[0].startsWith('creature ') || traits.isCreatureSpell)) {
        addGenericAdjustment(sourceName, -parseInt(chosenTypeGenericReduction[1], 10));
      }

      const chosenTypeColoredReduction = permOracle.match(
        /spells(?:\s+you\s+cast)?\s+of\s+the\s+chosen\s+type(?:\s+you\s+cast)?\s+cost\s+((?:\{[wubrgc]\})+)\s+less/i,
      );
      if (chosenTypeColoredReduction) {
        for (const color of chosenTypeColoredReduction[1].match(/[wubrgc]/gi) || []) {
          addStrictColoredReduction(sourceName, color, 1);
        }
      }
    }

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
      // Capture compound types like "artifact and enchantment" — a single-type capture
      // wrongly treated Aura of Silence as artifact-only and skipped enchantment spells.
      const taxMatch = permOracle.match(
        /(?:((?:artifact|enchantment|noncreature|nonartifact)(?:\s+and\s+(?:artifact|enchantment|noncreature|nonartifact))*)\s+)?spells(?: you cast| your opponents cast| opponents cast)? cost \{(\d+)\} more/i,
      );
      if (taxMatch) {
        const typeRestrictionRaw = String(taxMatch[1] || '').toLowerCase();
        const taxAmount = parseInt(taxMatch[2], 10) || 1;
        const restrictsArtifact = /\bartifact\b/.test(typeRestrictionRaw);
        const restrictsEnchantment = /\benchantment\b/.test(typeRestrictionRaw);
        const restrictsNoncreature = /\bnoncreature\b/.test(typeRestrictionRaw);
        const restrictsNonartifact = /\bnonartifact\b/.test(typeRestrictionRaw);
        const compoundArtifactAndEnchantment =
          (restrictsArtifact && restrictsEnchantment)
          || /\bartifact and enchantment\b/.test(permOracle);

        let applies = true;
        if (compoundArtifactAndEnchantment) {
          applies = traits.isArtifactOrEnchantment;
        } else if (restrictsArtifact && !traits.isArtifactSpell) {
          applies = false;
        } else if (restrictsEnchantment && !traits.isEnchantmentSpell) {
          applies = false;
        } else if (restrictsNoncreature && traits.isCreatureSpell) {
          applies = false;
        } else if (restrictsNonartifact && traits.isArtifactSpell) {
          applies = false;
        }

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
  const strictColoredReductions = hasStructuredAdjustment ? (adjustment.strictColoredReductions || {}) : {};

  if (
    !genericAdjustment
    && Object.keys(coloredReductions).length === 0
    && Object.keys(strictColoredReductions).length === 0
  ) return parsedCost;

  const hybridEntries = Array.isArray(parsedCost.hybrid)
    ? parsedCost.hybrid.map((entry) => [...entry])
    : Array.isArray(parsedCost.hybrids)
      ? parsedCost.hybrids.map((entry) => [...entry])
      : undefined;

  const result: ParsedCostLike = {
    colors: { ...parsedCost.colors },
    generic: parsedCost.generic,
    hasX: Boolean(parsedCost.hasX),
    ...(Array.isArray(hybridEntries)
      ? { hybrid: hybridEntries.map((entry) => [...entry]), hybrids: hybridEntries.map((entry) => [...entry]) }
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

  for (const [color, count] of Object.entries(strictColoredReductions)) {
    const available = result.colors[color] || 0;
    result.colors[color] = Math.max(0, available - Math.max(0, Number(count) || 0));
  }

  // Generic cost reduction only reduces the generic portion of the cost.
  // Leftover reduction after generic is exhausted does NOT remove colored pips
  // (CR 601.2f / cost-reduction: {1} less cannot make {U} free).
  let remainingReduction = Math.abs(Math.min(genericAdjustment, 0));
  const genericReduction = Math.min(result.generic, remainingReduction);
  result.generic -= genericReduction;

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