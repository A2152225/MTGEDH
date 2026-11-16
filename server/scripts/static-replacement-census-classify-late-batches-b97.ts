// server/scripts/static-replacement-census-classify-late-batches-b97.ts
// B97 classifier: leftover lines already implemented by another subsystem,
// or keyword/activated/trigger lines the main classifier missed (ability-word
// punctuation, typographic apostrophes, extra sentences). Lines this batch
// parses or collects must not be listed here (classifier wins before parse).

export const LATE_BATCH_OTHER_SYSTEMS_B97: Array<[string, RegExp]> = [
  ['enter as a copy (asEntersCopyChoice)', /you may have (?:this \w+|~) enter as a copy of/i],
  ['morph/disguise typographic return-to-hand cost (turnFaceUpCostComponents)', /^(?:morph|megamorph|disguise)\s*[\u2014\u2013-]\s*return (?:a|an|one|two) .+ you control to (?:its|their) owners?['\u2019]?s? hands?/i],
  ['draw-to-graveyard-return with lose-game rider (replacementBatch19DrawInstead)', /^if you would draw a card, return a card from your graveyard to your hand instead\. if you can't, you lose the game$/i],
  ['extra vote (voteAdditionalVotes)', /^while voting, you get an additional vote$/i],
  ['draft-only typeline note (not used in MTGEDH)', /^draft this card face up|^as you draft a /i],
  ['equip once-each-turn restriction (permanentAbilityDiscovery)', /^equip \{[^}]+\}\. activate only once each turn$/i],
  ['ability-word ellipsis trigger (when/whenever/at)', /^(?:\.{2,}|…)\s*.+[\u2014\u2013-]\s*(?:when|whenever|at)\b/i],
  ['ability-word question trigger (when/whenever/at)', /^.+\?\s*[\u2014\u2013-]\s*(?:when|whenever|at)\b/i],
  ['ability-word unicode trigger (when/whenever/at)', /^.*[^\x00-\x7F].*[\u2014\u2013-]\s*(?:when|whenever|at)\b/i],
];
