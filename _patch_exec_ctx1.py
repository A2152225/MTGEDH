from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')

old = """  const hintUnlessDiscardsChoice =
    hint?.unlessDiscardsChoice === 'discard' || hint?.unlessDiscardsChoice === 'decline'
      ? hint.unlessDiscardsChoice
      : undefined;"""
new = """  const hintUnlessDiscardsChoice =
    hint?.unlessDiscardsChoice === 'discard' || hint?.unlessDiscardsChoice === 'decline'
      ? hint.unlessDiscardsChoice
      : undefined;
  const hintUnlessSacrificesChoice =
    hint?.unlessSacrificesChoice === 'sacrifice' || hint?.unlessSacrificesChoice === 'decline'
      ? hint.unlessSacrificesChoice
      : undefined;"""
if old not in text:
    raise SystemExit('hintUnlessDiscards missing')
text = text.replace(old, new, 1)

# baseSel version
old2 = None
idx = text.find('baseSel?.unlessDiscardsChoice')
print('baseSel idx', idx)
print(repr(text[idx-80:idx+250]))
