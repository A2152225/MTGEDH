// server/src/state/modules/continuousEffectRegistry.ts
// Layer-2 control registry lives in rules-engine (rules-engine/src/controlEffectRegistry.ts) so rules-engine
// turn actions and the Oracle IR executor derive control the same way. Re-exported here for server callers.
// Public entry symbols: oracleGrantsAuraControl, registerControlEffect, syncControlFromRegistry,
//   removeControlEffects, ControlEffectEntry, ControlChange.

export * from '../../../../rules-engine/src/controlEffectRegistry.js';
