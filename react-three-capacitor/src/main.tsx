import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPhysics } from './game/World';

// THREE.Clock deprecation warning comes from @react-three/fiber internals; suppress until r3f updates.
const _warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('THREE.Clock')) return;
  _warn(...args);
};

initPhysics().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}).catch((err) => {
  console.error('initPhysics failed:', err);
  const root = document.getElementById('root')!;
  root.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#fff;font-family:sans-serif;font-size:14px;padding:20px;text-align:center;';
  root.textContent = `Failed to start: ${err?.message ?? err}`;
});
