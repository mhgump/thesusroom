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
});
