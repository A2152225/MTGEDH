import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

# Fix MobileToolsHub you type + ignoredCards typing
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobileToolsHub.tsx'),
    """import React, { useEffect, useState } from 'react';
import { AutoPassSettingsPanel } from './AutoPassSettingsPanel';
import { IgnoredCardsPanel } from './IgnoredCardsPanel';
import { colors, fontSize, radii, spacing } from '../theme';""",
    """import React, { useEffect, useState } from 'react';
import type { PlayerID } from '../../../shared/src';
import { AutoPassSettingsPanel } from './AutoPassSettingsPanel';
import { IgnoredCardsPanel } from './IgnoredCardsPanel';
import { colors, fontSize, radii, spacing } from '../theme';""",
)

patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobileToolsHub.tsx'),
    """  ignoredCards?: Array<{ cardId: string; name?: string; imageUrl?: string; [key: string]: any }>;
  you?: string | null;""",
    """  ignoredCards?: any[];
  you?: PlayerID | null;""",
)

# Fix MobilePlaySheets to not extend hub props (avoid you conflict)
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobilePlaySheets.tsx'),
    """import { MobileToolsHub, type MobileToolsHubProps } from './MobileToolsHub';
import type { MobilePrimaryActionMode } from '../utils/mobilePlayActions';
import { colors, fontSize, radii, spacing } from '../theme';

export type MobilePlaySheet = 'hand' | 'stack' | 'mana' | 'more' | null;

export interface MobilePlaySheetsProps extends MobileToolsHubProps {
  activeSheet: MobilePlaySheet;
  onClose: () => void;""",
    """import { MobileToolsHub, type MobileToolsHubProps } from './MobileToolsHub';
import type { MobilePrimaryActionMode } from '../utils/mobilePlayActions';
import { colors, fontSize, radii, spacing } from '../theme';

export type MobilePlaySheet = 'hand' | 'stack' | 'mana' | 'more' | null;

export type MobilePlaySheetsProps = MobileToolsHubProps & {
  activeSheet: MobilePlaySheet;
  onClose: () => void;""",
)

# Close interface with }; instead of }
# The original used `}` to close interface - with type alias we need `};`
# Find the end of props - isPreGame?: boolean;\n}
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobilePlaySheets.tsx'),
    """  onRandomizeStart?: () => void;
  isPreGame?: boolean;
}""",
    """  onRandomizeStart?: () => void;
  isPreGame?: boolean;
};""",
)

print('type fixes ok')