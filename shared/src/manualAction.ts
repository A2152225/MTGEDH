/**
 * shared/src/manualAction.ts
 *
 * Kitchen-table "manual mode" verbs for correcting a bad effect or applying
 * an unimplemented one. Mutations are physical table changes (no triggers,
 * no replacement effects) and are persisted as a single `manualAction` event
 * so replay/undo can reconstruct them.
 *
 * Verb list follows MTG_manual_action_verbs.xlsx (physical primitives +
 * parameters). Stack-cast / mode verbs stay in the normal card UI.
 */

export type ManualZone =
  | 'library'
  | 'hand'
  | 'graveyard'
  | 'exile'
  | 'battlefield'
  | 'stack'
  | 'command';

export type ManualVerbCategory =
  | 'Library'
  | 'Hand'
  | 'Graveyard'
  | 'Exile'
  | 'Battlefield'
  | 'Stack'
  | 'State & numbers'
  | 'Turn & game';

export type ManualVerbId =
  | 'draw_x'
  | 'look_at_top_x'
  | 'reveal_top_x'
  | 'search_library'
  | 'put_on_top'
  | 'put_on_bottom'
  | 'put_nth_from_top'
  | 'rearrange_top_x'
  | 'scry_x'
  | 'surveil_x'
  | 'mill_x'
  | 'shuffle'
  | 'shuffle_into'
  | 'exile_from_top'
  | 'discard'
  | 'bounce'
  | 'reveal_from_hand'
  | 'look_at_hand'
  | 'put_from_hand'
  | 'wheel'
  | 'return_from_graveyard'
  | 'reanimate'
  | 'exile_from_graveyard'
  | 'put_into_graveyard'
  | 'exile'
  | 'blink'
  | 'exile_face_down'
  | 'put_onto_battlefield'
  | 'create_token'
  | 'destroy'
  | 'sacrifice'
  | 'tap_untap'
  | 'attach'
  | 'unattach'
  | 'transform'
  | 'turn_face'
  | 'gain_control'
  | 'phase_out'
  | 'phase_in'
  | 'counter_spell'
  | 'add_counters'
  | 'proliferate'
  | 'gain_lose_life'
  | 'set_life'
  | 'deal_damage'
  | 'add_mana'
  | 'poison'
  | 'energy'
  | 'experience'
  | 'become_monarch'
  | 'extra_turn'
  | 'win_lose'
  | 'move_object';

export type ManualVerbParams = {
  player?: boolean;
  count?: boolean;
  amount?: boolean;
  objects?: ManualZone[] | 'any';
  destination?: ManualZone[];
  position?: boolean;
  nth?: boolean;
  tapped?: boolean;
  faceDown?: boolean;
  attachTo?: boolean;
  counterType?: boolean;
  manaColor?: boolean;
  token?: boolean;
  searchName?: boolean;
  scry?: boolean;
  surveil?: boolean;
  rearrange?: boolean;
  controller?: boolean;
  resource?: 'poison' | 'energy' | 'experience';
  outcome?: boolean;
  peek?: boolean;
};

export type ManualVerbDef = {
  id: ManualVerbId;
  category: ManualVerbCategory;
  label: string;
  behavior: string;
  params: ManualVerbParams;
};

export type ManualActionPayload = {
  verb: ManualVerbId;
  actorId: string;
  targetPlayerId?: string;
  objectIds?: string[];
  count?: number;
  amount?: number;
  fromZone?: ManualZone;
  toZone?: ManualZone;
  position?: 'top' | 'bottom' | 'nth';
  nth?: number;
  tapped?: boolean;
  faceDown?: boolean;
  controllerId?: string;
  attachToId?: string;
  counterType?: string;
  manaColor?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  tokenName?: string;
  tokenPower?: number;
  tokenToughness?: number;
  tokenTypeLine?: string;
  searchName?: string;
  keepTopIds?: string[];
  bottomIds?: string[];
  graveyardIds?: string[];
  libraryOrder?: string[];
  drawnCardIds?: string[];
  createdPermanentIds?: string[];
  shuffled?: boolean;
  outcome?: 'win' | 'lose';
  note?: string;
};

export const MANUAL_ZONES: readonly ManualZone[] = [
  'library',
  'hand',
  'graveyard',
  'exile',
  'battlefield',
  'stack',
  'command',
];

