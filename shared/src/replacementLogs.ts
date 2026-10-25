// Typed client-visible replacement feeds on GameState (the client toasts new entries; see
// client/src/utils/stateEventToasts.ts). Written by the server replacement modules.
// Public: DrawReplacementLogEntry, SkippedExtraTurnEntry, DamageReplacementLogRecord.

export interface DrawReplacementLogEntry { playerId: string; sourceName: string; effect: string; timestamp?: number }
export interface SkippedExtraTurnEntry { playerId: string; sourceName: string; timestamp: number }
export interface DamageReplacementLogRecord { messages: string[]; original: number; amount: number; timestamp: number }