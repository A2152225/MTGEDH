/**
 * Appearance settings for the game table and play areas.
 * These settings are cached in localStorage for persistence across sessions.
 */

import type React from 'react';
import type { ImagePref } from '../components/BattlefieldGrid';

export interface AppearanceSettings {
  // Table background (the outer area)
  tableBackground: {
    type: 'color' | 'image';
    color: string;       // CSS color value
    imageUrl: string;    // URL or empty string
  };
  // Play area background (the inner card play zones)
  playAreaBackground: {
    type: 'color' | 'image';
    color: string;       // CSS color value
    imageUrl: string;    // URL or empty string
  };
  // Playable card highlight color
  playableCardHighlightColor?: string; // Hex color for the green glow on playable cards
  imagePref?: ImagePref;
}

// Default settings with improved contrast
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  tableBackground: {
    type: 'color',
    color: '#0a0a12', // Very dark blue-black
    imageUrl: '',
  },
  playAreaBackground: {
    type: 'color',
    color: '#1a2540', // Dark blue with better contrast
    imageUrl: '',
  },
  playableCardHighlightColor: '#22c55e', // Default green
  imagePref: 'normal',
};

// Preset themes for quick selection
export interface AppearancePreset {
  name: string;
  settings: AppearanceSettings;
}

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  {
    name: 'Classic Dark',
    settings: {
      tableBackground: {
        type: 'color',
        color: '#0a0a12',
        imageUrl: '',
      },
      playAreaBackground: {
        type: 'color',
        color: '#1a2540',
        imageUrl: '',
      },
    },
  },
  {
    name: 'Deep Purple',
    settings: {
      tableBackground: {
        type: 'color',
        color: '#0f0a1a',
        imageUrl: '',
      },
      playAreaBackground: {
        type: 'color',
        color: '#2d1f47',
        imageUrl: '',
      },
    },
  },
  {
    name: 'Forest Green',
    settings: {
      tableBackground: {
        type: 'color',
        color: '#0a1008',
        imageUrl: '',
      },
      playAreaBackground: {
        type: 'color',
        color: '#1a3020',
        imageUrl: '',
      },
    },
  },
  {
    name: 'Crimson Night',
    settings: {
      tableBackground: {
        type: 'color',
        color: '#120808',
        imageUrl: '',
      },
      playAreaBackground: {
        type: 'color',
        color: '#3a1a1a',
        imageUrl: '',
      },
    },
  },
  {
    name: 'Ocean Blue',
    settings: {
      tableBackground: {
        type: 'color',
        color: '#050a14',
        imageUrl: '',
      },
      playAreaBackground: {
        type: 'color',
        color: '#102840',
        imageUrl: '',
      },
    },
  },
  {
    name: 'High Contrast',
    settings: {
      tableBackground: {
        type: 'color',
        color: '#000000',
        imageUrl: '',
      },
      playAreaBackground: {
        type: 'color',
        color: '#2a3a5a',
        imageUrl: '',
      },
    },
  },
];

const STORAGE_KEY = 'mtgedh:appearanceSettings';

/**
 * Load appearance settings from localStorage.
 * Returns default settings if not found or invalid.
 */
export function loadAppearanceSettings(): AppearanceSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate structure
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.tableBackground &&
        parsed.playAreaBackground
      ) {
        return {
          tableBackground: {
            type: parsed.tableBackground.type === 'image' ? 'image' : 'color',
            color: typeof parsed.tableBackground.color === 'string' 
              ? parsed.tableBackground.color 
              : DEFAULT_APPEARANCE_SETTINGS.tableBackground.color,
            imageUrl: typeof parsed.tableBackground.imageUrl === 'string' 
              ? parsed.tableBackground.imageUrl 
              : '',
          },
          playAreaBackground: {
            type: parsed.playAreaBackground.type === 'image' ? 'image' : 'color',
            color: typeof parsed.playAreaBackground.color === 'string' 
              ? parsed.playAreaBackground.color 
              : DEFAULT_APPEARANCE_SETTINGS.playAreaBackground.color,
            imageUrl: typeof parsed.playAreaBackground.imageUrl === 'string' 
              ? parsed.playAreaBackground.imageUrl 
              : '',
          },
          playableCardHighlightColor: typeof parsed.playableCardHighlightColor === 'string'
            ? parsed.playableCardHighlightColor
            : DEFAULT_APPEARANCE_SETTINGS.playableCardHighlightColor,
        };
      }
    }
  } catch (e) {
    console.warn('Failed to load appearance settings from localStorage:', e);
  }
  return { ...DEFAULT_APPEARANCE_SETTINGS };
}

