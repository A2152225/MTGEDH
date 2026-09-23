import sys
from pathlib import Path
sys.path.insert(0, r'D:\Git\MTGEDH\_agent_scratch')
from safe_write import patch_once

rail = Path(r'D:\Git\MTGEDH\client\src\App-handlers\appPlayLayoutRail.tsx')

# Remove LoopShortcutPanel from inside utility rail (keep the button), then mount outside for rail+mobile
# First replace the LoopShortcutPanel block inside rail with nothing (button stays)
patch_once(
    rail,
    """                  <LoopShortcutPanel
                    open={showLoopShortcutPanel}
                    onClose={() => setShowLoopShortcutPanel(false)}
                    isRecording={isLoopShortcutRecording}
                    isRunning={isLoopShortcutRunning}
                    items={loopShortcutItems}
                    shortcutName={loopShortcutName}
                    savedShortcuts={savedLoopShortcuts}
                    iterationCount={loopShortcutIterations}
                    onShortcutNameChange={setLoopShortcutName}
                    onIterationCountChange={(count) => setLoopShortcutIterations(clampLoopShortcutIterations(count))}
                    onStartRecording={handleStartLoopShortcutRecording}
                    onStopRecording={handleStopLoopShortcutRecording}
                    onRun={handleRunLoopShortcut}
                    onClear={handleClearLoopShortcut}
                    onSaveShortcut={handleSaveLoopShortcut}
                    onLoadShortcut={handleLoadSavedLoopShortcut}
                    onDeleteShortcut={handleDeleteSavedLoopShortcut}
                    statusText={loopShortcutStatusText}
                  />

                </div>""",
    """                </div>""",
)

# Mount LoopShortcutPanel after YourTurnBanner so mobile More hub can open it too
patch_once(
    rail,
    """      <YourTurnBanner open={yourTurnBannerVisible} />
      <CardPreviewLayer controlMode={showExpandedUtilityRail ? 'hidden' : 'floating'} />""",
    """      <YourTurnBanner open={yourTurnBannerVisible} />
      <CardPreviewLayer controlMode={showExpandedUtilityRail ? 'hidden' : 'floating'} />

      {/* Loop panel is shared by desktop rail + mobile Tools hub (rail is off on mobile). */}
      {(showUtilityRail || showMobileChrome) && safeView && you && !isSpectator && (
        <LoopShortcutPanel
          open={showLoopShortcutPanel}
          onClose={() => setShowLoopShortcutPanel(false)}
          isRecording={isLoopShortcutRecording}
          isRunning={isLoopShortcutRunning}
          items={loopShortcutItems}
          shortcutName={loopShortcutName}
          savedShortcuts={savedLoopShortcuts}
          iterationCount={loopShortcutIterations}
          onShortcutNameChange={setLoopShortcutName}
          onIterationCountChange={(count) => setLoopShortcutIterations(clampLoopShortcutIterations(count))}
          onStartRecording={handleStartLoopShortcutRecording}
          onStopRecording={handleStopLoopShortcutRecording}
          onRun={handleRunLoopShortcut}
          onClear={handleClearLoopShortcut}
          onSaveShortcut={handleSaveLoopShortcut}
          onLoadShortcut={handleLoadSavedLoopShortcut}
          onDeleteShortcut={handleDeleteSavedLoopShortcut}
          statusText={loopShortcutStatusText}
        />
      )}""",
)

print('loop panel remount ok')