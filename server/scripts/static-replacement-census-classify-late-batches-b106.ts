// Verified-live B106 cost / payment / choice systems (UI worker + engine hooks).
// These are classified as elsewhere, not dummy declarative specs.
export const LATE_BATCH_OTHER_SYSTEMS_B106: Array<[string, RegExp]> = [
  ['kicker pay N life', /kicker[^\n.]*pay \d+ life/i],
  ['nontoken type activated additional quoted cost', /activated abilities of nontoken [^\n.]+ cost an additional/i],
  ['spend color mana as though any color', /spend (?:white|blue|black|red|green) mana as though it were mana of any color/i],
  ['spend other mana only as colorless', /spend other mana only as though it were colorless mana/i],
  ['players spend mana as though any color', /players may spend mana as though it were mana of any color/i],
  ['dice exchange with base power or toughness', /if you would roll[^\n.]*sided dice, instead roll them and you may exchange[^\n.]*base power or base toughness/i],
];