/**
 * Save appearance settings to localStorage.
 */
export function saveAppearanceSettings(settings: AppearanceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save appearance settings to localStorage:', e);
  }
}

/**
 * Generate CSS background style for a background setting.
 */
export function getBackgroundStyle(
  bg: AppearanceSettings['tableBackground'] | AppearanceSettings['playAreaBackground']
): React.CSSProperties {
  if (bg.type === 'image' && bg.imageUrl) {
    return {
      backgroundImage: `url(${bg.imageUrl})`,
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
    };
  }
  return {
    background: bg.color,
  };
}

/**
 * Generate a gradient style for the play area (adds depth effect).
 */
export function getPlayAreaGradientStyle(
  bg: AppearanceSettings['playAreaBackground']
): React.CSSProperties {
  if (bg.type === 'image' && bg.imageUrl) {
    return {
      backgroundImage: `url(${bg.imageUrl})`,
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
    };
  }
  
  // Create a radial gradient for depth effect
  const baseColor = bg.color;
  
  // Parse the color to create lighter/darker variants
  // For simplicity, we'll use the color as the center and darken edges
  return {
    background: `radial-gradient(ellipse at center, ${baseColor} 0%, ${adjustColor(baseColor, -20)} 50%, ${adjustColor(baseColor, -40)} 100%)`,
  };
}

/**
 * Adjust a hex color by a percentage.
 * Positive amount = lighter, negative = darker.
 */
function adjustColor(color: string, amount: number): string {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    
    let r = (num >> 16) + amount;
    let g = ((num >> 8) & 0x00FF) + amount;
    let b = (num & 0x0000FF) + amount;
    
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    
    return '#' + (
      (1 << 24) + (r << 16) + (g << 8) + b
    ).toString(16).slice(1);
  }
  
  // For non-hex colors, return as-is
  return color;
}

/**
 * Determine if a hex color is light (luminance > 0.5).
 * Used for determining text contrast (dark text on light backgrounds).
 */
export function isLightColor(color: string): boolean {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    // Validate hex length - only support 3 or 6 digit hex
    if (hex.length !== 3 && hex.length !== 6) {
      return false;
    }
    const num = parseInt(hex.length === 3 
      ? hex.split('').map(c => c + c).join('') 
      : hex, 16);
    
    // Handle invalid hex values
    if (isNaN(num)) {
      return false;
    }
    
    const r = (num >> 16) & 0xFF;
    const g = (num >> 8) & 0xFF;
    const b = num & 0xFF;
    
    // Calculate relative luminance using sRGB formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }
  
  // Default to dark for non-hex colors
  return false;
}

/**
 * Get appropriate text colors based on a background setting.
 * Returns primary and secondary text colors with good contrast.
 */
export function getTextColorsForBackground(
  bg: AppearanceSettings['tableBackground'] | AppearanceSettings['playAreaBackground']
): { primary: string; secondary: string } {
  // For image backgrounds, always use light text (assumes most images are dark)
  if (bg.type === 'image') {
    return { primary: '#fff', secondary: '#aaa' };
  }
  
  // For color backgrounds, determine based on luminance
  if (isLightColor(bg.color)) {
    return { primary: '#1a1a2e', secondary: '#555' };
  }
  return { primary: '#fff', secondary: '#aaa' };
}

/**
 * Get the playable card highlight box shadow style
 */
export function getPlayableCardHighlight(settings?: AppearanceSettings): string {
  const color: string =
    settings?.playableCardHighlightColor ??
    DEFAULT_APPEARANCE_SETTINGS.playableCardHighlightColor ??
    '#22c55e';
  // Convert hex to rgba for the glow effect
  const rgb = hexToRgb(color);
  if (rgb) {
    return `0 0 8px 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8), 0 0 0 2px ${color}`;
  }
  // Fallback to default green
  return '0 0 8px 3px rgba(34, 197, 94, 0.8), 0 0 0 2px #22c55e';
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}
