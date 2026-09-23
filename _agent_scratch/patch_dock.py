import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

# Pass label + subtle pulse CSS animation when highlightPass
patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobileActionDock.tsx'),
    """import React from 'react';
import { colors, spacing, fontSize, radii, shadows, z, safeArea } from '../theme';
import { MobileMulliganActions } from './MobileMulliganActions';
import type { MobilePrimaryActionMode } from '../utils/mobilePlayActions';""",
    """import React, { useEffect, useState } from 'react';
import { colors, spacing, fontSize, radii, shadows, z, safeArea } from '../theme';
import { MobileMulliganActions } from './MobileMulliganActions';
import type { MobilePrimaryActionMode } from '../utils/mobilePlayActions';

const PASS_ATTENTION_STYLE_ID = 'mtgedh-mobile-pass-attention';
function ensurePassAttentionStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PASS_ATTENTION_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PASS_ATTENTION_STYLE_ID;
  style.textContent = `@keyframes mtgedhPassPulse { 0% { box-shadow: 0 0 0 0 rgba(251,191,36,0.55); } 70% { box-shadow: 0 0 0 10px rgba(251,191,36,0); } 100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); } }
@media (prefers-reduced-motion: reduce) { .mtgedh-pass-attention { animation: none !important; } }`;
  document.head.appendChild(style);
}""",
)

patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobileActionDock.tsx'),
    """interface DockButtonProps {
  label: string;
  badge?: number;
  highlight?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

const DockButton: React.FC<DockButtonProps> = ({ label, badge, highlight, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      flex: 1,
      minHeight: 52,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      background: highlight
        ? `linear-gradient(180deg, ${colors.accentStrong}, ${colors.accent})`
        : colors.surfaceTransparent,
      color: highlight ? '#0b0b10' : disabled ? colors.textMuted : colors.textPrimary,
      border: `1px solid ${highlight ? colors.accentStrong : colors.borderSubtle}`,
      borderRadius: radii.md,
      boxShadow: highlight ? shadows.sm : 'none',
      fontSize: fontSize.sm,
      fontWeight: highlight ? 600 : 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      position: 'relative',
      padding: `${spacing.xs}px ${spacing.sm}px`,
    }}
  >""",
    """interface DockButtonProps {
  label: string;
  badge?: number;
  highlight?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  attention?: boolean;
}

const DockButton: React.FC<DockButtonProps> = ({ label, badge, highlight, disabled, onClick, className, attention }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={className}
    style={{
      flex: 1,
      minHeight: 52,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      background: highlight
        ? `linear-gradient(180deg, ${colors.accentStrong}, ${colors.accent})`
        : colors.surfaceTransparent,
      color: highlight ? '#0b0b10' : disabled ? colors.textMuted : colors.textPrimary,
      border: `1px solid ${highlight ? colors.accentStrong : colors.borderSubtle}`,
      borderRadius: radii.md,
      boxShadow: highlight ? shadows.sm : 'none',
      fontSize: fontSize.sm,
      fontWeight: highlight ? 600 : 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      position: 'relative',
      padding: `${spacing.xs}px ${spacing.sm}px`,
      animation: attention ? 'mtgedhPassPulse 1.1s ease-out 1' : undefined,
    }}
  >""",
)

patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobileActionDock.tsx'),
    """  onKeepHand,
  onMulligan,
  onUnkeepHand,
}) => {
  const mulliganMode = primaryMode === 'mulligan' || primaryMode === 'unkeep';

  return (""",
    """  onKeepHand,
  onMulligan,
  onUnkeepHand,
}) => {
  const mulliganMode = primaryMode === 'mulligan' || primaryMode === 'unkeep';
  const [passAttention, setPassAttention] = useState(false);

  useEffect(() => {
    if (!highlightPass || mulliganMode) {
      setPassAttention(false);
      return;
    }
    ensurePassAttentionStyle();
    setPassAttention(true);
    const t = window.setTimeout(() => setPassAttention(false), 1200);
    return () => window.clearTimeout(t);
  }, [highlightPass, mulliganMode]);

  return (""",
)

patch_once(
    Path(r'D:\Git\MTGEDH\client\src\components\MobileActionDock.tsx'),
    """      {!mulliganMode && (
        <DockButton label=\"Pass\" highlight={highlightPass} disabled={passDisabled} onClick={onPassPriority} />
      )}""",
    """      {!mulliganMode && (
        <DockButton
          label={highlightPass ? 'Pass ✓' : 'Pass'}
          highlight={highlightPass}
          disabled={passDisabled}
          onClick={onPassPriority}
          className={passAttention ? 'mtgedh-pass-attention' : undefined}
          attention={passAttention}
        />
      )}""",
)

print('dock ok')