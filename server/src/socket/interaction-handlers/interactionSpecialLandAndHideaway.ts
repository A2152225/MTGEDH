/**
 * socket/interaction-handlers/interactionSpecialLandAndHideaway.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: SPECIAL_LAND_ABILITIES table (hybrid/storage/animate/hideaway
 *   lands), hideaway activation-condition evaluation, WORD_TO_NUMBER, and
 *   life-payment parsing for activation costs.
 * Public entry symbols: SPECIAL_LAND_ABILITIES, evaluateHideawayActivationCondition,
 *   WORD_TO_NUMBER, getLifePaymentForActivationCost.
 */

import { detectHideawayAbility } from "../../state/modules/triggered-abilities";
import { getTotalCreaturePower } from "../../state/modules/game-state-effects.js";

function getLibraryCountForPlayer(game: any, playerId: string): number {
  const libraries = (game as any)?.libraries;
  if (libraries && typeof libraries.get === 'function') {
    const library = libraries.get(playerId);
    if (Array.isArray(library)) {
      return library.length;
    }
  }

  return Number(game?.state?.zones?.[playerId]?.libraryCount || 0);
}

function getHandCountForPlayer(game: any, playerId: string): number {
  const zones = game?.state?.zones?.[playerId];
  if (Array.isArray(zones?.hand)) {
    return zones.hand.length;
  }

  return Number(zones?.handCount || 0);
}

