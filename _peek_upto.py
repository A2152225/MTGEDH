from pathlib import Path
import re

# Update metadata for for-each-opponent and permanent-or-opponent
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/inferTriggeredAbilityTargetMetadata.ts')
text = p.read_text(encoding='utf-8')

# Find up to one target handling outside graveyard - read more of file
if 'for each opponent' not in text.lower() or 'for each opponent' not in text:
    # Find where min/max for up to one is set for non-GY
    # Search up to one in non-graveyard section
    pass

# Show where battlefield up-to is handled
idxs = [m.start() for m in re.finditer(r'up to one target', text)]
print('up to one hits', idxs)
for i in idxs:
    print(text[i-80:i+200])
    print('---')
