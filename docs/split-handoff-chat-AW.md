# Split handoff - chat AW (oracleIR.ts)

Parent now: **67945 B / 66.4 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AW.md.
Sole writer for rules-engine/src/oracleIR.ts and new oracleIR-handlers/**
OR family siblings oracleIREffectStep*.ts in the same directory.
Prefer a handlers folder on extract #1. Never create oracleIR/ beside oracleIR.ts.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent CRLF; leaves LF. Do not Read the whole parent.

The elephant is `export type OracleEffectStep` (~171-1853, 59.4 KB).
Do NOT move the type whole. Split by contiguous discriminated-union members
(start at `| {` / `| { readonly kind:`). Chunks ~18-25 KB:
  stepA ~171-700 (18.2 KB), stepB ~701-1200 (16.7 KB), stepC ~1201-1853 (24.5 KB)
  — re-measure; split only on member boundaries.
Parent leftover: `export type OracleEffectStep = A | B | C` (or re-export).

OracleQuantity / OraclePlayerSelector can move if still needed for the ceiling.

Leaf must not import oracleIR.ts or the index. Byte-copy --dry first.
Typecheck rules-engine. Parser / IR vitest. No ts-morph.
```
