/**
 * card-data-tables-handlers/cardDataTablesTapUntapAbilities.ts
 * Origin parent: server/src/state/modules/triggers/card-data-tables.ts
 * Cluster moved: KNOWN_TAP_UNTAP_ABILITIES.
 * Public entry symbols: KNOWN_TAP_UNTAP_ABILITIES.
 */

// ============================================================================
// Tap/Untap Abilities
// ============================================================================

/**
 * Known cards with activated tap/untap abilities
 * Dawnglare Invoker, Opposition, etc.
 */
export const KNOWN_TAP_UNTAP_ABILITIES: Record<string, {
  effect: string;
  cost: string;
  targetType: 'permanent' | 'creature' | 'land' | 'all_creatures';
  targetController?: 'any' | 'opponent' | 'you';
  tapOrUntap: 'tap' | 'untap';
}> = {
  "dawnglare invoker": {
    effect: "Tap all creatures target player controls",
    cost: "{8}",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "opposition": {
    effect: "Tap target artifact, creature, or land",
    cost: "Tap an untapped creature you control",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "citanul hierophants": {
    effect: "Creatures you control have 'T: Add {G}'",
    cost: "{T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'tap',
  },
  "cryptic command": {
    effect: "Tap all creatures your opponents control",
    cost: "{1}{U}{U}{U}",
    targetType: 'all_creatures',
    targetController: 'opponent',
    tapOrUntap: 'tap',
  },
  "sleep": {
    effect: "Tap all creatures target player controls, they don't untap",
    cost: "{2}{U}{U}",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "icy manipulator": {
    effect: "Tap target artifact, creature, or land",
    cost: "{1}, {T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "puppet strings": {
    effect: "Tap or untap target creature",
    cost: "{2}, {T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'tap', // Can be either
  },
  "aphetto alchemist": {
    effect: "Untap target artifact or creature",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "kiora's follower": {
    effect: "Untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "vizier of tumbling sands": {
    effect: "Untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "seeker of skybreak": {
    effect: "Untap target creature",
    cost: "{T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "fatestitcher": {
    effect: "Tap or untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap', // Can be either
  },
  "myr galvanizer": {
    effect: "Untap each other Myr you control",
    cost: "{1}, {T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "intruder alarm": {
    effect: "Untap all creatures when a creature enters",
    cost: "Trigger",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "awakening": {
    effect: "Untap all creatures and lands during each player's upkeep",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "seedborn muse": {
    effect: "Untap all permanents you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "prophet of kruphix": {
    effect: "Untap all creatures and lands you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "murkfiend liege": {
    effect: "Untap all green and/or blue creatures you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "quest for renewal": {
    effect: "Untap all creatures you control during each other player's untap step",
    cost: "Trigger (4+ counters)",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "pemmin's aura": {
    effect: "Untap enchanted creature",
    cost: "{U}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "freed from the real": {
    effect: "Untap enchanted creature",
    cost: "{U}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "umbral mantle": {
    effect: "Untap equipped creature, +2/+2",
    cost: "{3}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "sword of the paruns": {
    effect: "Untap equipped creature",
    cost: "{3}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "staff of domination": {
    effect: "Untap target creature",
    cost: "{3}, {T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "thousand-year elixir": {
    effect: "Untap target creature",
    cost: "{1}, {T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
};
