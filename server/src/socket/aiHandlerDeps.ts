/**
 * socket/aiHandlerDeps.ts
 *
 * Injected helpers for AI scheduler <-> game-flow / priority / resolution
 * circular calls. Extracted leaves must not import ai.ts or ai-handlers/index.ts.
 *
 * Parent calls setAIHandlerDeps after the remaining cores are defined.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../shared/src/types.js";

export type AIScheduledActionKind = "gameFlow" | "priority";

export type AIHandlerDeps = {
  handleAIGameFlow: (io: Server, gameId: string, playerId: PlayerID) => Promise<void>;
  handleAIPriority: (io: Server, gameId: string, playerId: PlayerID) => Promise<void>;
  handleAIResolutionStep: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    step: any,
  ) => Promise<void>;
  handleAIMulligan: (io: Server, gameId: string, playerId: PlayerID) => Promise<boolean>;
  isAIPlayer: (gameId: string, playerId: PlayerID) => boolean;
  chooseCardsToDiscard: (game: any, playerId: PlayerID, discardCount: number) => string[];
  scoreAISacrificePermanentForManaAbility: (game: any, playerId: PlayerID, permanent: any) => number;
  findZoneCardById: (
    game: any,
    cardId: string,
    preferredZones?: string[],
  ) => { card: any; ownerId: string; zone: string } | null;
  chooseAIManaColorForActivation: (game: any, playerId: PlayerID, producedColors: string[]) => string;
  getAIAttackingPermanents: (game: any) => any[];
  getPaymentSources: (
    game: any,
    playerId: PlayerID,
    cost: { colors: Record<string, number>; generic: number },
  ) => Array<{
    sourceId: string;
    produceColor: string;
    abilityId?: string;
    count?: number;
    sacrificedPermanentIds?: string[];
  }>;
  chooseAIXValueSelection: (game: any, playerId: PlayerID, step: any) => number;
  chooseAIAdditionalCostCardIds: (game: any, playerId: PlayerID, step: any, amount: number) => string[];
  chooseAISpellPaymentSelections: (...args: any[]) => Promise<any>;
  getAIManaLifeEffect: (card: any, producesColoredMana: boolean) => { amount: number; isDamage: boolean };
  resolveAIActivatedAbilityId: (action: any, permanent: any) => string | undefined;
  chooseAISacrificePermanentForManaAbility: (game: any, playerId: PlayerID, permanent: any, costSection: string) => any;
  chooseAIReturnToHandPermanentForManaAbility: (game: any, playerId: PlayerID, permanent: any, costSection: string) => any;
  buildAIActivatedAbilityResolverCandidates: (permanent: any) => Array<{ id: string; text: string; effect?: string }>;
  executeAIActivateAbility: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    action: any,
    continueAfterResolution?: boolean,
  ) => Promise<boolean>;
  cloneAISpellPaymentSimulationGame: (game: any) => any;
  buildAISpellPaymentPlan: (
    game: any,
    playerId: PlayerID,
    parsedCost: any,
    excludePermanentIds?: string[],
  ) => { payment: Array<{ permanentId: string; mana: string; count?: number; abilityId?: string }> } | null;
  chooseAISacrificePermanentsForManaAbility: (
    game: any,
    playerId: PlayerID,
    sourcePermanent: any,
    costSection: string,
    unavailablePermanentIds?: Set<string>,
  ) => string[];
  buildAIAvailableManaForSpellPayment: (
    game: any,
    playerId: PlayerID,
    paymentSources: Array<{ sourceId: string; produceColor: string; abilityId?: string; count?: number; sacrificedPermanentIds?: string[] }>,
  ) => Record<string, number>;
  getAINonTapManaAbilityCandidates: (
    game: any,
    playerId: PlayerID,
    parsedCost: any,
    excludedHandCardIds?: string[],
  ) => Array<{ permanent: any; action: any }>;
  tryAIResponseActions: (io: Server, gameId: string, playerId: PlayerID, game: any) => Promise<boolean>;
  enumerateAIActionCandidates: (game: any, playerId: PlayerID, query: any) => Promise<any[]>;
  captureAICastControlFlowSnapshot: (gameId: string, game: any, playerId: PlayerID) => any;
  didAICastAttemptChangeControlFlow: (
    gameId: string,
    game: any,
    playerId: PlayerID,
    candidate: any,
    before: any,
  ) => boolean;
  getAIActionContext: (game: any) => any;
  getAIMaxHandSize: (game: any, playerId: PlayerID) => number;
  checkShouldTapLandsForManaRetention: (game: any, playerId: PlayerID) => { shouldTap: boolean; reason: string };
  executeAITapLandsForMana: (io: Server, gameId: string, playerId: PlayerID) => Promise<boolean>;
  executeAIPlayLand: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    cardId: string,
    sourceZone?: any,
    selectedFaceIndex?: number,
  ) => Promise<boolean>;
  executeAICastSpell: (io: Server, gameId: string, playerId: PlayerID, candidate: any) => Promise<boolean>;
  executeAICastCommander: (io: Server, gameId: string, playerId: PlayerID, candidate: any) => Promise<boolean>;
  isAISpellContextuallyUseful: (game: any, playerId: PlayerID, card: any) => boolean;
  calculateResponseSpellPriority: (
    card: any,
    game: any,
    playerId: PlayerID,
    adjustedCost?: { generic: number; colors: Record<string, number> },
  ) => number;
  isAIFailedSpellCastCard: (game: any, playerId: string, cardId: string) => boolean;
  calculateSpellPriority: (
    card: any,
    game: any,
    playerId: PlayerID,
    adjustedCost?: { generic: number; colors: Record<string, number> },
  ) => number;
  getAISourceCards: (game: any, playerId: PlayerID, sourceZone: any) => any[];
  applyAISelectedLandFace: (card: any, selectedFaceIndex?: number) => void;
  requestAISharedLandPlay: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    request: { cardId: string; sourceZone: any; selectedFaceIndex?: number },
  ) => Promise<boolean>;
  didAIAbilityActivationProgress: (before: any, after: any) => boolean;
  requestAISharedBattlefieldAbilityActivation: (
    io: Server,
    gameId: string,
    playerId: PlayerID,
    request: { permanentId: string; abilityId: string; xValue?: unknown; drainQueuedSteps?: boolean },
  ) => Promise<boolean>;
  getSpellCmc: (cost: { generic: number; colors: Record<string, number> }) => number;
  findPlayableLand: (game: any, playerId: PlayerID) => any;
  findCastableCommander: (game: any, playerId: PlayerID, options?: any) => any;
};

let current: Partial<AIHandlerDeps> = {};

export function setAIHandlerDeps(overrides: Partial<AIHandlerDeps>): void {
  current = { ...current, ...overrides };
}

export function getAIHandlerDeps(): AIHandlerDeps {
  return current as AIHandlerDeps;
}
