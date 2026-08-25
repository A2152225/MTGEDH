/**
 * Extracted from loopShortcuts.ts: loop-shortcut types and storage constants.
 * Cluster moved: JsonValue through RankedTarget, including clampLoopShortcutIterations.
 * Public: LoopShortcutTargetMatchProfile, LOOP_SHORTCUT_MAX_ITERATIONS,
 * LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS, clampLoopShortcutIterations,
 * LoopShortcutPromptFingerprint, LoopShortcutPaymentItemTemplate,
 * LoopShortcutPromptTemplate, LoopShortcutDraft, SavedLoopShortcut,
 * LoopShortcutSequenceItem
 *
 * Leaf must not import loopShortcuts.ts or loopShortcuts-handlers/index.ts.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Characteristics of a recorded permanent choice, used to rebind to a live target. */
export type LoopShortcutTargetMatchProfile = {
  name?: string;
  typeLine?: string;
  isToken?: boolean;
  tapped?: boolean;
  isCommander?: boolean;
};

export type LoopShortcutIdTemplate =
  | {
      kind: 'specific_ids';
      ids: string[];
    }
  | {
      kind: 'select_valid_targets';
      count: number;
      preferTokens?: boolean;
      preferNonTokens?: boolean;
      requireSelfControlled?: boolean;
      preferTapped?: boolean;
      preferUntapped?: boolean;
      avoidCommanders?: boolean;
      matchProfiles?: LoopShortcutTargetMatchProfile[];
    };

export const LOOP_SHORTCUT_DRAFTS_STORAGE_KEY = 'mtgedh:loopShortcutDrafts';
export const LOOP_SHORTCUT_SAVED_STORAGE_KEY = 'mtgedh:loopShortcutSaved';

/** Soft cap — always allowed. Above this requires a self-sustaining loop. */
export const LOOP_SHORTCUT_MAX_ITERATIONS = 50;
/** Hard cap for self-sustaining loops (net resources do not decrease). */
export const LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS = 1000;

export function clampLoopShortcutIterations(raw: unknown): number {
  const n = Math.floor(Number(raw) || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS, n));
}

export type LoopShortcutPromptFingerprint = {
  stepType: string;
  sourceName?: string;
};

/** Recorded mana payment line item (cast / activation), with optional permanent rebind profile. */
export type LoopShortcutPaymentItemTemplate = {
  mana: string;
  abilityId?: string;
  count?: number;
  producedColors?: string[];
  fromRestrictedPool?: boolean;
  restrictedIndex?: number;
  paymentSourceId?: string;
  /** Sticky id fallback when no battlefield match profile is available. */
  permanentId?: string;
  permanentProfile?: LoopShortcutTargetMatchProfile;
  sacrificedProfiles?: LoopShortcutTargetMatchProfile[];
  sacrificedPermanentIds?: string[];
};

export type LoopShortcutPromptTemplate =
  | {
      kind: 'option_choice';
      optionIds: string[];
    }
  | LoopShortcutIdTemplate
  | {
      kind: 'selection_object';
      literalFields?: Record<string, JsonValue>;
      targetId?: LoopShortcutIdTemplate;
      targetIds?: LoopShortcutIdTemplate;
    }
  | {
      kind: 'literal_selection';
      selection: JsonValue;
    }
  | {
      kind: 'payment_selection';
      alternateCostId?: string;
      xValue?: number;
      payment: LoopShortcutPaymentItemTemplate[];
      convokeCreatureProfiles?: LoopShortcutTargetMatchProfile[];
      sneakCreatureProfile?: LoopShortcutTargetMatchProfile;
      otherLiteralFields?: Record<string, JsonValue>;
    };

/** Step types whose string/number/boolean selections are values, not permanent target ids. */
export const LITERAL_PRIMITIVE_STEP_TYPES = new Set([
  'mana_color_selection',
  'color_choice',
  'card_name_choice',
  'creature_type_choice',
  'life_payment',
  'number_choice',
  'x_value_selection',
  'explore_decision',
]);

export const MANA_COLOR_NAME_RE = /^(white|blue|black|red|green|colorless)$/i;

export const PAYMENT_OBJECT_KNOWN_KEYS = new Set([
  'payment',
  'alternateCostId',
  'xValue',
  'convokeTappedCreatures',
  'sneakReturnedCreatureId',
]);

export type LoopShortcutDraft = {
  name: string;
  items: LoopShortcutSequenceItem[];
  iterationCount: number;
  updatedAt: number;
};

export type SavedLoopShortcut = LoopShortcutDraft & {
  id: string;
};

export type LoopShortcutSequenceItem =
  | {
      kind: 'emit';
      event: string;
      payload: Record<string, unknown>;
      label: string;
    }
  | {
      kind: 'resolution_response';
      fingerprint: LoopShortcutPromptFingerprint;
      template: LoopShortcutPromptTemplate;
      label: string;
    };

export type RankedTarget = {
  id: string;
  index: number;
  score: number;
};
