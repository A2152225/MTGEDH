// server/scripts/static-replacement-census-classify-late-batches-b94.ts
// B94 classifier: sticker, attraction, and draft-only lines that are not
// playable in MTGEDH (or are attraction/Un-set machinery). These count as
// "other subsystems," not declarative-handled. Keep under 40KB; do not
// append to b80-b90.

export const LATE_BATCH_OTHER_SYSTEMS_B94: Array<[string, RegExp]> = [
  ['attraction prize / open an attraction (not used in MTGEDH)', /open an attraction|claim the prize|put a number of luck counters/i],
  ['sticker name/art modifiers (not used in MTGEDH)', /name sticker|art sticker|sticker on/i],
  ['draft-only start-of-game reveal (not used in MTGEDH)', /before you shuffle your deck to start the game, you may reveal this card from your deck and exile .+ you drafted/i],
  ['draft-only as-you-draft (not used in MTGEDH)', /as you draft(?: it\b| a | this )/i],
  ['playtest / construct-your-deck (not used in MTGEDH)', /as you create your deck\b/i],
];
