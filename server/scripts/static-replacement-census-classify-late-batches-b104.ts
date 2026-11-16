/**
 * B104 census classifier entries. Only "other" for live systems that are not
 * declarative replacements or static parses. Implemented B104 oracles are marked
 * handled via parse or collect, not by this list.
 *
 * Canal Dredger's booster-pass line is draft-only and is not a battlefield static.
 */
export const LATE_BATCH_OTHER_SYSTEMS_B104: Array<[string, RegExp]> = [
  ['draft booster last-card pass (Canal Dredger; not a battlefield static)', /each player passes the last card from each booster pack to a player who drafted a card named ~/i],
];
