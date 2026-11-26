/**
 * Outcome sweep board: shapes an oracle card into a hand card and seeds a minimal 2-player
 * main-phase board with plenty of mana and a legal target of every common kind (creatures on
 * both sides, artifacts, enchantments, a planeswalker, lands, cards in hand, library and graveyard).
 */

export const SWEEP_P1 = 'p1';
export const SWEEP_P2 = 'p2';
export const SWEEP_SOURCE_CARD_ID = 'sweep_source';

export type SweepFace = {
  name?: string; mana_cost?: string; type_line?: string; oracle_text?: string;
  power?: string; toughness?: string; loyalty?: string; defense?: string; colors?: string[];
};

export type SweepCard = SweepFace & {
  cmc?: number; color_identity?: string[]; keywords?: string[]; layout?: string;
  card_faces?: SweepFace[]; produced_mana?: string[]; set?: string;
};

const CARD_FIELDS = ['name', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense',
  'colors', 'color_identity', 'keywords', 'layout', 'produced_mana', 'set'] as const;
const FACE_FIELDS = ['name', 'mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'colors'] as const;

export function shapeSweepCard(raw: Record<string, unknown>): SweepCard {
  const card: any = {};
  for (const key of CARD_FIELDS) if (raw[key] !== undefined) card[key] = raw[key];
  if (Array.isArray(raw.card_faces)) {
    card.card_faces = (raw.card_faces as any[]).map((face) => {
      const out: any = {};
      for (const key of FACE_FIELDS) if (face?.[key] !== undefined) out[key] = face[key];
      return out;
    });
  }
  return card as SweepCard;
}

/** Front face characteristics (what is cast from hand by default). */
export function primaryFace(card: SweepCard): SweepFace {
  const face = Array.isArray(card.card_faces) && card.card_faces.length > 0 ? card.card_faces[0] : undefined;
  if (!face) return card;
  return {
    name: face.name || card.name,
    mana_cost: face.mana_cost ?? card.mana_cost,
    type_line: face.type_line || card.type_line,
    oracle_text: card.oracle_text || face.oracle_text,
    power: face.power ?? card.power,
    toughness: face.toughness ?? card.toughness,
    loyalty: face.loyalty ?? card.loyalty,
    defense: face.defense ?? card.defense,
    colors: face.colors ?? card.colors,
  };
}

export function fullOracleText(card: SweepCard): string {
  if (card.oracle_text) return String(card.oracle_text);
  return (card.card_faces || []).map((face) => String(face.oracle_text || '')).filter(Boolean).join('\n');
}

function vanilla(id: string, name: string, typeLine: string, extra: Record<string, unknown> = {}) {
  return { id, name, type_line: typeLine, oracle_text: '', mana_cost: '', cmc: 0, colors: [], ...extra };
}

const BASICS: Array<[string, string]> = [['Plains', 'W'], ['Island', 'U'], ['Swamp', 'B'], ['Mountain', 'R'], ['Forest', 'G']];

function basic(id: string, name: string) {
  return vanilla(id, name, `Basic Land \u2014 ${name}`, { oracle_text: `({T}: Add {${BASICS.find(([n]) => n === name)?.[1] || 'C'}}.)` });
}

function bears(id: string) {
  return vanilla(id, 'Grizzly Bears', 'Creature \u2014 Bear', { mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', colors: ['G'] });
}

function giant(id: string) {
  return vanilla(id, 'Hill Giant', 'Creature \u2014 Giant', { mana_cost: '{3}{R}', cmc: 4, power: '3', toughness: '3', colors: ['R'] });
}

function memnite(id: string) {
  return vanilla(id, 'Memnite', 'Artifact Creature \u2014 Construct', { mana_cost: '{0}', power: '1', toughness: '1' });
}

function bolt(id: string) {
  return vanilla(id, 'Lightning Bolt', 'Instant', { mana_cost: '{R}', cmc: 1, colors: ['R'], oracle_text: 'Lightning Bolt deals 3 damage to any target.' });
}

function permanentFrom(card: any, controller: string, extra: Record<string, unknown> = {}) {
  const power = Number.parseInt(String(card.power ?? ''), 10);
  const toughness = Number.parseInt(String(card.toughness ?? ''), 10);
  return {
    id: `perm_${card.id}`,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    summoningSickness: false,
    ...(Number.isFinite(power) ? { basePower: power } : {}),
    ...(Number.isFinite(toughness) ? { baseToughness: toughness } : {}),
    card: { ...card, zone: 'battlefield' },
    ...extra,
  };
}

/** Battlefield permanent for the swept card itself (used when a cast fails, or for direct placement). */
export function sourcePermanent(card: SweepCard, controller = SWEEP_P1) {
  const face = primaryFace(card);
  const handCard = sweepHandCard(card);
  const loyalty = Number.parseInt(String(face.loyalty ?? ''), 10);
  return permanentFrom({ ...handCard, name: face.name || card.name, mana_cost: face.mana_cost, type_line: face.type_line, oracle_text: face.oracle_text || '',
    power: face.power, toughness: face.toughness, loyalty: face.loyalty, zone: 'battlefield' }, controller,
    Number.isFinite(loyalty) ? { counters: { loyalty }, loyalty } : {});
}

export function sweepHandCard(card: SweepCard) {
  const face = primaryFace(card);
  // Keep the Scryfall shape (DFCs have no top-level oracle_text) so the engine picks faces itself.
  return { ...card, id: SWEEP_SOURCE_CARD_ID, manaCost: card.mana_cost ?? face.mana_cost, zone: 'hand' };
}

export function fullManaPool(amount = 10) {
  return {
    W: amount, U: amount, B: amount, R: amount, G: amount, C: amount,
    white: amount, blue: amount, black: amount, red: amount, green: amount, colorless: amount,
  };
}

export function refillManaPool(state: any, playerId = SWEEP_P1): void {
  state.manaPool = state.manaPool || {};
  state.manaPool[playerId] = fullManaPool();
}

function sideBoard(pid: string, tag: string) {
  const library = Array.from({ length: 16 }, (_, i) => {
    const id = `${tag}_lib_${i}`;
    if (i % 4 === 0) return basic(id, BASICS[i % 5][0]);
    if (i % 4 === 1) return bears(id);
    if (i % 4 === 2) return bolt(id);
    return giant(id);
  }).map((card) => ({ ...card, zone: 'library' }));
  const graveyard = [bears(`${tag}_gy_0`), bolt(`${tag}_gy_1`), basic(`${tag}_gy_2`, 'Forest'), memnite(`${tag}_gy_3`)]
    .map((card) => ({ ...card, zone: 'graveyard' }));
  const hand = [basic(`${tag}_hand_0`, 'Island'), bears(`${tag}_hand_1`), bolt(`${tag}_hand_2`)].map((card) => ({ ...card, zone: 'hand' }));
  const creature = permanentFrom(pid === SWEEP_P1 ? bears(`${tag}_bf_creature`) : giant(`${tag}_bf_creature`), pid);
  // Every side has an untapped creature, an artifact creature and a noncreature artifact, an enchantment and an
  // Aura on its creature, five untapped basics plus one tapped land (for untap effects) and a planeswalker.
  const battlefield: any[] = [
    creature,
    permanentFrom(memnite(`${tag}_bf_artifact`), pid),
    permanentFrom(vanilla(`${tag}_bf_trinket`, 'Sweep Trinket', 'Artifact', { mana_cost: '{1}', cmc: 1 }), pid),
    permanentFrom(vanilla(`${tag}_bf_enchantment`, 'Sweep Enchantment', 'Enchantment'), pid),
    permanentFrom(vanilla(`${tag}_bf_aura`, 'Sweep Aura', 'Enchantment \u2014 Aura', { oracle_text: 'Enchant creature', mana_cost: '{W}', cmc: 1, colors: ['W'] }),
      pid, { attachedTo: creature.id }),
    ...BASICS.map(([name], i) => permanentFrom(basic(`${tag}_bf_land_${i}`, name), pid)),
    permanentFrom(basic(`${tag}_bf_land_tapped`, 'Plains'), pid, { tapped: true }),
    permanentFrom(vanilla(`${tag}_bf_walker`, pid === SWEEP_P2 ? 'Sweep Walker' : 'Sweep Strider', `Legendary Planeswalker \u2014 ${pid === SWEEP_P2 ? 'Sweep' : 'Strider'}`,
      { loyalty: '5' }), pid, { counters: { loyalty: 5 }, loyalty: 5 }),
  ];
  (creature as any).attachments = [`perm_${tag}_bf_aura`];
  return { library, graveyard, hand, battlefield };
}

/**
 * Resources only some cards need, seeded per card so they do not change every other card's diff:
 * energy for {E} costs, speed 4 for "Max speed" abilities, and a big creature for
 * "sacrifice a creature with power N or greater" costs.
 */
export function seedCardResourceNeeds(state: any, card: SweepCard): void {
  const text = fullOracleText(card).toLowerCase();
  if (/\{e\}|\benergy\b/.test(text)) state.energy = { ...(state.energy || {}), [SWEEP_P1]: 60 };
  if (/\bmax speed\b/.test(text)) state.speed = { ...(state.speed || {}), [SWEEP_P1]: 4 };
  const power = text.match(/sacrifice an? creature with power (\d+) or greater/);
  if (power && Array.isArray(state.battlefield)) {
    state.battlefield.push(permanentFrom(vanilla('p1_bf_fodder', 'Sweep Brute', 'Creature \u2014 Beast',
      { mana_cost: '{4}{G}', cmc: 5, power: power[1], toughness: power[1], colors: ['G'] }), SWEEP_P1));
  }
  seedCardTargetNeeds(state, text);
}

const COLOR_CODES: Array<[string, string]> = [['white', 'W'], ['blue', 'U'], ['black', 'B'], ['red', 'R'], ['green', 'G']];

function seedCreature(state: any, pid: string, id: string, name: string, colors: string[],
  extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}): void {
  const cost = '{1}' + (colors.length ? colors.map((c) => '{' + c + '}').join('') : '{1}');
  state.battlefield.push(permanentFrom(vanilla(id, name, 'Creature \u2014 Soldier',
    { mana_cost: cost, cmc: 1 + Math.max(1, colors.length), power: '2', toughness: '2', colors, ...cardExtra }), pid, extra));
}

function seedHandCard(state: any, pid: string, card: any): void {
  const zone = state.zones?.[pid];
  if (!zone || !Array.isArray(zone.hand)) return;
  zone.hand.push({ ...card, zone: 'hand' });
  zone.handCount = zone.hand.length;
}

/**
 * Legal targets only some cards need, seeded per card (from its lowercased oracle text) so the
 * other cards' diffs do not change: nonbasic lands, creatures of a named color or multicolored,
 * tapped, attacking (flagged as attacking during main phase 1 so the source can still be cast),
 * entered-this-turn and token creatures, Equipment, and matching cards in the opponent's hand.
 * Planeswalkers and nonX creatures are already on the base board.
 */
export function seedCardTargetNeeds(state: any, text: string): void {
  if (!Array.isArray(state.battlefield)) return;
  if (/\bnonbasic lands?\b/.test(text)) {
    for (const i of [1, 2]) {
      state.battlefield.push(permanentFrom(vanilla('p2_bf_nonbasic_' + i, 'Sweep Ruins ' + i, 'Land', { oracle_text: '{T}: Add {C}.' }), SWEEP_P2));
    }
  }
  for (const [word, code] of COLOR_CODES) {
    if (!new RegExp('\\b' + word + ' creatures?\\b').test(text)) continue;
    const title = word[0].toUpperCase() + word.slice(1);
    // The base board already has a red creature for p2 (Hill Giant) and a green one for p1 (Grizzly Bears).
    if (word !== 'red') seedCreature(state, SWEEP_P2, 'p2_bf_' + word, 'Sweep ' + title + ' Knight', [code]);
    if (word !== 'green' && new RegExp('\\b' + word + ' creatures? you control\\b').test(text)) {
      seedCreature(state, SWEEP_P1, 'p1_bf_' + word, 'Sweep ' + title + ' Squire', [code]);
    }
  }
  if (/\bmulticolou?red creatures?\b/.test(text)) seedCreature(state, SWEEP_P2, 'p2_bf_multicolored', 'Sweep Gold Knight', ['W', 'U']);
  if (/\btapped creatures?\b/.test(text)) seedCreature(state, SWEEP_P2, 'p2_bf_tapped', 'Sweep Sentry', ['R'], { tapped: true });
  if (/\battacking (?:or blocking )?creatures?\b/.test(text)) {
    seedCreature(state, SWEEP_P2, 'p2_bf_attacker', 'Sweep Raider', ['R'], { attacking: SWEEP_P1, attackedThisTurn: true });
  }
  if (/\bcreatures? that entered (?:the battlefield )?this turn\b/.test(text)) {
    seedCreature(state, SWEEP_P2, 'p2_bf_newcomer', 'Sweep Newcomer', ['R'], { enteredThisTurn: true });
  }
  const tokenCard = { type_line: 'Token Creature \u2014 Soldier', isToken: true };
  if (/\btokens? you control\b/.test(text)) seedCreature(state, SWEEP_P1, 'p1_bf_token', 'Sweep Soldier', ['W'], { isToken: true }, tokenCard);
  else if (/\btarget (?:[a-z-]+ )*token\b/.test(text)) seedCreature(state, SWEEP_P2, 'p2_bf_token', 'Sweep Soldier', ['W'], { isToken: true }, tokenCard);
  const equipment = (id: string) => vanilla(id, 'Sweep Blade', 'Artifact \u2014 Equipment',
    { mana_cost: '{1}', cmc: 1, oracle_text: 'Equipped creature gets +1/+1.\nEquip {1}' });
  if (/\btarget (?:[a-z-]+ )*equipment\b/.test(text)) state.battlefield.push(permanentFrom(equipment('p2_bf_equipment'), SWEEP_P2));
  if (/\bequipment you control\b/.test(text)) state.battlefield.push(permanentFrom(equipment('p1_bf_equipment'), SWEEP_P1));
  const handPick = text.match(/\bchoose an? ([a-z ,]+?) card from (?:it|their hand|that player's hand)/);
  if (handPick) {
    const words = handPick[1];
    if (/\bspirit\b/.test(words)) seedHandCard(state, SWEEP_P2, vanilla('p2_hand_spirit', 'Sweep Spirit', 'Creature \u2014 Spirit', { mana_cost: '{1}{U}', cmc: 2, power: '1', toughness: '1', colors: ['U'] }));
    if (/\barcane\b/.test(words)) seedHandCard(state, SWEEP_P2, vanilla('p2_hand_arcane', 'Sweep Rite', 'Instant \u2014 Arcane', { mana_cost: '{U}', cmc: 1, colors: ['U'], oracle_text: 'Draw a card.' }));
    if (/\bartifact\b/.test(words)) seedHandCard(state, SWEEP_P2, vanilla('p2_hand_artifact', 'Sweep Bauble', 'Artifact', { mana_cost: '{1}', cmc: 1 }));
    if (/\benchantment\b/.test(words)) seedHandCard(state, SWEEP_P2, vanilla('p2_hand_enchantment', 'Sweep Charm', 'Enchantment', { mana_cost: '{1}{W}', cmc: 2, colors: ['W'] }));
  }
}

/** Seeds the board. The swept card goes to p1's hand unless `placeOnBattlefield` is set. */
export function seedSweepBoard(game: any, card: SweepCard, options: { placeOnBattlefield?: boolean } = {}): void {
  const p1 = sideBoard(SWEEP_P1, 'p1');
  const p2 = sideBoard(SWEEP_P2, 'p2');
  const handCard = sweepHandCard(card);
  const p1Hand = options.placeOnBattlefield ? p1.hand : [handCard, ...p1.hand];
  const battlefield = [...p1.battlefield, ...p2.battlefield];
  if (options.placeOnBattlefield) battlefield.push(sourcePermanent(card) as any);
  const zone = (side: ReturnType<typeof sideBoard>, hand: any[]) => ({
    hand, handCount: hand.length,
    library: side.library, libraryCount: side.library.length,
    graveyard: side.graveyard, graveyardCount: side.graveyard.length,
    exile: [], exileCount: 0,
  });
  Object.assign(game.state, {
    players: [
      { id: SWEEP_P1, name: 'Sweep P1', spectator: false, life: 40, isAI: false },
      { id: SWEEP_P2, name: 'Sweep P2', spectator: false, life: 40, isAI: false },
    ],
    startingLife: 40,
    life: { [SWEEP_P1]: 40, [SWEEP_P2]: 40 },
    phase: 'precombatMain',
    step: 'MAIN1',
    turnPlayer: SWEEP_P1,
    activePlayer: SWEEP_P1,
    priority: SWEEP_P1,
    turnNumber: 3,
    stack: [],
    landsPlayedThisTurn: { [SWEEP_P1]: 0, [SWEEP_P2]: 0 },
    manaPool: { [SWEEP_P1]: fullManaPool(), [SWEEP_P2]: fullManaPool(0) },
    battlefield,
    zones: { [SWEEP_P1]: zone(p1, p1Hand), [SWEEP_P2]: zone(p2, p2.hand) },
  });
  seedCardResourceNeeds(game.state, card);
  game.libraries = game.libraries || new Map();
  game.libraries.set(SWEEP_P1, p1.library);
  game.libraries.set(SWEEP_P2, p2.library);
}
