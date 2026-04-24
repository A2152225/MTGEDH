import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastHost } from './components/ToastHost';
import { KeyboardShortcutsOverlay } from './components/KeyboardShortcutsOverlay';
import { useTouchBodyClass } from './hooks/useIsTouch';

const Root: React.FC = () => {
  // Adds `body.touch` when on a coarse-pointer device. CSS in index.html and
  // future component-level CSS can use this to gate touch-only styling.
  useTouchBodyClass();
  return (
    <>
      <App />
      <ToastHost position="bottom-right" />
      <KeyboardShortcutsOverlay />
    </>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Root />);