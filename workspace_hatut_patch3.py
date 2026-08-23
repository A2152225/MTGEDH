from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\state\modules\oracleIrServerCopySpellSync.ts")
text = path.read_text(encoding='utf-8')
old = """  const metadataCount = Number(params.gapMetadata?.copyCount);
  if (Number.isFinite(metadataCount) && metadataCount > 0) {
    let count = Math.max(0, metadataCount);
    if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
      count = 2;
    }
    return count;
  }

  // metadata copyCount 0/missing: re-resolve so commander-CZ tax (and similar) is not sticky-zeroed
  let count = Math.max(0, resolveCopySpellCount(state, controller, step, irCtx));
  if (
    count <= 0
    && isCommanderCastFromCommandZoneCopyStep(step)
  ) {
    count = resolveCommanderCastsFromCommandZoneThisGame(state, controller);
  }
"""
new = """  const metadataCount = Number(params.gapMetadata?.copyCount);
  if (Number.isFinite(metadataCount) && metadataCount > 0) {
    let count = Math.max(0, metadataCount);
    if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
      count = 2;
    }
    return count;
  }

  // Sticky copyCount:0 from a prior IR miss: re-resolve commander-CZ reference amounts from tax.
  // Other copy steps keep an explicit 0 so we do not invent copies.
  if (
    Number.isFinite(metadataCount)
    && metadataCount === 0
    && !isCommanderCastFromCommandZoneCopyStep(step)
  ) {
    return 0;
  }

  let count = Math.max(0, resolveCopySpellCount(state, controller, step, irCtx));
  if (
    count <= 0
    && isCommanderCastFromCommandZoneCopyStep(step)
  ) {
    count = resolveCommanderCastsFromCommandZoneThisGame(state, controller);
  }
"""
if old not in text:
    raise SystemExit('block not found for refine')
path.write_text(text.replace(old, new, 1), encoding='utf-8', newline='\n')
print('refined')
