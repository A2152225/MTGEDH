/**
 * Origin parent: oracleIRParserUtils.ts
 * Cluster moved: parseQuantity early reference-amount / object-stat / phrase if-chain
 * Public: tryParseQuantityEarlyReferences
 */

import type { OracleQuantity } from '../oracleIR';

export function tryParseQuantityEarlyReferences(
  trimmed: string,
  parseRest: (raw: string | undefined) => OracleQuantity,
): OracleQuantity | null {
  if (/^that$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that' };
  if (/^those(?:\s+tokens?(?:\s+plus\s+an\s+additional\s+treasure\s+token)?)?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^this$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^twice that much$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that many$/i.test(trimmed) || /^that much$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^twice that many$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the excess damage dealt this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^another card$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'another card' };
  if (/^a card or pay \{2\}$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card or$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a card or' };
  if (/^a card and blight 1$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card and chaos ensues$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card and choose an opponent at random$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card and repeat this process$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a card or sacrifice a permanent of their choice$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a creature card$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a creature card' };
  if (/^a land card$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a land card' };
  if (/^a card" for as long as you control this creature$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^all but 1$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that damage$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that damage' };
  if (/^the excess$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the excess' };
  if (/^life$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'life' };
  if (/^trample$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'trample' };
  if (/^ten cards instead$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^twice x cards$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^twice the number of vehicles you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^twice the number of ([a-z]+)s? it devoured$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^two for each creature sacrificed this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^x plus 2$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the same number$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the same number' };
  if (/^otherwise, you$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^no life instead$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^until end of turn, you$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that creature(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'mana_value' };
  if (/^the greatest power among creatures you control$/i.test(trimmed)) return { kind: 'greatest_power_among_creatures_you_control' };
  if (/^the greatest mana value among creatures sacrificed this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that many cards minus one$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^a third of their life, rounded up$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards equal to its power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards?\s+equal\s+to\s+the\s+sacrificed\s+creature(?:'|’)?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'power' };
  }
  if (/^for each other creature you control that the spell could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^for each other creature you control that ability could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^for each other creature that spell could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^for each other permanent or player the spell or ability could target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^damage equal to the number of charge counters on it to target player and that much$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^damage equal to the number of quest counters on it to up to one target creature unless that creature(?:'|')?s controller has this permanent deal that much$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^mayhem cost is equal to its mana value$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the card(?:'|')?s mana value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' };
  if (/^the damage dealt to target opponent this turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that many cards and add that much \{r\}$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^another$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^any$/i.test(trimmed)) return { kind: 'any_number' };
  if (/^x\s+life\s+and\s+draw\s+x\s+cards?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'x life and draw x cards' };
  }
  if (/^x\s+life\s+and\s+you\s+gain\s+x$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^where\s+x\s+is\s+this\s+creature(?:'|')?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'this_creature', stat: 'power' };
  }
  if (/^this\s+permanent(?:'|')?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'this_permanent', stat: 'power' };
  }
  if (/^until you exile a nonland permanent card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^x cards?,?$/i.test(trimmed)) {
    return { kind: 'x' };
  }
  if (/^up to x cards?$/i.test(trimmed)) {
    return { kind: 'x' };
  }
  if (/^your speed$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'your speed' };
  }
  if (/^your highest commander tax among your commanders$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^x for each of those creatures\.?\)?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'x for each of those creatures' };
  }
  if (/^x cards plus an additional card for each time .+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\)+$/g, '').trim() };
  }
  const cardsInsteadMatch = trimmed.match(
    /^((?:a card|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) cards?) instead$/i,
  );
  if (cardsInsteadMatch) {
    return parseRest(String(cardsInsteadMatch[1] || '').trim().replace(/\s+cards?$/i, ''));
  }
  if (/^two cards instead$/i.test(trimmed)) {
    return { kind: 'number', value: 2 };
  }
  if (/^a card if /i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^combat damage this turn, it deals that$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the life that player lost this turn$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the amount of life they lost this turn$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^that amount of$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^that mana value$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the result$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the power of target creature you control$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'target_creature_you_control', stat: 'power' };
  }
  if (/^twice the number of times it was kicked$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^double that$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^two cards unless you discard an instant or sorcery card or a creature card with flying$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^two cards unless (?:you|they) discard (?:an? )?.+ card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the life you lost when it entered$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the number they guessed$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card and proliferate$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card unless /i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the greatest mana value among equipment attached(?: to it)?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^rewards$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^excess combat$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^that much life plus 1 instead$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^damage to an opponent this turn, it deals double that$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed };
  }
  if (/^the mana value of the sacrificed permanent$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_permanent', stat: 'mana_value' };
  }
  if (/^a card before its other effects(?:[.)"]*)?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card,?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card,?\s+then discard a card\.?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card,?\s+lose 1 life,?\s*$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card and an additional card for each of .+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^that many cards, create that many tapped treasure tokens$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'that many' };
  }
  if (/^one fewer card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'one fewer card' };
  }
  if (/^five for each forest and\/or plant you control\.?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\.$/, '') };
  }
  if (/^(?:a card|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?\s+for\s+each\s+/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\.$/, '') };
  }
  if (/^(\d+|x|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\s+for\s+each\s+/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\.$/, '') };
  }
  if (/^a card\.?"?\s*(?:\(|$)/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^a card["']?\s*(?:and loses all other abilities|,?\s*" and)/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^another card at random(?: unless .+)?\.?$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^all cards from (?:your|their) hand$/i.test(trimmed)) {
    return { kind: 'number', value: 9999 };
  }
  if (/^all but the bottom (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of (?:that player's|target player's|their) library$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card(?:\.|\.)["')]*$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^x cards at random$/i.test(trimmed)) {
    return { kind: 'x' };
  }
  if (/^an? .+ card rather than pay this spell's mana cost$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^an? .+ card and another card rather than pay this spell's mana cost$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a card["'] until end of turn$/i.test(trimmed)) {
    return { kind: 'number', value: 1 };
  }
  if (/^two cards["'] until end of turn$/i.test(trimmed)) {
    return { kind: 'number', value: 2 };
  }
  if (/^that (much|many)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that (much|many)\s+cards?$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/\s+cards?$/i, '') };
  }
  if (/^the difference$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the difference' };
  if (/^the\s+amount\s+of\s+life\s+you\s+gained\s+this\s+turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^excess$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'excess' };
  if (/^for\s+each\s+other\s+creature\s+you\s+control\s+that\s+ability\s+could\s+target$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^half\b/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^(?:her|his)\s+power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^its\s+converted\s+mana\s+cost$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'mana_value' };
  if (/^its\s+power\s+plus\s+its\s+toughness$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^its\s+total\s+toxic\s+value$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^its\s+toughness(?:,"\s+and\s+can\s+attack\s+as\s+though\s+it\s+didn(?:'|’)t\s+have\s+defender)?$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  if (/^no$/i.test(trimmed)) return { kind: 'number', value: 0 };
  if (/^or$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'or' };
  if (/^a\s+for\s+each\s+color\s+of\s+mana\s+spent\s+to\s+cast\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^an?\s+for\s+each\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^an?\s+amount\s+of\s+damage\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a\s+number\s+of\s+cards\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^cards?\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^(?:\d+|a|a\s+card)\s+for\s+each\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a\s+for\s+each\s+time\s+it\s+was\s+kicked$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^1\s+for\s+each\s+creature\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^1\s+for\s+each\s+card\s+in\s+your\s+hand$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each card in your hand' };
  if (/^1\s+for\s+each\s+creature\s+on\s+the\s+battlefield$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each creature on the battlefield' };
  if (/^the number of creatures you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of [a-z0-9 +/'\-]+s you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of attacking creatures$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of attacking creatures' };
  if (/^the greatest power among creatures you control$/i.test(trimmed)) return { kind: 'greatest_power_among_creatures_you_control' };
  if (/^the greatest toughness among (?:other )?creatures you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+high\s+bid$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the high bid' };
  if (/^that\s+spell'?s\s+mana\s+value$/i.test(trimmed)) return { kind: 'reference_amount', raw: "that spell's mana value" };
  if (/^that\s+card(?:'|’)?s\s+mana\s+value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' };
  if (/^that\s+card(?:'|’)?s\s+mana\s+value\s+if\s+this\s+creature\s+isn(?:'|’)?t\s+saddled$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that\s+card(?:'|’)?s\s+toughness,\s+lose\s+life\s+equal\s+to\s+its\s+power$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that\s+creature\s+card(?:'|’)?s\s+toughness$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^that\s+card'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'power' };
  if (/^that\s+card'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'toughness' };
  if (/^target\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  if (/^target\s+creature'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  if (/^that\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  if (/^that\s+creature'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  if (/^its\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'power' };
  if (/^its\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  if (/^its\s+mana\s+value$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'mana_value' };
  if (/^its\s+base\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'power' };
  if (/^its\s+base\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  if (/^the\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'source', stat: 'power' };
  if (/^the\s+sacrificed\s+creature'?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'power' };
  }
  if (/^the number of artifacts you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of artifacts you control' };
  if (/^the number of lands you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of lands you control' };
  if (/^the number of cards in (?:your|their) hand$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of [a-z0-9 +/\-]+ counters on it$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^1\s+for\s+each\s+attacking\s+creature$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each attacking creature' };
  if (/^that spell'?s mana value$/i.test(trimmed)) return { kind: 'reference_amount', raw: "that spell's mana value" };
  if (/^the damage prevented this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the damage prevented this way' };
  if (/^the damage dealt this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the damage dealt this way' };
  if (/^a\s+card\s+for\s+each\s+card\s+exiled\s+from\s+their\s+hand\s+this\s+way$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^for\s+each\s+basic\s+land\s+type\s+among\s+lands\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^until\s+(?:you|they)\s+exile\s+a\s+nonland\s+card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^until\s+(?:you|they)\s+exile\s+an?\s+instant\s+or\s+sorcery\s+card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^until\s+you\s+exile\s+a\s+nonland\s+card\s+whose\s+mana\s+value\s+is\s+less\s+than\s+this\s+spell(?:'|’)?s\s+mana\s+value$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the\s+number\s+of\s+cards\s+in\s+that\s+player(?:'|â€™)?s\s+hand$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: "the number of cards in that player's hand" };
  }
  if (/^the\s+number\s+of\s+mountains\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'the number of mountains you control' };
  }
  if (/^(?:twice|triple)\s+the\s+number\s+of\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^the\s+number\s+of\s+.+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^your\s+devotion\s+to\s+[a-z]+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+difference\s+between\s+those\s+results$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the difference between those results' };
  if (/^the\s+(?:discarded|exiled|revealed|sacrificed)\s+(?:card|artifact)(?:'|’)?s\s+(?:mana\s+value|power|toughness)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+sacrificed\s+artifact(?:'|’)?s\s+mana\s+value$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^cards?\s+equal\s+to\s+.+?\s+mana\s+value(?:\s+from\s+.+)?$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+mana\s+value\s+of\s+the\s+card\s+revealed\s+by\s+the\s+other\s+player$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+total\s+number\s+of\s+instant\s+and\s+sorcery\s+cards\s+you\s+own\s+in\s+exile\s+and\s+in\s+your\s+graveyard$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the\s+life\s+they\s+lost\s+this\s+turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the life they lost this turn' };
  if (/^twice\s+x$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'twice X' };
  if (/^a\s+card\s+for\s+each\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each +1/+1 counter on it' };
  }
  if (/^a\s+card\s+for\s+each\s+creature\s+you\s+control\s+with\s+power\s+4\s+or\s+greater$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each creature you control with power 4 or greater' };
  }
  if (/^a\s+card\s+for\s+each\s+Island\s+you\s+control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a card for each Island you control' };
  if (/^a\s+for\s+each\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a for each creature card in your graveyard' };
  if (/^a\s+for\s+each\s+creature\s+that\s+died\s+this\s+turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a for each creature that died this turn' };
  if (/^a\s+card\s+for\s+each\s+creature\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each creature you control' };
  }
  if (/^a\s+card\s+for\s+each\s+color\s+among\s+permanents\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each color among permanents you control' };
  }
  if (/^a\s+card\s+for\s+each\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a\s+number\s+equal\s+to\s+the\s+amount\s+of\s+mana\s+spent\s+to\s+cast\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'the amount of mana spent to cast it' };
  }
  if (/^(?:a\s+)?number\s+equal\s+to\s+this\s+permanent(?:'|')?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'this_permanent', stat: 'power' };
  }
  if (/^(?:a\s+)?number\s+equal\s+to\s+this\s+creature(?:'|')?s\s+power$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'this_creature', stat: 'power' };
  }
  if (/^(?:a\s+)?number\s+equal\s+to\s+.+$/i.test(trimmed) || /^a\s+equal\s+to\s+.+$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase().replace(/^a\s+equal\s+to\s+/i, 'equal to ') };
  }
  if (/^a\s+number\s+of$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a number of' };
  if (/^equal\s+to\s+that\s+card'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'power' };
  if (/^equal\s+to\s+that\s+card'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_card', stat: 'toughness' };
  if (/^equal\s+to\s+target\s+creature'?s\s+power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  if (/^equal\s+to\s+target\s+creature'?s\s+toughness$/i.test(trimmed)) return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  if (/^equal\s+to\s+.+$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the sacrificed creature'?s toughness$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'toughness' };
  }
  if (/^any number$/i.test(trimmed)) return { kind: 'any_number' };
  if (/^any number of land cards$/i.test(trimmed)) return { kind: 'any_number' };
  if (/^two cards at random$/i.test(trimmed)) return { kind: 'number', value: 2 };
  if (/^three cards at random$/i.test(trimmed)) return { kind: 'number', value: 3 };
  if (/^each$/i.test(trimmed)) return { kind: 'all' };
  if (/^a card at random$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^that many cards plus one$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that many cards plus one' };
  if (/^card$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^a nonland card$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^this creature(?:'|')?s power$/i.test(trimmed)) return { kind: 'object_stat', subject: 'this_creature', stat: 'power' };
  return null;
}
