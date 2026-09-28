import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// i18n must be imported before App so translations are ready on first render
import './i18n/index';
import App from './App';
import './styles/globals.css';

// Dark mode is class-based (Settings toggle); start from the OS preference.
if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in DOM');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
