/**
 * B103 census classifier entries. Only "other" for live systems that are not
 * declarative replacements or static parses. Implemented B103 oracles are marked
 * handled via parse or collect, not by this list.
 *
 * d20 "N or less |" / imperative "N+ |" bands belong to the existing oracle-IR
 * die-roll table system (the B48 classifier only matched "N" and "N-N" pipes).
 * Disguise {mana} is already live in faceDownCasting.
 */
export const LATE_BATCH_OTHER_SYSTEMS_B103: Array<[string, RegExp]> = [
  ['d20 result band line (N or less / N+ imperative via oracleIRParserDieRollInlineBandTables)', /^(?:\d+\s+or (?:less|fewer)|\d+\s*\+)\s*\|\s*(?:put|create|deal|draw|return|sacrifice|destroy|exile|mill|look|search|gain|lose|discard|tap|untap|shuffle|add|scry|surveil|you |it |those |that |the |each |target )\b.+$/i],
  ['disguise mana cost (faceDownCasting)', /^disguise\s*\{/i],
  ['d20 result band remainder after station-prefix strip (oracleIRParserDieRollInlineBandTables)', /^put those cards onto the battlefield(?: tapped)?(?:, then shuffle)?$/i],
];
