import React, { useState, useEffect } from 'react';
import {
  AppearanceSettings,
  APPEARANCE_PRESETS,
  loadAppearanceSettings,
  saveAppearanceSettings,
  DEFAULT_APPEARANCE_SETTINGS,
} from '../utils/appearanceSettings';
import { ColorPicker } from './ColorPicker';

interface AppearanceSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (settings: AppearanceSettings) => void;
}

export function AppearanceSettingsModal({
  open,
  onClose,
  onApply,
}: AppearanceSettingsModalProps) {
  const [settings, setSettings] = useState<AppearanceSettings>(() => loadAppearanceSettings());
  const [activeTab, setActiveTab] = useState<'table' | 'playArea' | 'highlight'>('table');

  // Reload settings when modal opens
  useEffect(() => {
    if (open) {
      setSettings(loadAppearanceSettings());
    }
  }, [open]);

  if (!open) return null;

  const handleApply = () => {
    saveAppearanceSettings(settings);
    onApply(settings);
    onClose();
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_APPEARANCE_SETTINGS });
  };

  const handlePresetSelect = (preset: typeof APPEARANCE_PRESETS[0]) => {
    setSettings({ ...preset.settings });
  };

  const updateTableBackground = (updates: Partial<AppearanceSettings['tableBackground']>) => {
    setSettings(prev => ({
      ...prev,
      tableBackground: { ...prev.tableBackground, ...updates },
    }));
  };

  const updatePlayAreaBackground = (updates: Partial<AppearanceSettings['playAreaBackground']>) => {
    setSettings(prev => ({
      ...prev,
      playAreaBackground: { ...prev.playAreaBackground, ...updates },
    }));
  };

  const currentBg = activeTab === 'table' ? settings.tableBackground : settings.playAreaBackground;
  const updateBg = activeTab === 'table' ? updateTableBackground : updatePlayAreaBackground;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.7)',
        zIndex: 9000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: 520,
          maxHeight: '85vh',
          background: 'linear-gradient(180deg, #1a1a2e 0%, #16161a 100%)',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 600 }}>
            🎨 Appearance Settings
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 20,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Presets */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8, fontWeight: 500 }}>
              Quick Presets
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {APPEARANCE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handlePresetSelect(preset)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#e0e0e0',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 16,
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              paddingBottom: 12,
            }}
          >
            <button
              onClick={() => setActiveTab('table')}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: '6px 6px 0 0',
                border: 'none',
                background: activeTab === 'table' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                color: activeTab === 'table' ? '#60a5fa' : '#888',
                cursor: 'pointer',
              }}
              title="The tablecloth area surrounding all player boards"
            >
              Table Background
            </button>
            <button
              onClick={() => setActiveTab('playArea')}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: '6px 6px 0 0',
                border: 'none',
                background: activeTab === 'playArea' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                color: activeTab === 'playArea' ? '#60a5fa' : '#888',
                cursor: 'pointer',
              }}
              title="Each player's card area (where cards are displayed)"
            >
              Player Field
            </button>
            <button
              onClick={() => setActiveTab('highlight')}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: '6px 6px 0 0',
                border: 'none',
                background: activeTab === 'highlight' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                color: activeTab === 'highlight' ? '#60a5fa' : '#888',
                cursor: 'pointer',
              }}
              title="Color for highlighting playable cards"
            >
              Highlight Color
            </button>
          </div>

          {/* Description for active tab */}
          <div style={{ 
            color: '#888', 
            fontSize: 11, 
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: 6,
            borderLeft: '2px solid #3b82f6',
          }}>
            {activeTab === 'table' 
              ? '🎴 The tablecloth area that surrounds all player boards'
              : activeTab === 'playArea'
                ? '🃏 The field section where player cards are displayed'
                : '✨ The glow color for playable cards and abilities'}
          </div>

          {/* Settings Panel */}
          {activeTab === 'highlight' ? (
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: 8,
                padding: 16,
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Playable Card Highlight Color</div>
                <ColorPicker
                  color={settings.playableCardHighlightColor || DEFAULT_APPEARANCE_SETTINGS.playableCardHighlightColor!}
                  onChange={(color) => setSettings(prev => ({ ...prev, playableCardHighlightColor: color }))}
                />
              </div>
              
              {/* Preview */}
              <div style={{ marginTop: 16 }}>
                <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Preview</div>
                <div
                  style={{
                    width: 120,
                    height: 167,
                    borderRadius: 8,
                    background: '#1a1a2e',
                    border: '1px solid rgba(255,255,255,0.2)',
                    boxShadow: `0 0 8px 3px ${settings.playableCardHighlightColor || DEFAULT_APPEARANCE_SETTINGS.playableCardHighlightColor}80, 0 0 0 2px ${settings.playableCardHighlightColor || DEFAULT_APPEARANCE_SETTINGS.playableCardHighlightColor}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#888',
                    fontSize: 11,
                    textAlign: 'center',
                    padding: 8,
                  }}
                >
                  Playable Card
                </div>
              </div>
              
              {/* Common color presets */}
              <div style={{ marginTop: 16 }}>
                <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Quick Presets</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { name: 'Green', color: '#22c55e' },
                    { name: 'Blue', color: '#3b82f6' },
                    { name: 'Purple', color: '#a855f7' },
                    { name: 'Gold', color: '#eab308' },
                    { name: 'Cyan', color: '#06b6d4' },
                    { name: 'Pink', color: '#ec4899' },
                  ].map(preset => (
                    <button
                      key={preset.name}
                      onClick={() => setSettings(prev => ({ ...prev, playableCardHighlightColor: preset.color }))}
                      style={{
                        padding: '6px 12px',
                        fontSize: 11,
                        borderRadius: 4,
                        border: `2px solid ${preset.color}`,
                        background: settings.playableCardHighlightColor === preset.color ? `${preset.color}40` : 'transparent',
                        color: preset.color,
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: 8,
              padding: 16,
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {/* Type selector */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Background Type</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => updateBg({ type: 'color' })}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: currentBg.type === 'color' 
                      ? '2px solid #3b82f6' 
                      : '1px solid rgba(255, 255, 255, 0.2)',
                    background: currentBg.type === 'color' 
                      ? 'rgba(59, 130, 246, 0.2)' 
                      : 'rgba(255, 255, 255, 0.05)',
                    color: currentBg.type === 'color' ? '#60a5fa' : '#888',
                    cursor: 'pointer',
                  }}
                >
                  🎨 Solid Color
                </button>
                <button
                  onClick={() => updateBg({ type: 'image' })}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: currentBg.type === 'image' 
                      ? '2px solid #3b82f6' 
                      : '1px solid rgba(255, 255, 255, 0.2)',
                    background: currentBg.type === 'image' 
                      ? 'rgba(59, 130, 246, 0.2)' 
                      : 'rgba(255, 255, 255, 0.05)',
                    color: currentBg.type === 'image' ? '#60a5fa' : '#888',
                    cursor: 'pointer',
                  }}
                >
                  🖼️ Image URL
                </button>
              </div>
            </div>

            {/* Color picker (when type is color) */}
            {currentBg.type === 'color' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Color</div>
                
                {/* Custom HSL Color Picker */}
                <ColorPicker
                  value={currentBg.color}
                  onChange={(color) => updateBg({ color })}
                />
                
                {/* Quick color swatches */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>Quick Presets</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      '#0a0a12', '#1a2540', '#2d1f47', '#1a3020', '#3a1a1a',
                      '#102840', '#2a3a5a', '#0f0a1a', '#000000', '#1a1a2e',
                    ].map((color) => (
                      <button
                        key={color}
                        onClick={() => updateBg({ color })}
                        title={color}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 4,
                          background: color,
                          border: currentBg.color === color 
                            ? '2px solid #60a5fa' 
                            : '1px solid rgba(255, 255, 255, 0.3)',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Image URL input (when type is image) */}
            {currentBg.type === 'image' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Image URL</div>
                <input
                  type="text"
                  value={currentBg.imageUrl}
                  onChange={(e) => updateBg({ imageUrl: e.target.value })}
                  placeholder="https://example.com/image.jpg"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'rgba(0, 0, 0, 0.4)',
                    color: '#fff',
                    boxSizing: 'border-box',
                  }}
                />
                {currentBg.imageUrl && (
                  <div
                    style={{
                      marginTop: 12,
                      height: 100,
                      borderRadius: 6,
                      backgroundImage: `url(${currentBg.imageUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                    }}
                  />
                )}
                <div style={{ color: '#666', fontSize: 11, marginTop: 8 }}>
                  Tip: Use a direct image URL. Supported formats: JPG, PNG, WebP
                </div>
              </div>
            )}

            {/* Preview */}
            <div style={{ marginTop: 16 }}>
              <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Preview</div>
              <div
                style={{
                  height: 80,
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  ...(settings.tableBackground.type === 'image' && settings.tableBackground.imageUrl
                    ? {
                        backgroundImage: `url(${settings.tableBackground.imageUrl})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : { background: settings.tableBackground.color }
                  ),
                }}
              >
                <div
                  style={{
                    width: '60%',
                    height: '50px',
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 11,
                    ...(settings.playAreaBackground.type === 'image' && settings.playAreaBackground.imageUrl
                      ? {
                          backgroundImage: `url(${settings.playAreaBackground.imageUrl})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }
                      : { background: settings.playAreaBackground.color }
                    ),
                  }}
                >
                  Player Field
                </div>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <button
            onClick={handleReset}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
            }}
          >
            Reset to Default
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 20px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'transparent',
                color: '#aaa',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              style={{
                padding: '8px 20px',
                fontSize: 13,
                borderRadius: 6,
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: '#fff',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppearanceSettingsModal;
