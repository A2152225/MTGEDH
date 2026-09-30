import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastHost } from './components/ToastHost';
import { KeyboardShortcutsOverlay } from './components/KeyboardShortcutsOverlay';
import { ReportIssueHost } from './components/ReportIssueHost';
import { useIsTouch, useTouchBodyClass } from './hooks/useIsTouch';
import { useOrientationBodyClass } from './hooks/useMobilePlayLayout';

const Root: React.FC = () => {
  // Adds `body.touch` when on a coarse-pointer device. CSS in index.html and
  // future component-level CSS can use this to gate touch-only styling.
  useTouchBodyClass();
  useOrientationBodyClass();
  const isTouch = useIsTouch();
  return (
    <>
      <App />
      <ToastHost position={isTouch ? 'top-right' : 'bottom-right'} />
      <KeyboardShortcutsOverlay />
      <ReportIssueHost />
    </>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Root />);