export const MANUAL_VERB_CATALOG: readonly ManualVerbDef[] = [
  { id: 'draw_x', category: 'Library', label: 'Draw X', behavior: 'Move the top X cards of a library to hand, one at a time.', params: { player: true, count: true } },
  { id: 'look_at_top_x', category: 'Library', label: 'Look at top X', behavior: 'Private peek at the top X cards. Nothing moves.', params: { player: true, count: true, peek: true } },
  { id: 'reveal_top_x', category: 'Library', label: 'Reveal top X', behavior: 'Show the top X cards to the table. Nothing moves.', params: { player: true, count: true, peek: true } },
  { id: 'search_library', category: 'Library', label: 'Search library', behavior: 'Find matching card(s) by name, move them, then shuffle.', params: { player: true, count: true, searchName: true, destination: ['hand', 'battlefield', 'graveyard', 'exile', 'library'] } },
  { id: 'put_on_top', category: 'Library', label: 'Put on top', behavior: 'Move chosen cards to the top of a library (last selected is the new top).', params: { player: true, objects: 'any' } },
  { id: 'put_on_bottom', category: 'Library', label: 'Put on bottom', behavior: 'Move chosen cards to the bottom of a library.', params: { player: true, objects: 'any' } },
  { id: 'put_nth_from_top', category: 'Library', label: 'Put Nth from top', behavior: 'Insert a card so N-1 cards are above it (bottom if the library is shorter).', params: { player: true, objects: 'any', nth: true } },
  { id: 'rearrange_top_x', category: 'Library', label: 'Rearrange top X', behavior: 'Peek the top X cards, then drag them into the new top-to-bottom order.', params: { player: true, count: true, rearrange: true } },
  { id: 'scry_x', category: 'Library', label: 'Scry X', behavior: 'Peek the top X cards, then drag some to the bottom. Order in each pile is kept.', params: { player: true, count: true, scry: true } },
  { id: 'surveil_x', category: 'Library', label: 'Surveil X', behavior: 'Peek the top X cards, then drag some to the graveyard. Order in each pile is kept.', params: { player: true, count: true, surveil: true } },
  { id: 'mill_x', category: 'Library', label: 'Mill X', behavior: 'Move the top X cards of a library to its owner’s graveyard.', params: { player: true, count: true } },
  { id: 'shuffle', category: 'Library', label: 'Shuffle', behavior: 'Randomize a library. The resulting order is recorded for replay.', params: { player: true } },
  { id: 'shuffle_into', category: 'Library', label: 'Shuffle into', behavior: 'Put chosen cards into a library, then shuffle.', params: { player: true, objects: 'any' } },
  { id: 'exile_from_top', category: 'Library', label: 'Exile from top', behavior: 'Move the top X cards of a library to exile.', params: { player: true, count: true, faceDown: true } },
  { id: 'discard', category: 'Hand', label: 'Discard', behavior: 'Move chosen hand cards to the graveyard.', params: { player: true, objects: ['hand'] } },
  { id: 'bounce', category: 'Hand', label: 'Return to hand', behavior: 'Move chosen objects to their owner’s hand.', params: { objects: 'any' } },
  { id: 'reveal_from_hand', category: 'Hand', label: 'Reveal from hand', behavior: 'Show chosen hand cards to the table. Nothing moves.', params: { player: true, objects: ['hand'], peek: true } },
  { id: 'look_at_hand', category: 'Hand', label: 'Look at hand', behavior: 'Private peek at a player’s hand. Nothing moves.', params: { player: true, peek: true } },
  { id: 'put_from_hand', category: 'Hand', label: 'Put from hand', behavior: 'Move a hand card straight to another zone, bypassing the stack.', params: { player: true, objects: ['hand'], destination: ['battlefield', 'graveyard', 'exile', 'library'], tapped: true } },
  { id: 'wheel', category: 'Hand', label: 'Wheel', behavior: 'Each player discards their hand, then draws the stated number.', params: { count: true } },
  { id: 'return_from_graveyard', category: 'Graveyard', label: 'Return from graveyard', behavior: 'Move graveyard cards to hand, library, or battlefield.', params: { objects: ['graveyard'], destination: ['hand', 'library', 'battlefield'], position: true, tapped: true } },
  { id: 'reanimate', category: 'Graveyard', label: 'Reanimate', behavior: 'Move a graveyard card onto the battlefield under a chosen controller.', params: { objects: ['graveyard'], controller: true, tapped: true } },
  { id: 'exile_from_graveyard', category: 'Graveyard', label: 'Exile from graveyard', behavior: 'Move graveyard cards to exile.', params: { objects: ['graveyard'] } },
  { id: 'put_into_graveyard', category: 'Graveyard', label: 'Put into graveyard', behavior: 'Move chosen objects to their owner’s graveyard.', params: { objects: 'any' } },
  { id: 'exile', category: 'Exile', label: 'Exile', behavior: 'Move chosen objects to exile.', params: { objects: 'any', faceDown: true } },
  { id: 'blink', category: 'Exile', label: 'Blink / flicker', behavior: 'Exile and immediately return as a new object (counters and attachments drop).', params: { objects: ['battlefield'], controller: true, tapped: true } },
  { id: 'exile_face_down', category: 'Exile', label: 'Exile face down', behavior: 'Move chosen objects to exile face down.', params: { objects: 'any' } },
  { id: 'put_onto_battlefield', category: 'Battlefield', label: 'Put onto battlefield', behavior: 'Move chosen cards onto the battlefield.', params: { objects: 'any', controller: true, tapped: true } },
  { id: 'create_token', category: 'Battlefield', label: 'Create token', behavior: 'Create token permanents with the given name and P/T.', params: { player: true, count: true, token: true, tapped: true } },
  { id: 'destroy', category: 'Battlefield', label: 'Destroy', behavior: 'Move battlefield permanents to their owner’s graveyard.', params: { objects: ['battlefield'] } },
  { id: 'sacrifice', category: 'Battlefield', label: 'Sacrifice', behavior: 'Move battlefield permanents to their owner’s graveyard (owner chooses).', params: { objects: ['battlefield'] } },
  { id: 'tap_untap', category: 'Battlefield', label: 'Tap / untap', behavior: 'Set tapped state on chosen permanents.', params: { objects: ['battlefield'], tapped: true } },
  { id: 'attach', category: 'Battlefield', label: 'Attach', behavior: 'Attach an Aura, Equipment, or Fortification to a host.', params: { objects: ['battlefield'], attachTo: true } },
  { id: 'unattach', category: 'Battlefield', label: 'Unattach', behavior: 'Clear the attachment link on chosen permanents.', params: { objects: ['battlefield'] } },
  { id: 'transform', category: 'Battlefield', label: 'Transform', behavior: 'Flip a double-faced permanent to its other face.', params: { objects: ['battlefield'] } },
  { id: 'turn_face', category: 'Battlefield', label: 'Turn face down / up', behavior: 'Set face-down (morph) state on chosen permanents.', params: { objects: ['battlefield'], faceDown: true } },
  { id: 'gain_control', category: 'Battlefield', label: 'Gain control', behavior: 'Change controller of chosen permanents. Owner does not change.', params: { objects: ['battlefield'], controller: true } },
  { id: 'phase_out', category: 'Battlefield', label: 'Phase out', behavior: 'Treat chosen permanents as if they do not exist.', params: { objects: ['battlefield'] } },
  { id: 'phase_in', category: 'Battlefield', label: 'Phase in', behavior: 'Return phased-out permanents.', params: { objects: ['battlefield'] } },
  { id: 'counter_spell', category: 'Stack', label: 'Counter spell / ability', behavior: 'Remove a stack object without resolving. Spells go to the graveyard.', params: { objects: ['stack'] } },
  { id: 'add_counters', category: 'State & numbers', label: 'Add / remove counters', behavior: 'Place or remove counters on a permanent. Negative amount removes.', params: { objects: ['battlefield'], counterType: true, amount: true } },
  { id: 'proliferate', category: 'State & numbers', label: 'Proliferate', behavior: 'Each chosen permanent or player with counters gets one more of each kind they have.', params: { objects: ['battlefield'], player: true } },
  { id: 'gain_lose_life', category: 'State & numbers', label: 'Gain / lose life', behavior: 'Adjust a life total. Negative amount loses life.', params: { player: true, amount: true } },
  { id: 'set_life', category: 'State & numbers', label: 'Set life', behavior: 'Overwrite a life total.', params: { player: true, amount: true } },
  { id: 'deal_damage', category: 'State & numbers', label: 'Deal damage', behavior: 'Mark damage on a creature without moving it. If the total reaches its toughness, it then goes to the graveyard (no triggers). A later Bolt can finish a Flame-Lashed creature. Players lose life; planeswalkers lose loyalty. Negative amount heals marked damage.', params: { player: true, objects: ['battlefield'], amount: true } },
  { id: 'add_mana', category: 'State & numbers', label: 'Add mana', behavior: 'Add mana of one color to a pool.', params: { player: true, amount: true, manaColor: true } },
  { id: 'poison', category: 'State & numbers', label: 'Poison counters', behavior: 'Add or remove poison counters on a player.', params: { player: true, amount: true, resource: 'poison' } },
  { id: 'energy', category: 'State & numbers', label: 'Energy counters', behavior: 'Add or remove energy counters on a player.', params: { player: true, amount: true, resource: 'energy' } },
  { id: 'experience', category: 'State & numbers', label: 'Experience counters', behavior: 'Add or remove experience counters on a player.', params: { player: true, amount: true, resource: 'experience' } },
  { id: 'become_monarch', category: 'State & numbers', label: 'Become the monarch', behavior: 'Give the monarch designation to a player.', params: { player: true } },
  { id: 'extra_turn', category: 'Turn & game', label: 'Take extra turn', behavior: 'Insert an extra turn for a player after this one.', params: { player: true } },
  { id: 'win_lose', category: 'Turn & game', label: 'Win / lose the game', behavior: 'Mark a player as having won or lost.', params: { player: true, outcome: true } },
  { id: 'move_object', category: 'Battlefield', label: 'Move object', behavior: 'Generic slide between zones. Position applies when the destination is a library.', params: { objects: 'any', destination: ['library', 'hand', 'graveyard', 'exile', 'battlefield', 'command'], position: true, nth: true, tapped: true, controller: true, faceDown: true } },
];

export const MANUAL_VERB_BY_ID: Readonly<Record<ManualVerbId, ManualVerbDef>> =
  Object.fromEntries(MANUAL_VERB_CATALOG.map((verb) => [verb.id, verb])) as Readonly<Record<ManualVerbId, ManualVerbDef>>;

export function isManualVerbId(value: unknown): value is ManualVerbId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MANUAL_VERB_BY_ID, value);
}

export function formatManualZone(zone: ManualZone): string {
  if (zone === 'command') return 'command zone';
  return zone;
}
