/**
 * Rule 701: Keyword Actions
 * 
 * Implements the specialized verbs used in Magic card text.
 * These "keywords" are game terms with specific rules meanings.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 701
 */

/**
 * Rule 701.2: Activate
 * 
 * To activate an activated ability is to put it onto the stack and pay its costs,
 * so that it will eventually resolve and have its effect.
 * 
 * Reference: Rule 701.2, also see Rule 602
 */
export interface ActivateAction {
  readonly type: 'activate';
  readonly abilityId: string;
  readonly controllerId: string;
}

/**
 * Rule 701.3: Attach
 * 
 * To attach an Aura, Equipment, or Fortification to an object or player means
 * to take it from where it currently is and put it onto that object or player.
 */
export interface AttachAction {
  readonly type: 'attach';
  readonly attachmentId: string; // Aura, Equipment, or Fortification
  readonly targetId: string; // Object or player to attach to
}

export interface AttachmentState {
  readonly id: string;
  readonly attachedTo: string | null;
  readonly timestamp: number; // Rule 701.3c: New timestamp on reattachment
}

/**
 * Rule 701.3a: Attachment validation
 */
export function canAttachTo(
  attachment: { id: string; type: 'aura' | 'equipment' | 'fortification' },
  target: { id: string; type: string }
): boolean {
  // Auras must be able to enchant the target
  // Equipment must be able to equip the target
  // Fortifications must be able to fortify the target
  return true; // Simplified - full validation requires enchant/equip/fortify rules
}

/**
 * Rule 701.3a: Perform attachment
 * Rule 701.3c: Attaching gives new timestamp
 */
export function attachToObject(
  attachment: AttachmentState,
  targetId: string,
  timestamp: number
): AttachmentState {
  return {
    ...attachment,
    attachedTo: targetId,
    timestamp, // Rule 701.3c
  };
}

/**
 * Rule 701.3b: Invalid attachment attempts
 */
export function attemptAttach(
  attachment: AttachmentState,
  targetId: string,
  timestamp: number
): AttachmentState {
  // If already attached to this target, effect does nothing
  if (attachment.attachedTo === targetId) {
    return attachment;
  }
  
  // If can't attach, doesn't move
  // Simplified - would check canAttachTo in full implementation
  
  return attachToObject(attachment, targetId, timestamp);
}

/**
 * Rule 701.3d: Unattach
 * 
 * To "unattach" an Equipment from a creature means to move it away from that creature
 * so the Equipment is on the battlefield but is not equipping anything.
 */
export function unattach(attachment: AttachmentState): AttachmentState {
  return {
    ...attachment,
    attachedTo: null,
  };
}

export function isAttached(attachment: AttachmentState): boolean {
  return attachment.attachedTo !== null;
}

/**
 * Rule 701.4: Behold
 * 
 * "Behold a [quality]" means "Reveal a [quality] card from your hand or
 * choose a [quality] permanent you control on the battlefield."
 */
export interface BeholdAction {
  readonly type: 'behold';
  readonly playerId: string;
  readonly quality: string; // e.g., "legendary", "artifact"
  readonly choice: 'revealed-card' | 'chosen-permanent';
  readonly cardOrPermanentId: string;
}

/**
 * Rule 701.4b: Quality checking
 * 
 * The phrase "if a [quality] was beheld" refers to whether or not the object
 * had that quality at the time the player took that action.
 */
export function createBeholdAction(
  playerId: string,
  quality: string,
  choice: 'revealed-card' | 'chosen-permanent',
  cardOrPermanentId: string
): BeholdAction {
  return {
    type: 'behold',
    playerId,
    quality,
    choice,
    cardOrPermanentId,
  };
}

export function wasBeheld(action: BeholdAction, quality: string): boolean {
  return action.quality === quality;
}

/**
 * Rule 701.5: Cast
 * 
 * To cast a spell is to take it from the zone it's in (usually the hand),
 * put it on the stack, and pay its costs, so that it will eventually
 * resolve and have its effect.
 * 
 * Reference: Rule 701.5, also see Rule 601
 */
export interface CastAction {
  readonly type: 'cast';
  readonly spellId: string;
  readonly controllerId: string;
  readonly fromZone: string;
}

/**
 * Rule 701.6: Counter
 * 
 * To counter a spell or ability means to cancel it, removing it from the stack.
 * It doesn't resolve and none of its effects occur. A countered spell is put
 * into its owner's graveyard.
 */
export interface CounterAction {
  readonly type: 'counter';
  readonly targetType: 'spell' | 'ability';
  readonly targetId: string;
}

/**
 * Rule 701.6a: Countered spells go to graveyard
 */
export function counterSpell(spellId: string): CounterAction {
  return {
    type: 'counter',
    targetType: 'spell',
    targetId: spellId,
  };
}

export function counterAbility(abilityId: string): CounterAction {
  return {
    type: 'counter',
    targetType: 'ability',
    targetId: abilityId,
  };
}

/**
 * Rule 701.6b: No cost refund
 * 
 * The player who cast a countered spell or activated a countered ability
 * doesn't get a "refund" of any costs that were paid.
 */
