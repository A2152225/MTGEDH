from pathlib import Path
p = Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorConditionalStepSupport.ts")
text = p.read_text(encoding="utf-8")
old = """  {
    const youHaveGraveyard = tryEvaluateConditionalYouHaveGraveyard({
      ...params,
      evaluateRecursive: evaluateConditionalWrapperCondition,
    });
    if (youHaveGraveyard !== undefined) return youHaveGraveyard;
  }

  return null;
}"""
new = """  {
    const youHaveGraveyard = tryEvaluateConditionalYouHaveGraveyard({
      ...params,
      evaluateRecursive: evaluateConditionalWrapperCondition,
    });
    if (youHaveGraveyard !== undefined) return youHaveGraveyard;
  }

  // Route remaining if/as_long_as clauses through the shared extended evaluator
  // (typed control checks, Amass/Empower-style "you don't control ...", etc.).
  {
    const extended = evaluateExtendedConditionalClause({
      normalizedRaw,
      raw: condition.raw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      step: params.step,
    });
    if (extended !== null) return extended;
  }

  return null;
}"""
if old not in text:
  raise SystemExit("ANCHOR NOT FOUND in conditional support")
p.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
print("patched conditional support")
# verify
lines = p.read_text(encoding="utf-8").splitlines()
for i, l in enumerate(lines, 1):
  if "extended" in l.lower() or "youHaveGraveyard" in l or "return null" in l:
    if 100 <= i <= 160:
      print(f"{i}:{l}")
