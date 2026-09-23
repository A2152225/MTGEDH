import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

rail = Path(r'D:\Git\MTGEDH\client\src\App-handlers\appPlayLayoutRail.tsx')
patch_once(
    rail,
    """            onOpenTriggerShortcuts={() => setShowTriggerShortcuts(true)}
            onOpenLoopShortcuts={() => setShowLoopShortcutPanel(true)}""",
    """            onOpenTriggerShortcuts={() => {
              setMobilePlaySheet(null);
              setShowTriggerShortcuts(true);
            }}
            onOpenLoopShortcuts={() => {
              setMobilePlaySheet(null);
              setShowLoopShortcutPanel(true);
            }}""",
)
print('close more on shortcut open ok')