export interface CounterResult {
  readonly countered: boolean;
  readonly costsRefunded: false; // Always false per Rule 701.6b
  readonly destination: 'graveyard' | 'ceases-to-exist';
}

export function getCounterResult(targetType: 'spell' | 'ability'): CounterResult {
  return {
    countered: true,
    costsRefunded: false, // Rule 701.6b
    destination: targetType === 'spell' ? 'graveyard' : 'ceases-to-exist',
  };
}

/**
 * Rule 701.7: Create
 * 
 * To create one or more tokens with certain characteristics, put the specified
 * number of tokens with the specified characteristics onto the battlefield.
 */
export interface CreateAction {
  readonly type: 'create';
  readonly controllerId: string;
  readonly count: number;
  readonly tokenType: string;
  readonly characteristics: Record<string, unknown>;
}

/**
 * Rule 701.7b: Replacement effects and token creation
 * 
 * If a replacement effect applies to a token being created, that effect applies
 * before considering any continuous effects that will modify the characteristics
 * of that token. If a replacement effect applies to a token entering the battlefield,
 * that effect applies after considering any continuous effects.
 */
export function createTokens(
  controllerId: string,
  count: number,
  tokenType: string,
  characteristics: Record<string, unknown> = {}
): CreateAction {
  return {
    type: 'create',
    controllerId,
    count,
    tokenType,
    characteristics,
  };
}

/**
 * Rule 701.8: Destroy
 * 
 * To destroy a permanent, move it from the battlefield to its owner's graveyard.
 */
export interface DestroyAction {
  readonly type: 'destroy';
  readonly permanentId: string;
}

/**
 * Rule 701.8b: Ways a permanent can be destroyed
 * 
 * The only ways a permanent can be destroyed are as a result of an effect that
 * uses the word "destroy" or as a result of the state-based actions that check
 * for lethal damage (see rule 704.5g) or damage from a source with deathtouch
 * (see rule 704.5h).
 */
export enum DestructionCause {
  DESTROY_KEYWORD = 'destroy-keyword',
  LETHAL_DAMAGE = 'lethal-damage', // Rule 704.5g
  DEATHTOUCH_DAMAGE = 'deathtouch-damage', // Rule 704.5h
}

export interface DestroyResult {
  readonly destroyed: boolean;
  readonly cause: DestructionCause;
  readonly regenerated: boolean; // Rule 701.8c
}

export function destroyPermanent(
  permanentId: string,
  cause: DestructionCause = DestructionCause.DESTROY_KEYWORD
): DestroyAction {
  return {
    type: 'destroy',
    permanentId,
  };
}

/**
 * Rule 701.8c: Regeneration
 * 
 * A regeneration effect replaces a destruction event.
 * See rule 701.19, "Regenerate."
 */
export function canBeDestroyed(
  permanentId: string,
  hasRegenerationShield: boolean
): boolean {
  // If regeneration shield, destruction is replaced
  return !hasRegenerationShield;
}

/**
 * Rule 701.9: Discard
 * 
 * To discard a card, move it from its owner's hand to that player's graveyard.
 */
export interface DiscardAction {
  readonly type: 'discard';
  readonly playerId: string;
  readonly mode: 'choice' | 'random' | 'opponent-choice';
  readonly cardId?: string; // Specified for choice/opponent-choice modes
  readonly discarderId?: string; // Player who chooses (for opponent-choice)
}

/**
 * Rule 701.9b: Discard modes
 * 
 * By default, effects that cause a player to discard a card allow the affected
 * player to choose which card to discard. Some effects, however, require a
 * random discard or allow another player to choose which card is discarded.
 */
export function discardCard(
  playerId: string,
  cardId: string
): DiscardAction {
  return {
    type: 'discard',
    playerId,
    mode: 'choice',
    cardId,
  };
}

export function discardRandom(playerId: string): DiscardAction {
  return {
    type: 'discard',
    playerId,
    mode: 'random',
  };
}

export function discardChosen(
  playerId: string,
  discarderId: string,
  cardId: string
): DiscardAction {
  return {
    type: 'discard',
    playerId,
    mode: 'opponent-choice',
    cardId,
    discarderId,
  };
}

/**
 * Rule 701.9c: Hidden zone handling
 * 
 * If a card is discarded, but an effect causes it to be put into a hidden zone
 * instead of into its owner's graveyard without being revealed, all values of
 * that card's characteristics are considered to be undefined.
 */
export interface DiscardResult {
  readonly discarded: boolean;
  readonly destination: 'graveyard' | 'hidden-zone';
  readonly revealed: boolean;
  readonly characteristicsDefined: boolean;
}

export function getDiscardResult(
  destination: 'graveyard' | 'hidden-zone',
  revealed: boolean
): DiscardResult {
  return {
    discarded: true,
    destination,
    revealed,
    // Rule 701.9c: If hidden and not revealed, characteristics are undefined
    characteristicsDefined: destination === 'graveyard' || revealed,
  };
}

/**
 * Union type for all keyword actions (Part 1)
 */
export type KeywordAction =
  | ActivateAction
  | AttachAction
  | BeholdAction
  | CastAction
  | CounterAction
  | CreateAction
  | DestroyAction
  | DiscardAction;
