from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/effectProgramOracleRunner.ts')
text = p.read_text(encoding='utf-8')

old = """    if (oracleStepKind === 'unless_pays_mana' || oracleStepKind === 'unless_pays_life') {
      const payChoice = firstSelection === 'pay';
      if (oracleStepKind === 'unless_pays_mana') {
        selectorContext.unlessPaysManaChoice = payChoice ? 'pay' : 'decline';
      } else {
        selectorContext.unlessPaysLifeChoice = payChoice ? 'pay' : 'decline';
      }
      continue;
    }"""
new = """    if (oracleStepKind === 'unless_pays_mana' || oracleStepKind === 'unless_pays_life') {
      const payChoice = firstSelection === 'pay';
      if (oracleStepKind === 'unless_pays_mana') {
        selectorContext.unlessPaysManaChoice = payChoice ? 'pay' : 'decline';
      } else {
        selectorContext.unlessPaysLifeChoice = payChoice ? 'pay' : 'decline';
      }
      continue;
    }

    if (oracleStepKind === 'unless_discards') {
      selectorContext.unlessDiscardsChoice = firstSelection === 'discard' ? 'discard' : 'decline';
      continue;
    }

    if (oracleStepKind === 'unless_sacrifices') {
      selectorContext.unlessSacrificesChoice = firstSelection === 'sacrifice' ? 'sacrifice' : 'decline';
      continue;
    }"""
if old not in text:
    raise SystemExit('choice block missing')
text = text.replace(old, new, 1)

old2 = """    ...(derived.selectorContext?.unlessPaysLifeChoice === 'pay' || derived.selectorContext?.unlessPaysLifeChoice === 'decline'
      ? { unlessPaysLifeChoice: derived.selectorContext.unlessPaysLifeChoice }
      : {}),
    selectorContext: {"""
new2 = """    ...(derived.selectorContext?.unlessPaysLifeChoice === 'pay' || derived.selectorContext?.unlessPaysLifeChoice === 'decline'
      ? { unlessPaysLifeChoice: derived.selectorContext.unlessPaysLifeChoice }
      : {}),
    ...(derived.selectorContext?.unlessDiscardsChoice === 'discard' || derived.selectorContext?.unlessDiscardsChoice === 'decline'
      ? { unlessDiscardsChoice: derived.selectorContext.unlessDiscardsChoice }
      : {}),
    ...(derived.selectorContext?.unlessSacrificesChoice === 'sacrifice' || derived.selectorContext?.unlessSacrificesChoice === 'decline'
      ? { unlessSacrificesChoice: derived.selectorContext.unlessSacrificesChoice }
      : {}),
    selectorContext: {"""
if old2 not in text:
    raise SystemExit('spread block missing')
text = text.replace(old2, new2, 1)
p.write_text(text, encoding='utf-8')
print('epor ok')
