/**
 * ColorPicker.tsx
 * 
 * A custom color picker with hue and saturation/lightness controls.
 * Provides a visual way to select colors using HSL color space.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ColorPickerProps {
  value: string; // Hex color value
  onChange: (color: string) => void;
}

// Convert HSL to Hex
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Convert Hex to HSL
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  // Remove # if present
  hex = hex.replace(/^#/, '');
  
  // Handle short hex
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  
  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Validate hex color
function isValidHex(hex: string): boolean {
  return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  // Parse initial value to HSL
  const initialHsl = isValidHex(value) ? hexToHsl(value) : { h: 220, s: 50, l: 20 };
  
  const [hue, setHue] = useState(initialHsl.h);
  const [saturation, setSaturation] = useState(initialHsl.s);
  const [lightness, setLightness] = useState(initialHsl.l);
  const [hexInput, setHexInput] = useState(value);
  
  const satLightRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const isDraggingSatLight = useRef(false);
  const isDraggingHue = useRef(false);
  
  // Update hex input when value prop changes
  useEffect(() => {
    if (isValidHex(value)) {
      setHexInput(value);
      const hsl = hexToHsl(value);
      setHue(hsl.h);
      setSaturation(hsl.s);
      setLightness(hsl.l);
    }
  }, [value]);
  
  // Update parent when HSL changes
  const updateColor = useCallback((h: number, s: number, l: number) => {
    const hex = hslToHex(h, s, l);
    setHexInput(hex);
    onChange(hex);
  }, [onChange]);
  
  // Handle saturation/lightness picker drag
  const handleSatLightMove = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!satLightRef.current) return;
    
    const rect = satLightRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    
    // X axis = saturation (0-100)
    // Y axis = lightness (100-0, inverted)
    const newSat = Math.round(x * 100);
    const newLight = Math.round((1 - y) * 100);
    
    setSaturation(newSat);
    setLightness(newLight);
    updateColor(hue, newSat, newLight);
  }, [hue, updateColor]);
  
  // Handle hue slider drag
  const handleHueMove = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!hueRef.current) return;
    
    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newHue = Math.round(x * 360);
    
    setHue(newHue);
    updateColor(newHue, saturation, lightness);
  }, [saturation, lightness, updateColor]);
  
  // Mouse event handlers for saturation/lightness
  const handleSatLightMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingSatLight.current = true;
    handleSatLightMove(e);
    
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSatLight.current) {
        handleSatLightMove(e);
      }
    };
    
    const handleMouseUp = () => {
      isDraggingSatLight.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [handleSatLightMove]);
  
  // Mouse event handlers for hue
  const handleHueMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingHue.current = true;
    handleHueMove(e);
    
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingHue.current) {
        handleHueMove(e);
      }
    };
    
    const handleMouseUp = () => {
      isDraggingHue.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [handleHueMove]);
  
  // Handle hex input change
  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setHexInput(newValue);
    
    // Only update if valid hex
    const hex = newValue.startsWith('#') ? newValue : `#${newValue}`;
    if (isValidHex(hex)) {
      const hsl = hexToHsl(hex);
      setHue(hsl.h);
      setSaturation(hsl.s);
      setLightness(hsl.l);
      onChange(hex);
    }
  };
  
  // Calculate picker positions
  const satLightX = saturation;
  const satLightY = 100 - lightness;
  const hueX = (hue / 360) * 100;
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Saturation/Lightness picker */}
      <div
        ref={satLightRef}
        onMouseDown={handleSatLightMouseDown}
        style={{
          width: '100%',
          height: 120,
          borderRadius: 6,
          cursor: 'crosshair',
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          // Background: base hue color with white overlay from left and black from bottom
          background: `
            linear-gradient(to top, #000, transparent),
            linear-gradient(to right, #fff, transparent),
            hsl(${hue}, 100%, 50%)
          `,
        }}
      >
        {/* Picker indicator */}
        <div
          style={{
            position: 'absolute',
            left: `${satLightX}%`,
            top: `${satLightY}%`,
            transform: 'translate(-50%, -50%)',
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.3)',
            background: hslToHex(hue, saturation, lightness),
            pointerEvents: 'none',
          }}
        />
      </div>
      
      {/* Hue slider */}
      <div
        ref={hueRef}
        onMouseDown={handleHueMouseDown}
        style={{
          width: '100%',
          height: 16,
          borderRadius: 8,
          cursor: 'pointer',
          position: 'relative',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          background: `linear-gradient(to right, 
            hsl(0, 100%, 50%),
            hsl(60, 100%, 50%),
            hsl(120, 100%, 50%),
            hsl(180, 100%, 50%),
            hsl(240, 100%, 50%),
            hsl(300, 100%, 50%),
            hsl(360, 100%, 50%)
          )`,
        }}
      >
        {/* Hue indicator */}
        <div
          style={{
            position: 'absolute',
            left: `${hueX}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 8,
            height: 18,
            borderRadius: 4,
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
            background: `hsl(${hue}, 100%, 50%)`,
            pointerEvents: 'none',
          }}
        />
      </div>
      
      {/* Color preview and hex input */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 6,
            background: hslToHex(hue, saturation, lightness),
            border: '2px solid rgba(255, 255, 255, 0.3)',
            flexShrink: 0,
          }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={handleHexInputChange}
          placeholder="#1a2540"
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid rgba(255, 255, 255, 0.2)',
            background: 'rgba(0, 0, 0, 0.4)',
            color: '#fff',
            fontFamily: 'monospace',
          }}
        />
        {/* Native color input for fallback/accessibility */}
        <input
          type="color"
          value={hslToHex(hue, saturation, lightness)}
          onChange={(e) => {
            const hex = e.target.value;
            const hsl = hexToHsl(hex);
            setHue(hsl.h);
            setSaturation(hsl.s);
            setLightness(hsl.l);
            setHexInput(hex);
            onChange(hex);
          }}
          style={{
            width: 32,
            height: 32,
            padding: 0,
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title="System color picker"
        />
      </div>
      
      {/* HSL values display */}
      <div style={{ 
        display: 'flex', 
        gap: 8, 
        fontSize: 10, 
        color: '#888',
        justifyContent: 'center',
      }}>
        <span>H: {hue}°</span>
        <span>S: {saturation}%</span>
        <span>L: {lightness}%</span>
      </div>
    </div>
  );
}

export default ColorPicker;
