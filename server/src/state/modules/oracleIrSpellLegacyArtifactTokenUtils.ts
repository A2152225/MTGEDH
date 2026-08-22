import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { createToken } from './counters_tokens.js';

export interface CommonArtifactTokenSpec {
  name: string;
  options: any;
  basePower?: number;
  baseToughness?: number;
}

export type CommonArtifactTokenKind =
  | 'treasure'
  | 'clue'
  | 'food'
  | 'incubator'
  | 'lander'
  | 'mutagen'
  | 'gold'
  | 'stoneforged blade'
  | 'rock'
  | 'sword'
  | 'nalaar aetherjet'
  | 'vehicle'
  | 'junk'
  | 'map'
  | 'powerstone'
  | 'vibranium'
  | 'blood';

export const PREDEFINED_TRIGGER_ARTIFACT_TOKEN_KINDS = [
  'food',
  'treasure',
  'clue',
  'map',
  'blood',
  'gold',
  'powerstone',
  'vibranium',
] as const;

export type PredefinedTriggerArtifactTokenKind = (typeof PREDEFINED_TRIGGER_ARTIFACT_TOKEN_KINDS)[number];

interface CommonArtifactTokenDefinition {
  name: string;
  typeLine: string;
  abilities: string[];
  basePower?: number;
  baseToughness?: number;
}

