import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

eff = Path(r'D:\Git\MTGEDH\client\src\App-handlers\appPlayDerivedEffects.ts')

patch_once(
    eff,
    """import { shouldAutoOpenMobileMulliganHand } from "../utils/mobilePlayActions";""",
    """import {
  shouldAutoOpenMobileMulliganHand,
  shouldAutoOpenMobileStackSheet,
} from "../utils/mobilePlayActions";""",
)

patch_once(
    eff,
    """  const autoOpenedMulliganHandKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const decision = shouldAutoOpenMobileMulliganHand({
      showMobileChrome,
      needsToKeepHand,
      handCount: yourHandCount,
      gameId: safeView?.id,
      mulligansTaken,
      lastOpenedKey: autoOpenedMulliganHandKeyRef.current,
    });
    if (decision.key) autoOpenedMulliganHandKeyRef.current = decision.key;
    if (decision.open) setMobilePlaySheet('hand');
  }, [showMobileChrome, needsToKeepHand, yourHandCount, safeView?.id, mulligansTaken, setMobilePlaySheet]);""",
    """  const autoOpenedMulliganHandKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const decision = shouldAutoOpenMobileMulliganHand({
      showMobileChrome,
      needsToKeepHand,
      handCount: yourHandCount,
      gameId: safeView?.id,
      mulligansTaken,
      lastOpenedKey: autoOpenedMulliganHandKeyRef.current,
    });
    if (decision.key) autoOpenedMulliganHandKeyRef.current = decision.key;
    if (decision.open) setMobilePlaySheet('hand');
  }, [showMobileChrome, needsToKeepHand, yourHandCount, safeView?.id, mulligansTaken, setMobilePlaySheet]);

  const autoOpenedStackKeyRef = useRef<string | null>(null);
  const stackLen = Array.isArray((safeView as any)?.stack) ? (safeView as any).stack.length : 0;
  const topStackId = stackLen > 0 ? String((safeView as any).stack[stackLen - 1]?.id ?? (safeView as any).stack[0]?.id ?? '') : null;
  useEffect(() => {
    const decision = shouldAutoOpenMobileStackSheet({
      showMobileChrome,
      isSeatedPlayer: !!isYouPlayer && !isSpectator,
      hasPriority: !!you && safeView?.priority === you,
      stackLength: stackLen,
      gameId: safeView?.id,
      priority: safeView?.priority ?? null,
      topStackId,
      lastOpenedKey: autoOpenedStackKeyRef.current,
    });
    if (decision.key) autoOpenedStackKeyRef.current = decision.key;
    if (decision.open) setMobilePlaySheet('stack');
  }, [showMobileChrome, isYouPlayer, isSpectator, you, safeView?.priority, safeView?.id, stackLen, topStackId, setMobilePlaySheet]);""",
)

print('derived effects ok')