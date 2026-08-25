// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// bare self-reference fragments, "put the rest on the bottom" library ordering and shared P/T riders.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

export function parseResidualSelfReferenceAndLibraryOrderGuardsOne(
  raw: string, sequence: { sequence?: 'then' }
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

  if (/^this$/i.test(raw)) {
    return staticMetadata('this permanent', 'referenced effect');
  }

  if (/^chandra'?s\s+[^,]+(?:,\s*chandra'?s\s+[^,]+)+/i.test(raw)) {
    return staticMetadata('named card option', raw);
  }

  if (/^then\s+shuffle\.?"?\)?$/i.test(raw)) {
    return staticMetadata('library', 'shuffle');
  }

  if (/^transform\s+this\s+enchantment$/i.test(raw)) {
    return staticMetadata('this enchantment', 'transform');
  }

  if (/^a\s+card\s+at\s+the\s+beginning\s+of\s+the\s+next\s+turn'?s\s+upkeep$/i.test(raw)) {
    return staticMetadata('delayed trigger', raw);
  }

  if (/^you\s+may\s+pay\s+\{[^}]+\}(?:\{[^}]+\})*\s+any\s+number\s+of\s+times$/i.test(raw)) {
    return staticMetadata('additional cost', raw);
  }

  if (/^using\s+the\s+first\s+letters\b.*\bspell\s+a\s+word\b/i.test(raw)) {
    return staticMetadata('un-set word game', raw);
  }

  if (/^then\s+choose\s+a\s+third\s+player\s+to\s+create\b/i.test(raw)) {
    return staticMetadata('player choice', raw);
  }

  const firebendingGrant = raw.match(
    /^up\s+to\s+one\s+target\s+creature\s+gets\s+([+-]?\d+)\/([+-]?\d+)\s+and\s+gains\s+firebending\s+(\d+)\s+until\s+end\s+of\s+turn$/i
  );
  if (firebendingGrant) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('up to one target creature'),
      effectText: [
        `gets ${firebendingGrant[1]}/${firebendingGrant[2]}`,
        `gains firebending ${firebendingGrant[3]}`,
      ],
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const drawIfEmptyHand = raw.match(
    /^(?:draw\s+)?a\s+card\s+if\s+you\s+had\s+no\s+cards\s+in\s+hand\s+at\s+the\s+beginning\s+of\s+this\s+turn$/i
  );
  if (drawIfEmptyHand) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you had no cards in hand at the beginning of this turn' },
      steps: [{
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw,
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const scryResult = raw.match(/^\d+\s*-\s*\d+\s*\|\s*scry\s+(\d+)$/i);
  if (scryResult) {
    return [{
      kind: 'scry',
      who: { kind: 'you' },
      amount: parseQuantity(scryResult[1]),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:if\s+you\s+do,\s+)?(?:you\s+may\s+)?repeat\s+this\s+process(?:\s+any\s+number\s+of\s+times|\s+once)?$/i.test(raw)) {
    return staticMetadata('this process', raw);
  }

  if (/^you\s+may\s+put\s+it\s+on\s+the\s+bottom\.?\)?$/i.test(raw)) {
    return staticMetadata('it', 'may put on the bottom');
  }

  if (/^you\s+may\s+reveal\s+a\s+creature\s+card\s+with\s+power\s+2\s+or\s+less\s+from\s+among\s+them\s+and\s+put\s+it\s+into\s+your\s+hand\.\s*put\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order$/i.test(raw)) {
    return [{
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'among them' },
      selectorText: 'creature card with power 2 or less',
      destination: 'hand',
      reveal: true,
      restOrder: 'any',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const keywordMetadata = raw.match(/^(airbend\s+up\s+to\s+one\s+target\s+creature|incubate\s+x,\s+where\s+x\s+is\s+(?:its\s+power|that\s+spell(?:'|�)?s\s+mana\s+value)|it\s+endures\s+\d+|support\s+x)$/i);
  if (keywordMetadata) {
    return staticMetadata('keyword action', raw);
  }

  if (/^then\s+amass\s+orcs\s+(?:\d+|x)$/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }

  const equipmentCostLess = raw.match(/^equip\s+costs\s+you\s+pay\s+cost\s+(.+)\s+less$/i);
  if (equipmentCostLess) {
    return staticMetadata('equip costs you pay', `cost ${String(equipmentCostLess[1] || '').trim()} less`);
  }

  if (/^add\s+mana\s+of\s+the\s+chosen\s+color\s+or\s+chosen\s+combination\s+of\s+colors$/i.test(raw)) {
    return staticMetadata('mana choice', raw);
  }

  const earlyAllLandType = raw.match(/^(all|each)\s+lands?\s+(?:are|is)\s+(?:an?\s+)?(islands?|swamps?|mountains?|plains?|forests?)\s+in\s+addition\s+to\s+(?:their|its)\s+other\s+(?:types|land\s+types)$/i);
  if (earlyAllLandType) {
    const landTypeRaw = String(earlyAllLandType[2] || '').toLowerCase();
    const landType = /^islands?$/.test(landTypeRaw) ? 'Island'
      : /^swamps?$/.test(landTypeRaw) ? 'Swamp'
        : /^mountains?$/.test(landTypeRaw) ? 'Mountain'
          : /^plains?$/.test(landTypeRaw) ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('all lands'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const allLandType = raw.match(/^(all|each)\s+lands?\s+(?:are|is)\s+(?:an?\s+)?(islands?|swamps?|mountains?|plains?|forests?)\s+in\s+addition\s+to\s+(?:their|its)\s+other\s+(?:types|land\s+types)$/i);
  if (allLandType) {
    const landTypeRaw = String(allLandType[2] || '').toLowerCase();
    const landType = /^islands?$/.test(landTypeRaw) ? 'Island'
      : /^swamps?$/.test(landTypeRaw) ? 'Swamp'
        : /^mountains?$/.test(landTypeRaw) ? 'Mountain'
          : /^plains?$/.test(landTypeRaw) ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('all lands'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const nonbasicLandType = raw.match(/^nonbasic\s+lands\s+are\s+(islands|swamps|mountains|plains|forests)$/i);
  if (nonbasicLandType) {
    const landTypeRaw = String(nonbasicLandType[1] || '').toLowerCase();
    const landType = landTypeRaw === 'islands' ? 'Island'
      : landTypeRaw === 'swamps' ? 'Swamp'
        : landTypeRaw === 'mountains' ? 'Mountain'
          : landTypeRaw === 'plains' ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('nonbasic lands'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const landTypeWithCounter = raw.match(/^that\s+land\s+is\s+an?\s+(island|swamp|mountain|plains|forest)\s+in\s+addition\s+to\s+its\s+other\s+types\s+for\s+as\s+long\s+as\s+it\s+has\s+a\s+(.+?)\s+counter\s+on\s+it$/i);
  if (landTypeWithCounter) {
    const landTypeRaw = String(landTypeWithCounter[1] || '').toLowerCase();
    const landType = landTypeRaw === 'island' ? 'Island'
      : landTypeRaw === 'swamp' ? 'Swamp'
        : landTypeRaw === 'mountain' ? 'Mountain'
          : landTypeRaw === 'plains' ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('that land'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const broadTemporaryPt = raw.match(/^(all\s+other\s+creatures|another\s+target\s+creature|creatures\s+target\s+player\s+controls|attacking\s+creatures\s+with\s+flying|each\s+creature\s+you\s+control\s+named\s+this\s+permanent|target\s+1\/1\s+creature|one\s+or\s+two\s+target\s+creatures)\s+(?:each\s+)?gets?\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (broadTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(broadTemporaryPt[1] || '').trim()),
      power: Number.parseInt(String(broadTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(broadTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      optional: /^one\s+or\s+two/i.test(String(broadTemporaryPt[1] || '')) || undefined,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const staticPt = raw.match(/^(creatures\s+of\s+the\s+chosen\s+type|during\s+your\s+turn,\s+this\s+creature|as\s+long\s+as\s+equipped\s+creature\s+is\s+a\s+human,\s+it)\s+gets?\s+(?:an\s+additional\s+)?([+-]\d+)\/([+-]\d+)$/i);
  if (staticPt) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPt[1] || '').trim()),
      power: Number.parseInt(String(staticPt[2] || '0'), 10),
      toughness: Number.parseInt(String(staticPt[3] || '0'), 10),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetLandAnimation = raw.match(/^(target\s+land(?:\s+you\s+control)?)\s+becomes\s+a\s+(\d+)\/(\d+)\s+([^\.]+?)\s+until\s+end\s+of\s+turn$/i);
  if (targetLandAnimation) {
    const typeText = String(targetLandAnimation[4] || '').replace(/\bwith\s+.+$/i, '').trim();
    const abilities = /\bhaste\b/i.test(String(targetLandAnimation[4] || '')) ? ['haste'] : undefined;
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector(String(targetLandAnimation[1] || '').trim()),
      addTypes: typeText ? typeText.split(/\s+/).filter(Boolean) : ['creature'],
      power: Number.parseInt(String(targetLandAnimation[2] || '0'), 10),
      toughness: Number.parseInt(String(targetLandAnimation[3] || '0'), 10),
      abilities,
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const permanentArtifact = raw.match(/^(target\s+permanent)\s+becomes\s+an\s+artifact\s+in\s+addition\s+to\s+its\s+other\s+types(?:\s+until\s+end\s+of\s+turn)?$/i);
  if (permanentArtifact) {
    return [{
      kind: 'add_types',
      target: parseObjectSelector(String(permanentArtifact[1] || '').trim()),
      addTypes: ['artifact'],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const combatRequirement = raw.match(/^(all\s+creatures\s+able\s+to\s+block\s+enchanted\s+creature\s+do\s+so|all\s+creatures\s+block\s+each\s+combat\s+if\s+able|target\s+creature\s+attacks\s+target\s+opponent\s+this\s+turn\s+if\s+able|target\s+creature\s+blocks\s+target\s+creature\s+this\s+turn\s+if\s+able|no\s+more\s+than\s+one\s+creature\s+can\s+(?:attack|block)\s+each\s+combat)$/i);
  if (combatRequirement) {
    return staticMetadata('combat requirements', raw);
  }

  const damageRedirect = raw.match(/^all\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(.+?)\s+is\s+dealt\s+to\s+(.+?)\s+instead$/i);
  if (damageRedirect) {
    return staticMetadata(String(damageRedirect[1] || '').trim(), `damage is dealt to ${String(damageRedirect[2] || '').trim()} instead`);
  }

  const temporaryDamageRedirect = raw.match(
    /^all\s+(combat\s+)?damage\s+that\s+would\s+be\s+dealt(?:\s+this\s+turn)?\s+to\s+(.+?)(?:\s+this\s+turn)?(?:\s+by\s+(.+?)(?:\s+this\s+turn)?)?\s+is\s+dealt\s+to\s+(.+?)\s+instead(?:\s+\(if.+\))?$/i
  );
  if (temporaryDamageRedirect) {
    const damageKind = String(temporaryDamageRedirect[1] || '').trim().toLowerCase() === 'combat'
      ? 'combat damage'
      : 'damage';
    const recipientText = String(temporaryDamageRedirect[2] || '').trim();
    const sourceText = String(temporaryDamageRedirect[3] || '').trim();
    const redirectedToText = String(temporaryDamageRedirect[4] || '').trim();
    const effectText = `${damageKind} that would be dealt${sourceText ? ` by ${sourceText}` : ''} is dealt to ${redirectedToText} instead`;
    return temporaryMetadata(recipientText, effectText, 'this_turn');
  }

  const temporarySourceDamageRedirect = raw.match(
    /^all\s+damage\s+that\s+would\s+be\s+dealt\s+this\s+turn\s+by\s+(.+?)\s+is\s+dealt\s+to\s+(.+?)\s+instead$/i
  );
  if (temporarySourceDamageRedirect) {
    const sourceText = String(temporarySourceDamageRedirect[1] || '').trim();
    const redirectedToText = String(temporarySourceDamageRedirect[2] || '').trim();
    return temporaryMetadata(sourceText, `damage it would deal is dealt to ${redirectedToText} instead`, 'this_turn');
  }

  if (/^prevent\s+all\s+combat\s+damage\s+that\s+would\s+be\s+dealt\s+this\s+turn$/i.test(raw)) {
    return [{
      kind: 'prevent_damage',
      amount: 'all',
      duration: 'this_turn',
      combatOnly: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^prevent\s+all\s+combat\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(it|this creature|~)\s+this\s+turn\.?$/i.test(raw)) {
    return temporaryMetadata(
      'this creature',
      'prevent all combat damage that would be dealt to this creature this turn',
      'end_of_turn',
    );
  }

  const nextDamageToTarget = raw.match(/^prevent\s+the\s+next\s+(.+?)\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(.+?)\s+this\s+turn$/i);
  if (nextDamageToTarget) {
    return [{
      kind: 'prevent_damage',
      amount: parseQuantity(String(nextDamageToTarget[1] || '').trim()),
      recipientTarget: parseObjectSelector(String(nextDamageToTarget[2] || '').trim()),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const linkedSourcePrevent = raw.match(/^prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+this\s+turn\s+by\s+(target\s+source(?:\s+of\s+your\s+choice)?)\s+that\s+shares\s+a\s+color\s+with\s+the\s+exiled\s+card$/i);
  if (linkedSourcePrevent) {
    return [{
      kind: 'prevent_damage',
      amount: 'all',
      target: parseObjectSelector(String(linkedSourcePrevent[1] || '').trim()),
      duration: 'this_turn',
      sharesColorWithLinkedExiledCard: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const preventAllDamage = raw.match(/^prevent\s+(all|the\s+next\s+(?:\d+|x))\s+((?:damage\b.+?)|(?:.+?damage.+?))(?:\s+this\s+turn)?$/i);
  if (preventAllDamage) {
    const amountRaw = String(preventAllDamage[1] || '').trim();
    return [{
      kind: 'prevent_damage',
      amount: /^all$/i.test(amountRaw) ? 'all' : parseQuantity(amountRaw.replace(/^the\s+next\s+/i, '')),
      target: parseObjectSelector(String(preventAllDamage[2] || '').trim()),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const conditionalPreventDamage = raw.match(/^if\s+a\s+source\s+an\s+opponent\s+controls\s+would\s+deal\s+damage\s+to\s+you,\s+prevent\s+(\d+)\s+of\s+that\s+damage$/i);
  if (conditionalPreventDamage) {
    return [{
      kind: 'prevent_damage',
      amount: parseQuantity(String(conditionalPreventDamage[1] || '0')),
      target: parseObjectSelector('that damage'),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const preventXOfThatDamage = raw.match(/^prevent\s+x\s+of\s+that\s+damage,\s+where\s+x\s+is\s+the\s+amount\s+of\s+mana\s+that\s+player\s+paid\s+this\s+way$/i);
  if (preventXOfThatDamage) {
    return [{
      kind: 'prevent_damage',
      amount: { kind: 'reference_amount', raw: 'the amount of mana that player paid this way' },
      target: parseObjectSelector('that damage'),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const anyTargetsDiscard = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+discard\s+a\s+card$/i);
  if (anyTargetsDiscard) {
    return [{
      kind: 'discard',
      who: { kind: 'any_number_of_target_players' },
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachPlayerDrawUpTo = raw.match(/^each\s+player\s+may\s+draw\s+up\s+to\s+(.+?)\s+cards?$/i);
  if (eachPlayerDrawUpTo) {
    return [{
      kind: 'draw',
      who: { kind: 'each_player' },
      amount: parseQuantity(String(eachPlayerDrawUpTo[1] || '').trim()),
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachPlayerLoseHalf = raw.match(/^each\s+player\s+loses\s+half\s+their\s+life$/i);
  if (eachPlayerLoseHalf) {
    return [{
      kind: 'lose_life',
      who: { kind: 'each_player' },
      amount: { kind: 'reference_amount', raw: 'half their life' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const playerMayPutLand = raw.match(/^each\s+player\s+may\s+put\s+a\s+land\s+card\s+from\s+their\s+hand\s+onto\s+the\s+battlefield$/i);
  if (playerMayPutLand) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a land card from their hand'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const shuffleHandGraveyard = raw.match(/^each\s+player\s+may\s+shuffle\s+their\s+hand\s+and\s+graveyard\s+into\s+their\s+library$/i);
  if (shuffleHandGraveyard) {
    return [{
      kind: 'shuffle_zones_into_library',
      who: { kind: 'each_player' },
      zones: ['hand', 'graveyard'],
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const shuffleHand = raw.match(/^each\s+player\s+shuffles\s+the\s+cards\s+from\s+their\s+hand\s+into\s+their\s+library$/i);
  if (shuffleHand) {
    return [{
      kind: 'shuffle_zones_into_library',
      who: { kind: 'each_player' },
      zones: ['hand'],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const creatureControllerSacrifice = raw.match(/^target\s+creature(?:'|�)?s\s+controller\s+sacrifices\s+it$/i);
  if (creatureControllerSacrifice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'target_player' },
      what: parseObjectSelector('it'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const youAndPlayerEachSacrifice = raw.match(
    /^you and that player each sacrifice an? (.+?)$/i
  );
  if (youAndPlayerEachSacrifice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'you_and_target_player' },
      what: parseObjectSelector(`a ${String(youAndPlayerEachSacrifice[1] || '').trim()}`),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachPlayerSacrificeChoice = raw.match(
    /^each\s+player\s+sacrifices\s+a\s+(.+?)(?:\s+of\s+their\s+choice)?\.?$/i
  );
  if (eachPlayerSacrificeChoice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'each_player' },
      what: parseObjectSelector(`a ${String(eachPlayerSacrificeChoice[1] || '').trim()}`),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOtherSacrifice = raw.match(/^each\s+other\s+player\s+sacrifices\s+a\s+(.+?)(?:\s+of\s+their\s+choice)?$/i);
  if (eachOtherSacrifice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'each_opponent' },
      what: parseObjectSelector(`a ${String(eachOtherSacrifice[1] || '').trim()}`),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const opponentExilesControlled = raw.match(/^(target\s+opponent)\s+exiles\s+(a\s+.+?\s+they\s+control(?:\s+with\s+the\s+greatest\s+mana\s+value\s+among\s+.+)?)$/i);
  if (opponentExilesControlled) {
    return [{
      kind: 'exile',
      target: parseObjectSelector(String(opponentExilesControlled[2] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const handExileFaceDown = raw.match(/^(target\s+player)\s+exiles\s+all\s+cards\s+from\s+their\s+hand\s+face\s+down$/i);
  if (handExileFaceDown) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('all cards from their hand'),
      to: 'exile',
      toRaw: 'exile face down',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const millHalfLibrary = raw.match(/^(target\s+player)\s+mills\s+half\s+their\s+library,\s+rounded\s+down$/i);
  if (millHalfLibrary) {
    return [{
      kind: 'mill',
      who: parsePlayerSelector(millHalfLibrary[1]),
      amount: { kind: 'reference_amount', raw: 'half their library rounded down' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const playerSearchBasicLand = raw.match(/^(target\s+player)\s+searches\s+their\s+library\s+for\s+a\s+basic\s+land\s+card,\s+puts\s+it\s+onto\s+the\s+battlefield\s+tapped$/i);
  if (playerSearchBasicLand) {
    return [{
      kind: 'search_library',
      who: parsePlayerSelector(playerSearchBasicLand[1]),
      criteria: { kind: 'raw', text: 'basic land card' },
      destination: 'battlefield',
      entersTapped: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^reveal\s+that\s+card,\s+put\s+it\s+into\s+your\s+hand$/i.test(raw)) {
    return [
      { kind: 'grant_static_ability', target: parseObjectSelector('that card'), effectText: ['reveal'], duration: 'static', raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'move_zone', what: parseObjectSelector('that card'), to: 'hand', toRaw: 'your hand', raw, sequence: 'then' } as unknown as OracleEffectStep,
    ];
  }

  if (/^reveal\s+the\s+top\s+card\s+of\s+your\s+library\s+and\s+put\s+it\s+into\s+your\s+hand$/i.test(raw)) {
    return [
      { kind: 'reveal_top', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'move_zone', what: parseObjectSelector('the top card of your library'), to: 'hand', toRaw: 'your hand', raw, sequence: 'then' } as unknown as OracleEffectStep,
    ];
  }

  const chooseMetadata = raw.match(/^(?:as\s+this\s+creature\s+enters,\s+)?(?:secretly\s+)?choose\s+(.+)$/i);
  if (chooseMetadata) {
    const choiceText = String(chooseMetadata[1] || '').trim();
    if (/^(?:a\s+card\s+in\s+your\s+hand|a\s+creature\s+at\s+random|a\s+land\s+type|a\s+number|a\s+player\s+at\s+random|another\s+target\s+creature|any\s+number\s+of\s+creatures\s+with\s+different\s+powers|target\s+attacking\s+or\s+blocking\s+creature|target\s+creature\s+you\s+don(?:'|�)?t\s+control|target\s+opponent\s+who\s+has\s+more\s+life\s+than\s+you\s+do\s+as\s+you\s+activate\s+this\s+ability|target\s+player|target\s+wall\s+creature|a\s+creature\s+type|an\s+opponent)$/i.test(choiceText)) {
      return staticMetadata('choice', `choose ${choiceText}`);
    }
  }

  const staticRestriction = raw.match(/^(players\s+can(?:'|�)?t\s+(?:cast\s+spells\s+from\s+graveyards\s+or\s+libraries|draw\s+cards|play\s+lands|untap\s+more\s+than\s+one\s+artifact\s+during\s+their\s+untap\s+steps)|spells\s+and\s+abilities\s+your\s+opponents\s+control\s+can(?:'|�)?t\s+cause\s+you\s+to\s+sacrifice\s+permanents|spells\s+you\s+control\s+can(?:'|�)?t\s+be\s+countered|enchanted\s+creature\s+can(?:'|�)?t\s+be\s+the\s+target\s+of\s+spells\s+or\s+abilities\s+your\s+opponents\s+control|enchanted\s+creature\s+has\s+protection\s+from\s+black\s+and\s+from\s+red|enchanted\s+creature\s+loses\s+flying|nontoken\s+creatures\s+you\s+control\s+have\s+riot|each\s+nonland\s+card\s+in\s+your\s+hand\s+without\s+foretell\s+has\s+foretell|each\s+creature\s+card\s+in\s+your\s+graveyard\s+has\s+scavenge)$/i);
  if (staticRestriction) {
    return staticMetadata('static restriction', raw);
  }

  const staticAbilityText = raw.match(/^(during\s+your\s+turn,\s+you\s+may\s+play\s+cards\s+exiled\s+with\s+this\s+permanent|each\s+player\s+may\s+play\s+an\s+additional\s+land\s+on\s+each\s+of\s+their\s+turns|if\s+you\s+cast\s+a\s+spell\s+this\s+way,\s+you\s+may\s+cast\s+it\s+as\s+though\s+it\s+had\s+flash|if\s+you\s+cast\s+a\s+spell\s+this\s+way,\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+color\s+to\s+cast\s+it|its\s+foretell\s+cost\s+is\s+equal\s+to\s+its\s+mana\s+cost\s+reduced\s+by\s+\{2\}|only\s+your\s+opponents\s+may\s+activate\s+this\s+ability\s+and\s+only\s+as\s+a\s+sorcery|spend\s+this\s+mana\s+only\s+to\s+pay\s+cumulative\s+upkeep\s+costs|that\s+mana\s+becomes\s+colorless|that\s+player\s+may\s+pay\s+any\s+amount\s+of\s+mana)$/i);
  if (staticAbilityText) {
    return staticMetadata('static ability', raw);
  }

  const copyMetadata = raw.match(/^(copy\s+it,\s+except\s+the\s+copy\s+isn(?:'|�)?t\s+legendary|each\s+copy\s+targets\s+a\s+different\s+one\s+of\s+those\s+permanents\s+and\s+players)$/i);
  if (copyMetadata) {
    return staticMetadata('copy', raw);
  }

  const revealHandChoice = raw.match(/^target\s+player\s+reveals\s+three\s+cards\s+from\s+their\s+hand\s+and\s+you\s+choose\s+one\s+of\s+them$/i);
  if (revealHandChoice) {
    return [
      { kind: 'reveal_hand', who: { kind: 'target_player' }, raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'grant_static_ability', target: parseObjectSelector('revealed cards'), effectText: ['you choose one of them'], duration: 'static', raw, sequence: 'then' } as unknown as OracleEffectStep,
    ];
  }

  const phaseCombatRemoval = raw.match(/^remove\s+target\s+attacking\s+or\s+blocking\s+creature\s+from\s+combat$/i);
  if (phaseCombatRemoval) {
    return temporaryMetadata('target attacking or blocking creature', 'removed from combat');
  }

  const tapOtherwise = raw.match(/^otherwise,\s+tap\s+it$/i);
  if (tapOtherwise) {
    return [{ kind: 'tap_or_untap', target: parseObjectSelector('it'), mode: 'tap', raw, ...sequence } as unknown as OracleEffectStep];
  }

  const skipUntapPlayer = raw.match(/^that\s+player\s+skips\s+their\s+next\s+untap\s+step$/i);
  if (skipUntapPlayer) {
    return [{
      kind: 'skip_next_untap',
      target: parseObjectSelector('that player'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const untapLand = raw.match(/^that\s+player\s+untaps\s+a\s+land\s+they\s+control$/i);
  if (untapLand) {
    return [{ kind: 'tap_or_untap', target: parseObjectSelector('a land they control'), mode: 'untap', raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualSelfReferenceAndLibraryOrderGuardsTwo(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const topBottomRest = raw.match(/^(?:(?:then\s+)?puts?\s+the\s+(?:rest|revealed\s+cards)\s+on\s+the\s+bottom(?:\s+of\s+(?:your|their)\s+library)?\s+in\s+(?:a\s+)?(?:random|any)\s+order|put\s+up\s+to\s+one\s+of\s+them\s+on\s+top\s+of\s+your\s+library\s+and\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order)$/i);
  if (topBottomRest) {
    return staticMetadata('library order', raw);
  }

  if (/^manifest\s+the\s+top\s+card\s+of\s+your\s+library\s+and\s+attach\s+this\s+enchantment\s+to\s+it$/i.test(raw)) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('the top card of your library'),
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        raw: 'Manifest the top card of your library',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'attach',
        attachment: parseObjectSelector('this enchantment'),
        to: parseObjectSelector('it'),
        raw: 'attach this enchantment to it',
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const revealHandCards = raw.match(/^reveal\s+any\s+number\s+of\s+(.+?)\s+cards\s+in\s+your\s+hand$/i);
  if (revealHandCards) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(`${String(revealHandCards[1] || '').trim()} cards in your hand`),
      effectText: ['reveal any number'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const handToTop = raw.match(/^(target\s+(?:opponent|player))\s+puts\s+a\s+card\s+from\s+their\s+hand\s+on\s+top\s+of\s+their\s+library$/i);
  if (handToTop) {
    const who = String(handToTop[1] || '').trim();
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(`a card from ${who}'s hand`),
      to: 'library',
      toRaw: 'top of their library',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualSelfReferenceAndLibraryOrderGuardsThree(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const theyEachPt = raw.match(/^they\s+each\s+get\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (theyEachPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('they'),
      power: Number.parseInt(String(theyEachPt[1] || '0'), 10),
      toughness: Number.parseInt(String(theyEachPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetEachPt = raw.match(/^(up\s+to\s+\w+\s+target\s+creatures?)\s+each\s+get\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (targetEachPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(targetEachPt[1] || '').trim()),
      power: Number.parseInt(String(targetEachPt[2] || '0'), 10),
      toughness: Number.parseInt(String(targetEachPt[3] || '0'), 10),
      duration: 'end_of_turn',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const theyHaveQuoted = raw.match(/^they\s+have\s+"([^"]+)"$/i);
  if (theyHaveQuoted) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      effectText: [String(theyHaveQuoted[1] || '').trim()],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const theyArePtType = raw.match(/^they(?:'|�)?re\s+(\d+)\/(\d+)\s+(.+)$/i);
  if (theyArePtType) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      power: Number.parseInt(String(theyArePtType[1] || '0'), 10),
      toughness: Number.parseInt(String(theyArePtType[2] || '0'), 10),
      effectText: [`are ${String(theyArePtType[3] || '').trim()}`],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

