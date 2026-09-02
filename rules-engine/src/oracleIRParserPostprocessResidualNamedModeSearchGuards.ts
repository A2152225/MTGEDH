// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// named-mode search reminders and the fragments that lower alongside them.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { parseQuantityWithOptionalWhereX } from './oracleIRParserQuantityHelpers';

export function parseResidualNamedModeSearchGuardsOne(
  raw: string, sequence: { sequence?: 'then' }, step: OracleEffectStep
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const namedModeSearch = raw.match(/^[A-Z][^()]+\(\s*Search\s+for\s+(.+?)\s*\.\s*\)$/i);
  if (namedModeSearch) {
    return [{
      kind: 'search_library',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: String(namedModeSearch[1] || '').trim() },
      destination: 'hand',
      revealFound: true,
      maxResults: 1,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const pass41SearchResidual = /^search\b/i;
  if (pass41SearchResidual.test(raw)) {
    return staticMetadata('search residual', raw);
  }

  if (/^[a-z][a-z\s-]+\s+creatures\s+and\s+other\s+[a-z][a-z\s-]+\s+creatures\s+get\s+[+-]\d+\/[+-]\d+$/i.test(raw)) {
    return staticMetadata('static power/toughness bonus', raw);
  }

  const pass41ResidualMetadata = /^(?:room\s+abilities\b|ruhan\s+attacks\b|ruin\s+crab$|saga,\s+or\s+shrine\s+spell\b|sanctum\s+of\s+nature,\s+exile\s+them$|scatter\s+them$|scrycast\b|scuttletide$|secretly\s+choose\b|see\s+rule\s+702\b|seedguide\s+ash$|separate\b|shackle\s+only\b|shards\s+you\s+control\b|she(?:'|�)s\s+a\s+land\s+named\b|sheoldred,\s+the\s+apocalypse$|shroud\b|shuffle\s+your\s+whammy\s+deck$|simultaneously\s+untap\b|sinecure\b|size\s*?|skip\s+(?:that\s+draw|the\s+untap\s+step)\b|skittering\s+crustacean$|sliver\s+creatures\b|sliver\s+spells\b|slivers\s+you\s+control\b|snake\s+offering\b|snakes\s+you\s+control\b|soospect\b|sorcery,\s+or\s+wizard\s+spell\b|sorry,\b|soulshift\s+4,\s+soulshift\s+4\b|space\s+sculptor\b|spacecraft,\s+or\s+planet\b|spaceship\b|spark\b|specific\s+editions\b|spell\s+mastery\b|spellmorph\b|spells?\b|star\s+with\b|start\s+a\s+30-minute\s+timer$|starting\b|stun\s+counters\b|support\s+4\s+and\s+investigate\b|surveils,\s+or\s+searches\b|swampwalk\b|switch\s+upkeep\s+steps\b|sygg,\s+river\s+guide$|tails\s+is\b|take\s+two\s+extra\s+turns\b|talking!$|tap\s+and\s+goad\b|tap\s+it\s+and\b|tap\s+the\s+chosen\b|tapped\s+creatures\b|tapped\s+if\b)/i;
  if (pass41ResidualMetadata.test(raw)) {
    return staticMetadata('pass41 residual', raw);
  }

  const targetControllerSacrifices = raw.match(/^(target\s+.+?)(?:'|�)s\s+controller\s+sacrifices\s+it$/i);
  if (targetControllerSacrifices) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'target_player' },
      what: parseObjectSelector(String(targetControllerSacrifices[1] || 'it').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetControllerRevealsRandom = raw.match(/^(target\s+.+?)(?:'|�)s\s+controller\s+reveals\s+a\s+card\s+at\s+random\s+from\s+their\s+hand$/i);
  if (targetControllerRevealsRandom) {
    return [{ kind: 'reveal_hand', who: { kind: 'target_player' }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPtAsLongAsTapped = raw.match(/^(target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+for\s+as\s+long\s+as\s+this\s+artifact\s+remains\s+tapped$/i);
  if (targetPtAsLongAsTapped) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(targetPtAsLongAsTapped[1] || '').trim()),
      power: Number.parseInt(String(targetPtAsLongAsTapped[2] || '0'), 10),
      toughness: Number.parseInt(String(targetPtAsLongAsTapped[3] || '0'), 10),
      effectText: ['for as long as this artifact remains tapped'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPtAndCanBlock = raw.match(/^(target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn\s+and\s+can\s+block\s+any\s+number\s+of\s+creatures\s+this\s+turn$/i);
  if (targetPtAndCanBlock) {
    const target = parseObjectSelector(String(targetPtAndCanBlock[1] || '').trim());
    return [
      { kind: 'modify_pt', target, power: Number.parseInt(String(targetPtAndCanBlock[2] || '0'), 10), toughness: Number.parseInt(String(targetPtAndCanBlock[3] || '0'), 10), duration: 'end_of_turn', raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'grant_temporary_ability', target, duration: 'this_turn', effectText: ['can block any number of creatures'], raw, ...sequence } as unknown as OracleEffectStep,
    ];
  }

  if (/^target\s+creature\s+gets\s+[+-]x\/[+-]x\s+or\s+[+-]x\/[+-]x\s+until\s+end\s+of\s+turn,\s+where\s+x\s+is\s+the\s+number\s+of\s+.+$/i.test(raw)) {
    return temporaryMetadata('target creature', raw, 'end_of_turn');
  }

  if (/^target\s+creature\s+you\s+control\s+has\s+base\s+power\s+\d+\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return temporaryMetadata('target creature you control', raw, 'end_of_turn');
  }

  if (/^target\s+land\s+you\s+control\s+becomes\s+an?\s+x\/x\s+.+?\s+until\s+end\s+of\s+turn,\s+where\s+x\s+is\s+the\s+number\s+of\s+.+$/i.test(raw)) {
    return temporaryMetadata('target land you control', raw, 'end_of_turn');
  }

  if (/^target\s+nonsnow\s+basic\s+land\s+becomes\s+snow$/i.test(raw)) {
    return staticMetadata('target nonsnow basic land', 'becomes snow');
  }

  const ownerPutsPermanentIntoLibrary = raw.match(/^(?:(target\s+nonland\s+permanent)(?:'|’|\u2019)s\s+owner|the owner of (target\s+nonland\s+permanent))\s+puts\s+it\s+into\s+their\s+library\s+second\s+from\s+the\s+top\s+or\s+on\s+the\s+bottom$/i);
  if (ownerPutsPermanentIntoLibrary) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(String(ownerPutsPermanentIntoLibrary[1] || ownerPutsPermanentIntoLibrary[2] || '').trim()),
      to: 'library',
      toRaw: 'second from the top or on the bottom of its owner\'s library',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetOpponentMayPayLife = raw.match(/^target\s+opponent\s+may\s+pay\s+(\d+)\s+life$/i);
  if (targetOpponentMayPayLife) {
    return [{
      kind: 'lose_life',
      who: { kind: 'target_opponent' },
      amount: { kind: 'number', value: Number.parseInt(String(targetOpponentMayPayLife[1] || '0'), 10) || 0 },
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetOpponentChoosesSacrifice = raw.match(/^target\s+opponent\s+chooses\s+(.+?)\s+they\s+control(?:\s+at\s+random)?\s+and\s+sacrifices\s+it$/i);
  if (targetOpponentChoosesSacrifice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'target_opponent' },
      what: parseObjectSelector(String(targetOpponentChoosesSacrifice[1] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetOpponentChoosesReturn = raw.match(/^target\s+opponent\s+chooses\s+(.+?)\s+they\s+control\s+and\s+returns\s+it\s+to\s+its\s+owner(?:'|�)s\s+hand$/i);
  if (targetOpponentChoosesReturn) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(String(targetOpponentChoosesReturn[1] || '').trim()),
      to: 'hand',
      toRaw: "its owner's hand",
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetOpponentMayExileGraveyard = raw.match(/^target\s+opponent\s+may\s+exile\s+(.+?)\s+from\s+their\s+graveyard$/i);
  if (targetOpponentMayExileGraveyard) {
    return [{ kind: 'exile', target: parseObjectSelector(`${String(targetOpponentMayExileGraveyard[1] || '').trim()} from target opponent's graveyard`), optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetOpponentExilesHandAndLosesLife = raw.match(/^target\s+opponent\s+exiles\s+(.+?)\s+cards?\s+from\s+their\s+hand\s+and\s+loses\s+(\d+)\s+life$/i);
  if (targetOpponentExilesHandAndLosesLife) {
    return [
      { kind: 'exile', target: parseObjectSelector(`${String(targetOpponentExilesHandAndLosesLife[1] || '').trim()} cards from target opponent's hand`), raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'lose_life', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: Number.parseInt(String(targetOpponentExilesHandAndLosesLife[2] || '0'), 10) || 0 }, raw, ...sequence } as unknown as OracleEffectStep,
    ];
  }

  const targetOpponentMillsHalf = raw.match(/^target\s+opponent\s+mills\s+half\s+their\s+library,\s+rounded\s+up$/i);
  if (targetOpponentMillsHalf) {
    return [{ kind: 'mill', who: { kind: 'target_opponent' }, amount: { kind: 'reference_amount', raw: 'half their library, rounded up' }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetOpponentPutsHandOnLibrary = raw.match(/^target\s+opponent\s+puts\s+(.+?)\s+cards?\s+from\s+their\s+hand\s+on\s+top\s+of\s+their\s+library(?:\s+in\s+any\s+order)?$/i);
  if (targetOpponentPutsHandOnLibrary) {
    return [{ kind: 'move_zone', what: parseObjectSelector(`${String(targetOpponentPutsHandOnLibrary[1] || '').trim()} cards from target opponent's hand`), to: 'library', toRaw: 'top of their library', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^target\s+opponent\s+puts\s+the\s+cards\s+from\s+their\s+hand\s+on\s+top\s+of\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector("the cards from target opponent's hand"), to: 'library', toRaw: 'top of their library', raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetOpponentPutsCounter = raw.match(/^target\s+opponent\s+puts\s+a\s+(.+?)\s+counter\s+on\s+a\s+creature\s+they\s+control$/i);
  if (targetOpponentPutsCounter) {
    return [{ kind: 'add_counter', target: parseObjectSelector('a creature target opponent controls'), counter: String(targetOpponentPutsCounter[1] || '').trim(), amount: { kind: 'number', value: 1 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetOpponentRevealsTop = raw.match(/^target\s+opponent\s+reveals\s+the\s+top\s+(.+?)\s+cards?\s+of\s+their\s+library(?:,\s+may\s+put\s+.+)?$/i);
  if (targetOpponentRevealsTop) {
    return [{ kind: 'reveal_top', who: { kind: 'target_opponent' }, amount: parseQuantity(String(targetOpponentRevealsTop[1] || '').trim()), raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^target\s+opponent\s+reveals\s+(?:a\s+number\s+of\s+cards\s+from\s+their\s+hand\s+equal\s+to\s+.+|that\s+many\s+cards\s+from\s+their\s+hand|x\s+cards\s+from\s+their\s+hand,\s+where\s+x\s+is\s+.+)$/i.test(raw)) {
    return [{ kind: 'reveal_hand', who: { kind: 'target_opponent' }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const earlyRevealUntilCreature = raw.match(/^(target\s+opponent|that\s+creature(?:'|�)?s\s+controller)\s+reveals\s+cards\s+from\s+the\s+top\s+of\s+their\s+library\s+until\s+they\s+reveal\s+a\s+creature\s+card$/i);
  if (earlyRevealUntilCreature) {
    const whoRaw = String(earlyRevealUntilCreature[1] || '').toLowerCase();
    return [{
      kind: 'reveal_top',
      who: whoRaw === 'target opponent' ? { kind: 'target_opponent' } : { kind: 'target_player' },
      amount: { kind: 'reference_amount', raw: 'until they reveal a creature card' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target\s+opponent\s+(?:chooses\b|chosen\s+at\s+random\s+gains\s+control\b|exiles\s+(?:a\s+creature\s+they\s+control\s+and\s+their\s+graveyard|cards\s+from\s+the\s+bottom|the\s+top\s+half)|gets\s+an\s+emblem\b|guesses\b|looks\s+at\b|loses\s+all\s+counters\b|may\s+(?:ante|choose|guess|have|put|sacrifice)\b|reveals\s+cards\s+from\s+the\s+top\b|skips\b|whose\s+turn\s+it\s+is\b|(?:'|�)s\s+life\s+total\s+becomes\b)/i.test(raw)) {
    return staticMetadata('target opponent residual', raw);
  }

  if (/^target\s+opponent(?:'|�)s\s+life\s+total\s+becomes\b/i.test(raw)) {
    return staticMetadata('target opponent residual', raw);
  }

  if (/^target\s+permanent\s+becomes\s+the\s+color\s+or\s+colors\s+of\s+your\s+choice$/i.test(raw)) {
    return staticMetadata('target permanent', 'becomes the color or colors of your choice');
  }

  const targetPlayerAddsChosenMana = raw.match(/^target\s+player\s+adds\s+three\s+mana\s+of\s+the\s+chosen\s+color\s+for\s+each\s+artifact\s+sacrificed\s+this\s+way$/i);
  if (targetPlayerAddsChosenMana) {
    return [{
      kind: 'add_mana',
      who: { kind: 'target_player' },
      mana: '{W}',
      amount: { kind: 'reference_amount', raw: 'three mana of the chosen color for each artifact sacrificed this way' },
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      requiresChosenMana: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target\s+player\s+can(?:'|�)t\s+cast\s+(?:creature\s+)?spells\s+this\s+turn$/i.test(raw)) {
    return temporaryMetadata('target player', raw, 'this_turn');
  }

  const targetPlayerDiscardReference = raw.match(/^target\s+player\s+discards\s+(.+)$/i);
  if (targetPlayerDiscardReference && /^(?:a\s+number\s+of\s+cards\s+equal\s+to\s+.+|cards\s+equal\s+to\s+.+)$/i.test(String(targetPlayerDiscardReference[1] || '').trim())) {
    return [{ kind: 'discard', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerDiscardReference[1] || '').trim()), raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerDraws = raw.match(/^target\s+player\s+draws\s+(.+)\s+cards?$/i);
  if (targetPlayerDraws) {
    return [{ kind: 'draw', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerDraws[1] || '').trim()), raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerExilesTopLibrary = raw.match(/^target\s+player\s+exiles\s+the\s+top\s+(.+?)\s+cards?\s+of\s+their\s+library(?:,\s+where\s+x\s+is\s+.+)?$/i);
  if (targetPlayerExilesTopLibrary) {
    return [{ kind: 'exile', target: parseObjectSelector(`the top ${String(targetPlayerExilesTopLibrary[1] || '').trim()} cards of target player's library`), raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerGainsLife = raw.match(/^target\s+player\s+gains\s+(.+)\s+life$/i);
  if (targetPlayerGainsLife) {
    const { amount, whereX } = parseQuantityWithOptionalWhereX(String(targetPlayerGainsLife[1] || '').trim());
    return [{
      kind: 'gain_life',
      who: { kind: 'target_player' },
      amount,
      ...(whereX ? { whereX } : {}),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const sourceDealsDamageWhere = raw.match(
    /^(.+?)\s+deals?\s+(.+?)\s+damage\s+to\s+([^,]+)(?:,\s*where\s+x\s+is\s+(.+))?$/i
  );
  if (sourceDealsDamageWhere) {
    const quantityTail = sourceDealsDamageWhere[4]
      ? `${String(sourceDealsDamageWhere[2] || '').trim()}, where x is ${String(sourceDealsDamageWhere[4] || '').trim()}`
      : String(sourceDealsDamageWhere[2] || '').trim();
    const { amount, whereX } = parseQuantityWithOptionalWhereX(quantityTail);
    return [{
      kind: 'deal_damage',
      amount,
      source: parseObjectSelector(String(sourceDealsDamageWhere[1] || '').trim()),
      target: parseObjectSelector(String(sourceDealsDamageWhere[3] || '').trim()),
      ...(whereX ? { whereX } : {}),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const playerGainsLifeTail = raw.match(/^(.+?)\s+gains?\s+(.+)\s+life$/i);
  if (playerGainsLifeTail && /,\s*where\s+x\s+is\s+/i.test(raw)) {
    const { amount, whereX } = parseQuantityWithOptionalWhereX(String(playerGainsLifeTail[2] || '').trim());
    return [{
      kind: 'gain_life',
      who: parsePlayerSelector(String(playerGainsLifeTail[1] || '').trim() || 'you'),
      amount,
      ...(whereX ? { whereX } : {}),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPlayerLosesLife = raw.match(/^target\s+player(?:\s+(?:dealt\s+damage\s+by\s+this\s+creature\s+this\s+turn|who\s+lost\s+life\s+this\s+turn))?\s+loses\s+(\d+)\s+life$/i);
  if (targetPlayerLosesLife) {
    return [{ kind: 'lose_life', who: { kind: 'target_player' }, amount: { kind: 'number', value: Number.parseInt(String(targetPlayerLosesLife[1] || '0'), 10) || 0 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerMills = raw.match(/^target\s+player\s+mills\s+(.+)$/i);
  if (targetPlayerMills) {
    const { amount, whereX } = parseQuantityWithOptionalWhereX(String(targetPlayerMills[1] || '').trim());
    return [{
      kind: 'mill',
      who: { kind: 'target_player' },
      amount,
      ...(whereX ? { whereX } : {}),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPlayerBottomCardToGraveyard = raw.match(/^target\s+player\s+puts\s+the\s+bottom\s+card\s+of\s+their\s+library\s+into\s+their\s+graveyard$/i);
  if (targetPlayerBottomCardToGraveyard) {
    return [{ kind: 'move_zone', what: parseObjectSelector("the bottom card of target player's library"), to: 'graveyard', toRaw: 'their graveyard', raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerReturnsCreature = raw.match(/^target\s+player\s+returns\s+(a\s+creature\s+they\s+control)\s+to\s+its\s+owner(?:'|�)s\s+hand$/i);
  if (targetPlayerReturnsCreature) {
    return [{ kind: 'move_zone', what: parseObjectSelector(String(targetPlayerReturnsCreature[1] || '').trim()), to: 'hand', toRaw: "its owner's hand", raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerReturnsCommanders = raw.match(/^target\s+player\s+returns\s+each\s+commander\s+they\s+control\s+from\s+the\s+battlefield\s+to\s+the\s+command\s+zone$/i);
  if (targetPlayerReturnsCommanders) {
    return [{ kind: 'move_zone', what: parseObjectSelector('each commander target player controls'), to: 'command', toRaw: 'the command zone', raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerRevealTopCard = raw.match(/^target\s+player\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i);
  if (targetPlayerRevealTopCard) {
    return [{ kind: 'reveal_top', who: { kind: 'target_player' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerRevealTopCards = raw.match(/^target\s+player\s+reveals\s+the\s+top\s+(.+?)\s+cards?\s+of\s+their\s+library$/i);
  if (targetPlayerRevealTopCards) {
    return [{ kind: 'reveal_top', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerRevealTopCards[1] || '').trim()), raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^target\s+player\s+reveals\s+(?:a\s+number\s+of\s+cards\s+from\s+their\s+hand\s+equal\s+to\s+.+|(?:three|x)\s+cards\s+from\s+their\s+hand(?:\s+and\s+you\s+choose\s+one\s+of\s+them|,\s+where\s+x\s+is\s+.+)?)$/i.test(raw)) {
    return [{ kind: 'reveal_hand', who: { kind: 'target_player' }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerSearchLibrary = raw.match(/^target\s+player\s+searches\s+their\s+library\s+for\s+a\s+card$/i);
  if (targetPlayerSearchLibrary) {
    return [{ kind: 'search_library', who: { kind: 'target_player' }, criteria: { kind: 'raw', text: 'a card' }, destination: 'hand', revealFound: false, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerShuffleGraveyardTargets = raw.match(/^target\s+player\s+shuffles\s+any\s+number\s+of\s+target\s+cards\s+from\s+their\s+graveyard\s+into\s+their\s+library$/i);
  if (targetPlayerShuffleGraveyardTargets) {
    return [{ kind: 'move_zone', what: parseObjectSelector("any number of target cards from target player's graveyard"), to: 'library', toRaw: 'their library', raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetPlayerTakesExtraTurns = raw.match(/^target\s+player\s+takes\s+two\s+extra\s+turns\s+after\s+this\s+one$/i);
  if (targetPlayerTakesExtraTurns) {
    return [
      { kind: 'take_extra_turn', who: { kind: 'target_player' }, raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'take_extra_turn', who: { kind: 'target_player' }, raw, ...sequence } as unknown as OracleEffectStep,
    ];
  }

  if (/^target\s+player\s+reveals\s+their\s+library$/i.test(raw)) {
    return [{
      kind: 'reveal_top',
      who: { kind: 'target_player' },
      amount: { kind: 'reference_amount', raw: 'the number of cards in their library' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target\s+player\s+(?:chooses\b|gets\s+an\s+emblem\b|loses\s+the\s+game$|reveals\s+cards\s+from\s+the\s+top\b|skips\b|with\s+exactly\s+seven\s+poison\s+counters\s+loses\s+the\s+game$)/i.test(raw) || /^target\s+player(?:'|�)s\s+life\s+total\s+becomes\b/i.test(raw)) {
    return staticMetadata('target player residual', raw);
  }

  if (/^target\s+spell\s+(?:becomes\s+colorless|can(?:'|�)t\s+be\s+countered)$/i.test(raw)) {
    return staticMetadata('target spell', raw);
  }

  if (/^target\s+spell\s+or\s+permanent\s+becomes\s+(?:black|blue|colorless|green|red|white)$/i.test(raw)) {
    return staticMetadata('target spell or permanent', raw);
  }

  if (/^target\s+spell(?:'|�)s\s+controller\s+exiles\s+it\s+with\s+x\s+delay\s+counters\s+on\s+it$/i.test(raw)) {
    return staticMetadata('target spell', raw);
  }

  const ptChoice = raw.match(/^(this\s+creature|target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+or\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (ptChoice) {
    const targetText = String(ptChoice[1] || '').trim();
    const buildMode = (powerRaw: string, toughnessRaw: string): OracleEffectStep => ({
      kind: 'modify_pt',
      target: parseObjectSelector(targetText),
      power: Number.parseInt(powerRaw, 10) || 0,
      toughness: Number.parseInt(toughnessRaw, 10) || 0,
      duration: 'end_of_turn',
      raw: `${targetText} gets ${powerRaw}/${toughnessRaw} until end of turn`,
      ...sequence,
    } as unknown as OracleEffectStep);
    const firstPower = String(ptChoice[2] || '').trim();
    const firstToughness = String(ptChoice[3] || '').trim();
    const secondPower = String(ptChoice[4] || '').trim();
    const secondToughness = String(ptChoice[5] || '').trim();
    return [{
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 1,
      modes: [
        { label: `${firstPower}/${firstToughness}`, raw: `${targetText} gets ${firstPower}/${firstToughness} until end of turn`, steps: [buildMode(firstPower, firstToughness)] },
        { label: `${secondPower}/${secondToughness}`, raw: `${targetText} gets ${secondPower}/${secondToughness} until end of turn`, steps: [buildMode(secondPower, secondToughness)] },
      ],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetConnivesReference = raw.match(/^(target\s+(?:attacking\s+)?creature(?:\s+you\s+control)?)\s+connives\s+x,\s+where\s+x\s+is\s+(.+)$/i);
  if (targetConnivesReference) {
    return [{
      kind: 'connive',
      target: parseObjectSelector(String(targetConnivesReference[1] || '').trim()),
      amount: { kind: 'reference_amount', raw: `X, where X is ${String(targetConnivesReference[2] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const splitTwoTargetPt = raw.match(/^(target\s+creature\s+an\s+opponent\s+controls)\s+gets\s+(-?\+?\d+)\/(-?\+?\d+)\s+until\s+end\s+of\s+turn\s+and\s+(target\s+creature\s+you\s+control)\s+gets\s+(\+?-?\d+)\/(\+?-?\d+)\s+until\s+end\s+of\s+turn$/i);
  if (splitTwoTargetPt) {
    return [
      { kind: 'modify_pt', target: parseObjectSelector(String(splitTwoTargetPt[1] || '').trim()), power: Number.parseInt(String(splitTwoTargetPt[2] || '0'), 10) || 0, toughness: Number.parseInt(String(splitTwoTargetPt[3] || '0'), 10) || 0, duration: 'end_of_turn', raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'modify_pt', target: parseObjectSelector(String(splitTwoTargetPt[4] || '').trim()), power: Number.parseInt(String(splitTwoTargetPt[5] || '0'), 10) || 0, toughness: Number.parseInt(String(splitTwoTargetPt[6] || '0'), 10) || 0, duration: 'end_of_turn', raw, ...sequence } as unknown as OracleEffectStep,
    ];
  }

  if (/^target\s+creature\s+.*\s+gets\s+[+-]x\/[+-]?\d+\s+until\s+your\s+next\s+turn,\s+where\s+x\s+is\s+.+$/i.test(raw)
    || /^target\s+creature\s+defending\s+player\s+controls\s+gets\s+-\d+\/-\d+\s+and\s+loses\s+flying\s+until\s+your\s+next\s+turn$/i.test(raw)
    || /^target\s+creature\s+you\s+control\s+gets\s+\+x\/\+0\s+until\s+end\s+of\s+turn\s+and\s+up\s+to\s+one\s+target\s+creature\s+an\s+opponent\s+controls\s+gets\s+-0\/-x\s+until\s+end\s+of\s+turn,\s+where\s+x\s+is\s+.+$/i.test(raw)) {
    return temporaryMetadata('target creature P/T residual', raw, /until\s+your\s+next\s+turn/i.test(raw) ? 'until_next_turn' : 'end_of_turn');
  }

  if (/^target\s+creature\s+and\s+all\s+creatures\s+that\s+share\s+a\s+name\s+with\s+that\s+creature\s+gain\s+echo\s+\{[^}]+\}\s+until\s+the\s+end\s+of\s+your\s+next\s+turn$/i.test(raw)) {
    return temporaryMetadata('target creature and same-named creatures', raw, 'until_next_turn');
  }

  if (/^target\s+creature\s+loses\s+its\s+name$/i.test(raw)) {
    return staticMetadata('target creature', 'loses its name');
  }

  const targetOpponentRevealsTopCard = raw.match(/^target\s+opponent\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i);
  if (targetOpponentRevealsTopCard) {
    return [{ kind: 'reveal_top', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  const targetOpponentPutsGraveyardCreatureOntoBattlefield = raw.match(/^target\s+opponent\s+puts\s+a\s+creature\s+card\s+of\s+their\s+choice\s+from\s+their\s+graveyard\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i);
  if (targetOpponentPutsGraveyardCreatureOntoBattlefield) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector("a creature card of target opponent's choice from their graveyard"),
      to: 'battlefield',
      toRaw: 'the battlefield',
      battlefieldController: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

