from pathlib import Path

p = Path(r'server/src/state/modules/inferTriggeredAbilityTargetMetadata.ts')
t = p.read_text(encoding='utf-8')

# Insert non-GY destination inference after the GY block closes, before targetType inference.
# The GY block ends with a closing `    }` then blank line then `    if (lower.includes('target creature or planeswalker'))`

marker = "    if (lower.includes('target creature or planeswalker')) targetType = 'creature or planeswalker';"
insert = """    // Non-GY put-on-library destinations (battlefield bounce-to-library, e.g. Lashweed Lurker).
    if (!targetDestination) {
      if (/on top of (?:its|their) owner['\\u2019]?s library/.test(lower)) {
        targetDestination = 'library_top';
        destinationUsesSelectedCardOwner = true;
      } else if (lower.includes('on top of your library') || lower.includes('on the top of your library')) {
        targetDestination = 'library_top';
      } else if (/on the bottom of (?:its|their) owner['\\u2019]?s library/.test(lower)) {
        targetDestination = 'library_bottom';
        destinationUsesSelectedCardOwner = true;
      } else if (lower.includes('on the bottom of your library')) {
        targetDestination = 'library_bottom';
      }
    }

""" + marker

if 'Non-GY put-on-library destinations' in t:
    print('already present')
elif marker not in t:
    raise SystemExit('marker missing')
else:
    t = t.replace(marker, insert, 1)
    p.write_text(t, encoding='utf-8')
    print('metadata patched')
