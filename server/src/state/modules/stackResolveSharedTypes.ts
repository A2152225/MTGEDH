import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { categorizeSpell } from '../../rules-engine/targeting.js';

export type InstantSorcerySpellShapeFlags = {
  normalizedOracleTextLower: string;
  skipLegacySpellCategorization: boolean;
  isRiteOfHarmonyStyleWindow: boolean;
  isDivineReckoningStyleChoice: boolean;
  isPrisonersDilemmaStyleChoice: boolean;
  isSummonsOfSarumanStyle: boolean;
  isNibelheimAflameStyleSweep: boolean;
  hasNibelheimGraveyardRider: boolean;
};

export type InstantSorceryPrefaceSpellShapeFields = Omit<
  InstantSorcerySpellShapeFlags,
  'normalizedOracleTextLower'
>;

export type ExecuteTriggerEffectFn = (  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  item?: any,
) => void;

export type StackActivatedAbilityLateHandlerDeps = {
  executeTriggerEffect: ExecuteTriggerEffectFn;
};

export type StackActivatedAbilityLateHandlerOptions = {
  item: any;
  controller: PlayerID;
  targets: any[];
} & StackActivatedAbilityLateHandlerDeps;

export type StackActivatedAbilityHandlerContext = {
  item: any;
  controller: PlayerID;
};

export type ResolveTopOfStackContinuation = {  item: any;
  card: any;
  controller: PlayerID;
  targets: any[];
  spellXValue: unknown;
  effectiveCard: any;
  effectiveTypeLine: string;
  fallbackOracleText: string;
  bumpSeq: () => void;
};

export type ResolveTopOfStackPrefaceResult =
  | { handled: true }
  | ({ handled: false } & ResolveTopOfStackContinuation);

export type InstantSorceryOracleIrSpellOutcome = {
  oracleIrSpellHandled: boolean;
  spellSpec: ReturnType<typeof categorizeSpell> | null;
};

export type InstantSorceryRemovalTargetMetadata = {
  targetControllerForTokenCreation: PlayerID | null;
  targetControllerForRemovalEffects: PlayerID | null;
  targetPowerBeforeRemoval: number;
  targetSpellControllerForSupplemental: PlayerID | null;
  targetSpellNameForSupplemental: string;
};

export type InstantSorceryPrefaceContinuation = {
  oracleText: string;
  oracleTextLower: string;
} & InstantSorceryPrefaceSpellShapeFields &
  InstantSorceryOracleIrSpellOutcome &
  InstantSorceryRemovalTargetMetadata;

export type InstantSorceryPrefaceResult =
  | { handled: true }
  | ({ handled: false } & InstantSorceryPrefaceContinuation);
export type TriggerEffectLegacyBodyContinuation = {
  desc: string;
  descriptionForOracleFallback: string;
  isKynaiosEffect: boolean;
  sourceNameLower: string;
  triggerSourceNameLower: string;
  opponents: any[];
  players: any[];
  battlefield: any[];
};

export type TriggerEffectLegacyBodyResult =
  | { handled: true; legacyHandler: string }
  | ({ handled: false } & TriggerEffectLegacyBodyContinuation);

export type TriggerLegacyTailResult =
  | { handled: true; legacyHandler?: string }
  | { handled: false };

export type InstantSorceryStackResolveOptions = {
  controller: PlayerID;
  card: any;
  effectiveCard: any;
  item: any;
  targets: any[];
  spellXValue: unknown;
  executeTriggerEffect: ExecuteTriggerEffectFn;
};

export type InstantSorceryPrefaceOptions = Omit<
  InstantSorceryStackResolveOptions,
  'executeTriggerEffect'
>;

export type InstantSorceryOracleIrSpellOptions = Pick<
  InstantSorceryPrefaceOptions,
  'controller' | 'card' | 'effectiveCard' | 'item' | 'targets' | 'spellXValue'
> & {
  oracleText: string;
  selectedModes: any[];
  existingChosenColor: unknown;
  existingChosenCreatureType: string;
  skipLegacySpellCategorization: boolean;
};

export type InstantSorceryRemovalTargetMetadataOptions = {
  targets: any[];
  effectiveCard: any;
  oracleTextLower: string;
};

export type PermanentSpellStackResolveOptions = {
  controller: PlayerID;
  card: any;
  effectiveCard: any;
  effectiveTypeLine: string;
  item: any;
  targets: any[];
  fallbackOracleText: string;
  bumpSeq: () => void;
};

export type PermanentBattlefieldEntryOptions = Omit<
  PermanentSpellStackResolveOptions,
  'bumpSeq'
>;

export type PermanentBattlefieldEntryOutcome =
  | { mutateResolved: true }
  | {
      mutateResolved: false;
      newPermanent: any;
      newPermId: string;
      isCreature: boolean;
      shouldEnterTapped: boolean;
      hasSummoningSickness: boolean;
      hasHaste: boolean;
    };

export type PermanentSpellPostEntryOptions = {
  controller: PlayerID;
  card: any;
  effectiveCard: any;
  newPermanent: any;
  newPermId: string;
  isCreature: boolean;
};

export type TriggeredAbilityStackResolveOptions = {
  item: any;
  controller: PlayerID;
  executeTriggerEffect: ExecuteTriggerEffectFn;
};

export type TriggeredAbilityDeferralOptions = {
  controller: PlayerID;
  triggerController: PlayerID;
  sourceName: string;
  description: string;
  effectText: string;
  triggerType: unknown;
  sourceId: unknown;
  optionalTriggeredAbilityDecisionApplied: boolean;
  state: any;
  bumpSeq: () => void;
  executeTriggerEffect: ExecuteTriggerEffectFn;
};