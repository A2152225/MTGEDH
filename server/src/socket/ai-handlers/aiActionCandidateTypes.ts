/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: AI action-candidate type aliases used by handleAIPriority,
 * enumerateAIActionCandidates, findCastableSpells, and cast/land executors.
 *
 * Public entry symbols: AISupportedCardSourceZone, AICastRequestSourceZone,
 * AIPlayableLandCandidate, AICastableSpellCandidate, AICastableCommanderCandidate,
 * AIActivatedAbilityCandidate, AIActionCandidate, AIActionSelectionMode,
 * AIActionCandidateQuery, AICastAttemptDescriptor.
 * `roll_planar_die` is the free once-per-turn planar die roll (main phase 1 only).
 */
import type {
  SharedCommanderCastCandidate,
  SharedPlayableLandCandidate,
  SharedSpellSourceZone,
} from "../../state/modules/can-respond.js";

export type AISupportedCardSourceZone = SharedSpellSourceZone;
export type AICastRequestSourceZone = AISupportedCardSourceZone | 'command';

export type AIPlayableLandCandidate = SharedPlayableLandCandidate;

export type AICastableSpellCandidate = {
  card: any;
  castCard: any;
  sourceZone: AISupportedCardSourceZone;
  faceIndex?: number;
  fused?: boolean;
  cost: any;
  paymentCost?: any;
  timesKicked?: number;
  cmc: number;
  typeLine: string;
  priority: number;
};

export type AICastableCommanderCandidate = SharedCommanderCastCandidate;

export type AIActivatedAbilityCandidate = {
  action: any;
  reasoning?: string;
  confidence?: number;
};

export type AIActionCandidate =
  | { kind: 'play_land'; priority: number; land: AIPlayableLandCandidate }
  | { kind: 'cast_spell'; priority: number; spell: AICastableSpellCandidate }
  | { kind: 'cast_commander'; priority: number; commander: AICastableCommanderCandidate }
  | { kind: 'activate_ability'; priority: number; ability: AIActivatedAbilityCandidate }
  | { kind: 'roll_planar_die'; priority: number };

export type AIActionSelectionMode = 'main' | 'response';

export type AIActionCandidateQuery = {
  mode: AIActionSelectionMode;
  kinds?: AIActionCandidate['kind'][];
  willNeedToDiscard?: boolean;
};

export type AICastAttemptDescriptor = {
  card: any;
  castCard?: any;
  sourceZone: AICastRequestSourceZone;
};
