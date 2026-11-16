// Verified-live B109 payment / cast-cost systems finished by the UI worker.
// Counted as other systems, not dummy declarative specs.
// Valgavoth's exile-play line and Breathstealer's Crypt stay on the B107 list.
export const LATE_BATCH_OTHER_SYSTEMS_B109: Array<[string, RegExp]> = [
  ['cycling—pay N life', /cycling\s*[\u2014-]\s*pay \d+ life/i],
  ["kicker—return a creature you control to its owner's hand", /kicker\s*[\u2014-]\s*return a creature you control to its owner['\u2019]s hand/i],
  ["players can't pay life to cast spells or to activate abilities that aren't mana abilities", /players can['\u2019]t pay life to cast spells or to activate abilities that aren['\u2019]t mana abilities/i],
  ['the first card you foretell each turn costs {0} to foretell', /the first card you foretell each turn costs \{0\} to foretell/i],
  ['equip—sacrifice another nonland permanent', /equip\s*[\u2014-]\s*sacrifice another nonland permanent/i],
  ["~ can't attack unless you sacrifice a land", /~ can't attack unless you sacrifice a land/i],
  ["~ can't attack unless you sacrifice N islands", /~ can't attack unless you sacrifice (?:two|\d+) islands/i],
  ["enchanted creature can't be blocked unless defending player pays {M}", /enchanted creature can't be blocked unless defending player pays \{[^}]+\} for each creature they control that's blocking/i],
  ['commander creatures you own get +N/+N and have flying, deathtouch, and a quoted upkeep sacrifice', /commander creatures you own get \+\d+\/\+\d+ and have flying, deathtouch/i],
  ['creature spells you cast gain offspring {N}', /creature spells you cast gain offspring \{[^}]+\}/i],
  ['after you roll a die, you may remove a +1/+1 counter and nudge the result', /after you roll a die, you may remove a \+1\/\+1 counter from ~/i],
  ['after you roll a die, you may pay N life and nudge the result', /after you roll a die, you may pay \d+ life\. if you do, increase or decrease the result by 1/i],
  ['if you would draw a card, instead reveal the top N and put creature cards into your hand', /if you would draw a card, instead reveal the top \w+ cards of your library\. put all creature cards revealed this way into your hand/i],
];