export function evaluateHideawayActivationCondition(game: any, playerId: string, permanent: any): {
  met: boolean;
  message?: string;
} {
  const cardName = String(permanent?.card?.name || permanent?.name || 'This land');
  const hideawayAbility = detectHideawayAbility(permanent?.card);
  const condition = hideawayAbility?.condition || 'unknown';

  switch (condition) {
    case 'Attacked with 3+ creatures this turn': {
      const creaturesAttacked = Number(game?.state?.creaturesAttackedThisTurn?.[playerId] || 0);
      if (creaturesAttacked >= 3) {
        return { met: true };
      }

      return {
        met: false,
        message: `${cardName}'s hideaway ability requires you to attack with three or more creatures this turn. (You attacked with ${creaturesAttacked})`,
      };
    }
    case 'Control creatures with total power 10+': {
      const totalPower = getTotalCreaturePower(game as any, playerId);
      if (totalPower >= 10) {
        return { met: true };
      }

      return {
        met: false,
        message: `${cardName}'s hideaway ability requires creatures you control to have total power 10 or greater. (Current total power: ${totalPower})`,
      };
    }
    case 'A library has 20 or fewer cards': {
      const players = Array.isArray(game?.state?.players) ? game.state.players : [];
      const hasSmallLibrary = players.some((player: any) => getLibraryCountForPlayer(game, String(player?.id || '')) <= 20);
      if (hasSmallLibrary) {
        return { met: true };
      }

      return {
        met: false,
        message: `${cardName}'s hideaway ability requires a library to have 20 or fewer cards.`,
      };
    }
    case 'Each player has no cards in hand': {
      const players = Array.isArray(game?.state?.players) ? game.state.players : [];
      const allHandsEmpty = players.every((player: any) => getHandCountForPlayer(game, String(player?.id || '')) === 0);
      if (allHandsEmpty) {
        return { met: true };
      }

      return {
        met: false,
        message: `${cardName}'s hideaway ability requires each player to have no cards in hand.`,
      };
    }
    case 'An opponent was dealt 7+ damage this turn': {
      const players = Array.isArray(game?.state?.players) ? game.state.players : [];
      const damageTakenThisTurnByPlayer = game?.state?.damageTakenThisTurnByPlayer || {};
      const opponentLostSevenOrMore = players.some((player: any) => {
        const candidateId = String(player?.id || '');
        return candidateId !== playerId && Number(damageTakenThisTurnByPlayer[candidateId] || 0) >= 7;
      });
      if (opponentLostSevenOrMore) {
        return { met: true };
      }

      return {
        met: false,
        message: `${cardName}'s hideaway ability requires an opponent to have been dealt 7 or more damage this turn.`,
      };
    }
    default:
      return { met: true };
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Mapping of number words to numeric values for parsing ability text.
 * Used for interpreting draw counts, damage amounts, etc. in oracle text.
 */
export const WORD_TO_NUMBER: Record<string, number> = {
  'one': 1, 'a': 1, 'an': 1, '1': 1,
  'two': 2, '2': 2,
  'three': 3, '3': 3,
  'four': 4, '4': 4,
  'five': 5, '5': 5,
  'six': 6, '6': 6,
  'seven': 7, '7': 7,
  'eight': 8, '8': 8,
  'nine': 9, '9': 9,
  'ten': 10, '10': 10,
};

export function getLifePaymentForActivationCost(activationCost: unknown): number {
  const match = String(activationCost || '').trim().match(
    /\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i
  );
  if (!match) {
    return 0;
  }

  const rawAmount = String(match[1] || '').trim().toLowerCase();
  const numericAmount = Number.parseInt(rawAmount, 10);
  if (Number.isFinite(numericAmount)) {
    return Math.max(0, numericAmount);
  }

  return Math.max(0, Number(WORD_TO_NUMBER[rawAmount] || 0));
}

// ============================================================================
// Special Land Activated Abilities Configuration
// ============================================================================

/**
 * Configuration for lands with special activated abilities beyond standard mana production.
 * These include:
 * - Hybrid mana cost lands that produce multiple mana (Graven Cairns, Cascade Bluffs, etc.)
 * - Storage counter lands (Calciform Pools, Dreadship Reef, etc.)
 * - Creature-lands (Mutavault, Inkmoth Nexus, etc.)
 * - Hideaway lands (Windbrisk Heights, Mosswort Bridge, etc.)
 */
interface LandAbilityConfig {
  /** Type of special ability */
  type: 'hybrid_mana_production' | 'storage_counter' | 'animate' | 'hideaway';
  
  /** For hybrid_mana_production: cost to activate (e.g., "{B/R}, {T}") */
  cost?: string;
  
  /** For hybrid_mana_production: colors that can be produced (e.g., ['B', 'R']) */
  colors?: string[];
  
  /** For hybrid_mana_production: total mana produced (e.g., 2 for Graven Cairns) */
  totalMana?: number;
  
  /** For storage_counter: counter type (e.g., "storage") */
  counterType?: string;
  
  /** For animate: power/toughness when animated */
  power?: number;
  toughness?: number;
  
  /** For animate: types to add when animated */
  creatureTypes?: string[];
  
  /** For hideaway: number of cards to exile */
  hideawayCount?: number;
}

export const SPECIAL_LAND_ABILITIES: Record<string, LandAbilityConfig> = {
  // Hybrid mana production lands - pay hybrid cost, tap, choose how to distribute 2 mana
  'graven cairns': {
    type: 'hybrid_mana_production',
    cost: '{B/R}',
    colors: ['B', 'R'],
    totalMana: 2,
  },
  'cascade bluffs': {
    type: 'hybrid_mana_production',
    cost: '{U/R}',
    colors: ['U', 'R'],
    totalMana: 2,
  },
  'twilight mire': {
    type: 'hybrid_mana_production',
    cost: '{B/G}',
    colors: ['B', 'G'],
    totalMana: 2,
  },
  'mystic gate': {
    type: 'hybrid_mana_production',
    cost: '{W/U}',
    colors: ['W', 'U'],
    totalMana: 2,
  },
  'fire-lit thicket': {
    type: 'hybrid_mana_production',
    cost: '{R/G}',
    colors: ['R', 'G'],
    totalMana: 2,
  },
  'wooded bastion': {
    type: 'hybrid_mana_production',
    cost: '{G/W}',
    colors: ['G', 'W'],
    totalMana: 2,
  },
  'fetid heath': {
    type: 'hybrid_mana_production',
    cost: '{W/B}',
    colors: ['W', 'B'],
    totalMana: 2,
  },
  'flooded grove': {
    type: 'hybrid_mana_production',
    cost: '{G/U}',
    colors: ['G', 'U'],
    totalMana: 2,
  },
  'sunken ruins': {
    type: 'hybrid_mana_production',
    cost: '{U/B}',
    colors: ['U', 'B'],
    totalMana: 2,
  },
  'rugged prairie': {
    type: 'hybrid_mana_production',
    cost: '{R/W}',
    colors: ['R', 'W'],
    totalMana: 2,
  },
  
  // Storage counter lands
  'calciform pools': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['W', 'U'],
  },
  'dreadship reef': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['U', 'B'],
  },
  'molten slagheap': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['B', 'R'],
  },
  'fungal reaches': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['R', 'G'],
  },
  'saltcrusted steppe': {
    type: 'storage_counter',
    counterType: 'storage',
    colors: ['G', 'W'],
  },
  
  // Creature-lands
  'mutavault': {
    type: 'animate',
    power: 2,
    toughness: 2,
    creatureTypes: ['all'], // Special: has all creature types
  },
  
  // Hideaway lands
  'windbrisk heights': {
    type: 'hideaway',
    hideawayCount: 4,
  },
  'mosswort bridge': {
    type: 'hideaway',
    hideawayCount: 4,
  },
  'shelldock isle': {
    type: 'hideaway',
    hideawayCount: 4,
  },
  'howltooth hollow': {
    type: 'hideaway',
    hideawayCount: 4,
  },
  'spinerock knoll': {
    type: 'hideaway',
    hideawayCount: 4,
  },
};
