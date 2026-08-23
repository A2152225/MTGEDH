from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts')
text = p.read_text(encoding='utf-8')
# After targets resolved, if optional and no targets, no-op
marker = '''  if (
    targets.length === 0 &&
    (normalizedTargetText === 'among creatures you control' ||
      /^any number of \\+1\\/\\+1 counters from among creatures you control$/i.test(normalizedTargetText))
  ) {
    return { applied: true, state, log: ['No +1/+1 counters to remove'] };
  }'''

insert = '''  if (targets.length === 0 && (step as any).optional === true) {
    return { applied: true, state, log: ['No target chosen for optional remove-counter'] };
  }
'''

if 'No target chosen for optional remove-counter' not in text:
    if marker not in text:
        # try looser
        idx = text.find("return { applied: true, state, log: ['No +1/+1 counters to remove'] };")
        print('idx', idx)
        if idx < 0:
            raise SystemExit('noop marker missing')
    text = text.replace(marker, insert + marker, 1)
    p.write_text(text, encoding='utf-8')
    print('added optional no-target noop')
else:
    print('optional noop present')
