// server/src/state/modules/context.ts
// Compatibility shim: re-export the canonical context helpers from server/src/state/context.
// Some state modules import "./context" relative to the modules folder; this shim forwards
// those imports to the real module to avoid ERR_MODULE_NOT_FOUND after refactors.
export * from "../context";