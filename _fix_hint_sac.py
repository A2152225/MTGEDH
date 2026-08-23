from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')
old = """  const hintUnlessDiscardsChoice =
    hint?.unlessDiscardsChoice === 'discard' || hint?.unlessDiscardsChoice === 'decline'
      ? hint.unlessDiscardsChoice
      : undefined;
  const hintSpellCastCountThisTurn = Number(hint?.spellCastCountThisTurn);"""
new = """  const hintUnlessDiscardsChoice =
    hint?.unlessDiscardsChoice === 'discard' || hint?.unlessDiscardsChoice === 'decline'
      ? hint.unlessDiscardsChoice
      : undefined;
  const hintUnlessSacrificesChoice =
    hint?.unlessSacrificesChoice === 'sacrifice' || hint?.unlessSacrificesChoice === 'decline'
      ? hint.unlessSacrificesChoice
      : undefined;
  const hintSpellCastCountThisTurn = Number(hint?.spellCastCountThisTurn);"""
if old not in text:
    raise SystemExit('anchor missing')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('fixed hintUnlessSacrificesChoice')
