import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

# A) layout thumb + inset
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\hooks\useMobilePlayLayout.ts'),
    """  handStripThumbWidth: 62,
  playAreaBottomInset: 148,""",
    """  handStripThumbWidth: 76,
  playAreaBottomInset: 168,""",
)

# Update layout test to expect >= 76 for portrait thumbs
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\hooks\useMobilePlayLayout.test.ts'),
    """    expect(profile.playAreaBottomInset).toBeGreaterThan(0);
    expect(profile.handStripThumbWidth).toBeGreaterThan(0);""",
    """    expect(profile.playAreaBottomInset).toBeGreaterThanOrEqual(168);
    expect(profile.handStripThumbWidth).toBeGreaterThanOrEqual(76);""",
)

# B) Expand button >= 44px
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobileHandStrip.tsx'),
    """        {onExpandHand && (
          <button
            type="button"
            onClick={onExpandHand}
            style={{
              fontSize: fontSize.xs,
              padding: '2px 8px',
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceTransparent,
              color: colors.textPrimary,
              cursor: 'pointer',
            }}
          >
            Expand
          </button>
        )}""",
    """        {onExpandHand && (
          <button
            type="button"
            onClick={onExpandHand}
            style={{
              fontSize: fontSize.sm,
              minHeight: 44,
              minWidth: 72,
              padding: '8px 12px',
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceTransparent,
              color: colors.textPrimary,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Expand
          </button>
        )}""",
)

# C) GameCommunicationsPanel mobile position
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\GameCommunicationsPanel.tsx'),
    """  const dimensions = SIZE_CONFIG[size];
  const bottom = 12 + Math.max(0, bottomInset);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: 12,
        bottom,
        zIndex: 9200,""",
    """  const dimensions = SIZE_CONFIG[size];
  const bottom = 12 + Math.max(0, bottomInset);
  // On mobile chrome the hand strip owns the bottom-left edge; park log/chat on the right.
  const mobileChrome = bottomInset > 0;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: mobileChrome ? 'auto' : 12,
        right: mobileChrome ? 12 : 'auto',
        bottom,
        zIndex: 9200,""",
)

print('batch A ok')