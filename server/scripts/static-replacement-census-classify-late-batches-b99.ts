/**
 * B99 census classifier entries. Only "other" for systems that are intentionally
 * not engine-handled here. Implemented B99 oracles are marked handled via parse
 * or collect, not by this list. Ichor ignore-one and madness pay-life stay
 * unhandled (queued for the UI worker).
 */
export const LATE_BATCH_OTHER_SYSTEMS_B99: Array<[string, RegExp]> = [];
