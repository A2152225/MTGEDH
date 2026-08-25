/**
 * Origin parent: rules-engine/src/oracleTextParser.ts
 * Runtime seam for parse helpers that remain in the parent (or later leaves)
 * while parseOracleText lives in oracleTextParserParseOracleText.ts.
 * Leaf must not import oracleTextParser.ts or oracleTextParser-handlers/index.ts.
 */

import type { ParsedAbility, ParsedKeywordAction } from './oracleTextParserTypes.js';

export type OracleTextParserHandlerDeps = {
  parseTriggeredAbility: (text: string) => ParsedAbility | null;
  parseReplacementEffect: (text: string) => ParsedAbility | null;
  parseKeywordActions: (text: string) => ParsedKeywordAction[];
  isTemporarySpellReplacementLine: (text: string) => boolean;
  isSpellInstructionLine: (text: string) => boolean;
};

let oracleTextParserHandlerDeps: OracleTextParserHandlerDeps | undefined;

export function setOracleTextParserHandlerDeps(next: OracleTextParserHandlerDeps): void {
  oracleTextParserHandlerDeps = next;
}

export function getOracleTextParserHandlerDeps(): OracleTextParserHandlerDeps {
  if (!oracleTextParserHandlerDeps) {
    throw new Error('oracleTextParser handler deps are not initialized');
  }
  return oracleTextParserHandlerDeps;
}
