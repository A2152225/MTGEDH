# Split handoff - chat L2 (battlefield, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-L2.md.
CONTINUE oracleIRExecutorBattlefieldStepHandlers.ts (now 511766 B / 499.8 KB).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count. Report leftover TOC only if you must abort. Do not edit the module map.
Keep oracleIRExecutor* prefix. No *-handlers/ folder. Leaf must not import the parent.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts --min-bytes 4000
  node tools/ts-cluster-deps.mjs rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts START END

Do NOT move whole: applyGrantTemporaryAbilityStep (47.5 KB OVER), resolveGrantTemporaryMassTargets (25.2 KB
if packing with grants would exceed 40KB). Split grant-temporary later by target-resolution vs apply.

Skip tap/untap still if they close over resolveDirectBattlefieldPermanents.

Next self-contained apply* files (byte-copy --dry, parent re-exports):
1. applyCantAttackStep (~5896-6294, 16.6 KB) + applyCantActivateAbilitiesStep (~6295-6418, 5.4 KB)
   if combined under 40KB; else cant-attack alone.
2. applyAirbendStep + applyEarthbendStep + applyAnimatePermanentStep (contiguous ~6472-6983)
3. applyAddCounterStep (~9650-10161, 22.1 KB) alone
4. applyExileStep (~10529-11227, 32.5 KB) alone - do not pack with sacrifice

Typecheck rules-engine (ignore parallel server errors). oracleIRExecutor vitest. No ts-morph.
```
