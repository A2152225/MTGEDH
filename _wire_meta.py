from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/inferTriggeredAbilityTargetMetadata.ts')
text = p.read_text(encoding='utf-8')

# Patch non-GY up-to-one section to handle for-each-opponent
old = '''    } else if (/\\bup to one target\\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 1;
    } else if (/\\bup to two target\\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 2;
    } else if (/\\bup to'''

# There are two similar blocks - patch both carefully by counting
count = text.count('} else if (/\\bup to one target\\b/.test(lower)) {\n      minTargets = 0;\n      maxTargets = 1;')
print('count simple uptoone', count)

replacement = '''    } else if (/\\bfor each opponent\\b/.test(lower) && /\\bup to one target\\b/.test(lower)) {
      minTargets = 0;
      const players = Array.isArray(context?.gameState?.players) ? context!.gameState.players : [];
      const controllerId = String(context?.controllerId || '').trim();
      const opponentCount = players.filter((pl: any) => {
        const id = String(pl?.id || '').trim();
        return id && id !== controllerId;
      }).length;
      maxTargets = Math.max(1, opponentCount || 3);
    } else if (/\\bup to one target\\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 1;
    } else if (/\\bup to'''

# Only replace in non-GY section - the second occurrence. Find "// Non-GY"
ngy = text.find('// Non-GY')
if ngy < 0:
    raise SystemExit('Non-GY marker missing')
before, after = text[:ngy], text[ngy:]
if old not in after:
    # show
    i = after.find('up to one target')
    print(repr(after[i-40:i+120]))
    raise SystemExit('old block not in Non-GY section')
after = after.replace(old, replacement, 1)
text = before + after

# permanent or opponent target type - before target permanent
old2 = "else if (lower.includes('target permanent')) targetType = 'permanent';"
new2 = "else if (/target permanent or opponent\\b/.test(lower) || /target opponent or permanent\\b/.test(lower)) targetType = 'permanent or player';\n    else if (lower.includes('target permanent')) targetType = 'permanent';"
if "permanent or player" not in text:
    if old2 not in text:
        raise SystemExit('target permanent line missing')
    text = text.replace(old2, new2, 1)
    print('added permanent or player')

p.write_text(text, encoding='utf-8')
print('metadata updated')