const COMMON_ARTIFACT_TOKEN_DEFINITIONS: Record<CommonArtifactTokenKind, CommonArtifactTokenDefinition> = {
  treasure: {
    name: 'Treasure',
    typeLine: 'Token Artifact — Treasure',
    abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
  },
  clue: {
    name: 'Clue',
    typeLine: 'Token Artifact — Clue',
    abilities: ['{2}, Sacrifice this artifact: Draw a card.'],
  },
  food: {
    name: 'Food',
    typeLine: 'Token Artifact — Food',
    abilities: ['{2}, {T}, Sacrifice this artifact: You gain 3 life.'],
  },
  incubator: {
    name: 'Incubator',
    typeLine: 'Token Artifact — Incubator',
    abilities: ['{2}: Transform this artifact.'],
  },
  lander: {
    name: 'Lander',
    typeLine: 'Token Artifact — Lander',
    abilities: [
      '{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    ],
  },
  mutagen: {
    name: 'Mutagen',
    typeLine: 'Token Artifact — Mutagen',
    abilities: ['{1}, {T}, Sacrifice this artifact: Put a +1/+1 counter on target creature. Activate only as a sorcery.'],
  },
  gold: {
    name: 'Gold',
    typeLine: 'Token Artifact — Gold',
    abilities: ['Sacrifice this artifact: Add one mana of any color.'],
  },
  'stoneforged blade': {
    name: 'Stoneforged Blade',
    typeLine: 'Token Artifact — Equipment',
    abilities: ['Indestructible', 'Equipped creature gets +5/+5 and has double strike.', 'Equip {0}'],
  },
  rock: {
    name: 'Rock',
    typeLine: 'Token Artifact — Equipment',
    abilities: [
      'Equipped creature has "{1}, {T}, Sacrifice Rock: This creature deals 2 damage to any target."',
      'Equip {1}',
    ],
  },
  sword: {
    name: 'Sword',
    typeLine: 'Token Artifact — Equipment',
    abilities: ['Equipped creature gets +1/+1', 'Equip {2}'],
  },
  'nalaar aetherjet': {
    name: 'Nalaar Aetherjet',
    typeLine: 'Token Artifact — Vehicle',
    abilities: [
      'Flying',
      'Crew 2 (Tap any number of creatures you control with total power 2 or more: This token becomes an artifact creature until end of turn.)',
    ],
  },
  vehicle: {
    name: 'Vehicle',
    typeLine: 'Token Artifact — Vehicle',
    abilities: [
      'Crew 1 (Tap any number of creatures you control with total power 1 or more: This token becomes an artifact creature until end of turn.)',
    ],
    basePower: 3,
    baseToughness: 2,
  },
  junk: {
    name: 'Junk',
    typeLine: 'Token Artifact — Junk',
    abilities: [
      '{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.',
    ],
  },
  map: {
    name: 'Map',
    typeLine: 'Token Artifact — Map',
    abilities: ['{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.'],
  },
  powerstone: {
    name: 'Powerstone',
    typeLine: 'Token Artifact — Powerstone',
    abilities: ["{T}: Add {C}. This mana can't be spent to cast a nonartifact spell."],
  },
  vibranium: {
    name: 'Vibranium',
    typeLine: 'Token Artifact — Vibranium',
    abilities: [
      'Indestructible',
      "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
    ],
  },
  blood: {
    name: 'Blood',
    typeLine: 'Token Artifact — Blood',
    abilities: ['{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.'],
  },
};

const COMMON_ARTIFACT_TOKEN_MATCHERS: Array<{ kind: CommonArtifactTokenKind; test: (lower: string) => boolean }> = [
  { kind: 'treasure', test: (lower) => lower.includes('treasure') },
  { kind: 'clue', test: (lower) => lower.includes('clue') },
  { kind: 'food', test: (lower) => lower.includes('food') },
  { kind: 'incubator', test: (lower) => lower.includes('incubator') },
  { kind: 'lander', test: (lower) => lower.includes('lander') },
  { kind: 'mutagen', test: (lower) => lower.includes('mutagen') },
  { kind: 'gold', test: (lower) => lower.includes('gold') },
  { kind: 'stoneforged blade', test: (lower) => lower.includes('stoneforged blade') },
  { kind: 'rock', test: (lower) => /\brock\b/i.test(lower) },
  { kind: 'sword', test: (lower) => /\bsword\b/i.test(lower) },
  { kind: 'nalaar aetherjet', test: (lower) => lower.includes('nalaar aetherjet') },
  { kind: 'vehicle', test: (lower) => /\bvehicle\b/i.test(lower) },
  { kind: 'junk', test: (lower) => lower.includes('junk') },
  { kind: 'map', test: (lower) => lower.includes('map') },
  { kind: 'powerstone', test: (lower) => lower.includes('powerstone') },
  { kind: 'vibranium', test: (lower) => lower.includes('vibranium') },
  { kind: 'blood', test: (lower) => lower.includes('blood') },
];

export function isPredefinedTriggerArtifactTokenKind(kind: string): kind is PredefinedTriggerArtifactTokenKind {
  return (PREDEFINED_TRIGGER_ARTIFACT_TOKEN_KINDS as readonly string[]).includes(String(kind || '').trim().toLowerCase());
}

export function resolveCommonArtifactTokenKind(tokenText: string): CommonArtifactTokenKind | null {
  const lower = String(tokenText || '').toLowerCase();
  if (!lower) return null;

  for (const matcher of COMMON_ARTIFACT_TOKEN_MATCHERS) {
    if (matcher.test(lower)) {
      return matcher.kind;
    }
  }

  return null;
}

export function buildCommonArtifactTokenSpec(kind: CommonArtifactTokenKind): CommonArtifactTokenSpec {
  const definition = COMMON_ARTIFACT_TOKEN_DEFINITIONS[kind];
  return {
    name: definition.name,
    basePower: definition.basePower,
    baseToughness: definition.baseToughness,
    options: {
      colors: [],
      typeLine: definition.typeLine,
      abilities: definition.abilities,
      isArtifact: true,
    },
  };
}

export function parseCommonArtifactTokenOptions(tokenText: string): CommonArtifactTokenSpec | null {
  const kind = resolveCommonArtifactTokenKind(tokenText);
  if (!kind) return null;
  return buildCommonArtifactTokenSpec(kind);
}

export function createCommonArtifactTokenFromText(
  ctx: GameContext,
  controller: PlayerID,
  tokenText: string,
  count = 1,
): boolean {
  const spec = parseCommonArtifactTokenOptions(tokenText);
  if (!spec) return false;

  const entersTapped = /\btapped\b/i.test(String(tokenText || ''));
  const sourceText = String(tokenText || '').trim();
  createToken(
    ctx as any,
    controller,
    spec.name,
    count,
    spec.basePower,
    spec.baseToughness,
    {
      ...spec.options,
      ...(entersTapped ? { entersTapped: true } : {}),
      // Pass through create-clause / reminder text when callers supply more than a bare kind name
      // (e.g. Vibranium parenthetical) so oracle_text can retain mana reminder lines.
      ...(sourceText ? { sourceText } : {}),
    },
  );
  return true;
}

export function createTreasureToken(ctx: GameContext, controller: PlayerID): void {
  createCommonArtifactTokenFromText(ctx, controller, 'treasure');
}

export function createCommonArtifactTokenByKind(
  ctx: GameContext,
  controller: PlayerID,
  kind: CommonArtifactTokenKind,
  count = 1,
): boolean {
  const spec = buildCommonArtifactTokenSpec(kind);
  createToken(
    ctx as any,
    controller,
    spec.name,
    count,
    spec.basePower,
    spec.baseToughness,
    spec.options,
  );
  return true;
}
