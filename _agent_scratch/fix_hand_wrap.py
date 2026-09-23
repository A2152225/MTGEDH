import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

hg = Path(r'D:\Git\MTGEDH\client\src\components\HandGallery.tsx')

patch_once(
    hg,
    """  return (
    <div ref={galleryRef} style={{ position: 'relative', ...widthStyle }}>""",
    """  return (
    <div style={{ position: 'relative', width: '100%' }}>
    <div ref={galleryRef} style={{ position: 'relative', ...widthStyle }}>""",
)

# Close the gallery flex div before the action bar, keep action bar in outer wrapper
# Find the action bar start and insert closing div before it
patch_once(
    hg,
    """      {visibleCards.length === 0 && !hidden && (
        <div style={{ color: '#777', fontSize: 12 }}>Empty hand</div>
      )}

      {isTouch && focusedCardId && (() => {""",
    """      {visibleCards.length === 0 && !hidden && (
        <div style={{ color: '#777', fontSize: 12 }}>Empty hand</div>
      )}
    </div>

      {isTouch && focusedCardId && (() => {""",
)

# Fix mojibake emdash in button labels - read raw and replace bad sequences
text = hg.read_bytes().decode('utf-8')
# Replace any weird separators in Play Land / Cast disabled labels with ASCII
import re
text2 = text
# Normalize labels that may have corrupted dashes
text2 = text2.replace('Play Land — ', 'Play Land - ')
text2 = text2.replace('Cast — ', 'Cast - ')
# Also fix replacement char variants
text2 = re.sub(r"Play Land .\s*\$\{cantPlayLand\}", "Play Land - ${cantPlayLand}", text2)
text2 = re.sub(r"Cast .\s*\$\{cantCast\}", "Cast - ${cantCast}", text2)

# Ensure closing: currently ends with })()}\n    </div>\n  );\n}
# After our wrap we need one more closing div
if text2.count('<div style={{ position: \'relative\', width: \'100%\' }}>') == 1:
    # The final closing should close outer then function
    old_end = """      })()}
    </div>
  );
}"""
    new_end = """      })()}
    </div>
  );
}"""
    # Actually after inserting mid-close, structure is:
    # outer
    #   gallery ... </div>  (we added)
    #   actionbar
    # </div>  (original end)
    # so end is fine as-is if we only added one open and one mid-close.
    pass

from safe_write import write_text
write_text(hg, text2)
print('handgallery structure/labels updated')

# verify div balance roughly
t = hg.read_text(encoding='utf-8')
print('open divs', t.count('<div'), 'close', t.count('</div>'))
print('has outer', "width: '100%'" in t)
print('cast label sample')
for line in t.splitlines():
    if 'Cast -' in line or 'Play Land -' in line or 'cantCast ?' in line or 'cantPlayLand ?' in line:
        print(line.strip())