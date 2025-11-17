// server/src/state/db.ts
// Compatibility shim for state modules that import "../db" from server/src/state/*
// Re-export the canonical DB helpers from server/src/db and decks submodule.
// This avoids touching many imports and keeps a single source of truth.

export * from "../db";
export * from "../db/decks";