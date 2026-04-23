import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPhysics } from './game/World';

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
