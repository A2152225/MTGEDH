/**
 * Plot keyword ability (Rule 702.170)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.170. Plot
 * 702.170a Plot is a keyword ability that functions while the card with plot is in a player's 
 * hand. "Plot [cost]" means "Any time you have priority during your main phase while the stack 
 * is empty, you may exile this card from your hand and pay [cost]. It becomes a plotted card."
 * 702.170b Exiling a card using its plot ability is a special action, which doesn't use the stack.
 * 702.170c In addition to the plot special action, some spells and abilities cause a card in 
 * exile to become plotted.
 * 702.170d A plotted card's owner may cast it from exile without paying its mana cost during 
 * their main phase while the stack is empty during any turn after the turn in which it became 
 * plotted.
 */

export interface PlotAbility {
  readonly type: 'plot';
  readonly source: string;
  readonly plotCost: string;
  readonly isPlotted: boolean;
  readonly turnPlotted?: number;
}

/**
 * Create a plot ability
 * Rule 702.170a
 * @param source - The card with plot
 * @param plotCost - Cost to plot the card
 * @returns Plot ability object
 */
export function plot(source: string, plotCost: string): PlotAbility {
  return {
    type: 'plot',
    source,
    plotCost,
    isPlotted: false,
  };
}

/**
 * Plot a card from hand (special action)
 * Rule 702.170a - Exile and pay cost
 * Rule 702.170b - Special action, doesn't use stack
 * @param ability - Plot ability
 * @param currentTurn - Turn number when plotted
 * @returns Updated ability
 */
export function plotCard(ability: PlotAbility, currentTurn: number): PlotAbility {
  return {
    ...ability,
    isPlotted: true,
    turnPlotted: currentTurn,
  };
}

/**
 * Check if can cast plotted card
 * Rule 702.170d - Can cast after turn it was plotted
 * @param ability - Plot ability
 * @param currentTurn - Current turn number
 * @returns True if can cast
 */
export function canCastPlotted(ability: PlotAbility, currentTurn: number): boolean {
  if (!ability.isPlotted || !ability.turnPlotted) {
    return false;
  }
  return currentTurn > ability.turnPlotted;
}

/**
 * Cast plotted card
 * Rule 702.170d - Cast without paying mana cost
 * @param ability - Plot ability
 * @returns Updated ability
 */
export function castPlotted(ability: PlotAbility): PlotAbility {
  return {
    ...ability,
    isPlotted: false,
  };
}

/**
 * Check if card is plotted
 * @param ability - Plot ability
 * @returns True if plotted
 */
export function isPlotted(ability: PlotAbility): boolean {
  return ability.isPlotted;
}

/**
 * Multiple instances of plot are not redundant
 * @param abilities - Array of plot abilities
 * @returns False
 */
export function hasRedundantPlot(abilities: readonly PlotAbility[]): boolean {
  return false;
}
