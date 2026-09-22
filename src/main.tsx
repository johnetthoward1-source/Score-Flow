import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Intercept benign Vite HMR WebSocket closure in development (HMR is disabled in cloud containers)
if (typeof window !== 'undefined') {
  const isViteHmrError = (msg: string) =>
    msg.includes('WebSocket closed without opened') ||
    msg.includes('failed to connect to websocket') ||
    msg.includes('[vite]');

  window.addEventListener('unhandledrejection', (event) => {
    const msg = event?.reason?.message || String(event?.reason || '');
    if (isViteHmrError(msg)) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event?.message || String(event?.error?.message || '');
    if (isViteHmrError(msg)) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  });

  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const fullMsg = args.map((a) => (typeof a === 'string' ? a : a?.message || '')).join(' ');
    if (isViteHmrError(fullMsg)) {
      return; // Ignore benign Vite HMR reconnection attempts
    }
    originalConsoleError.apply(console, args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
