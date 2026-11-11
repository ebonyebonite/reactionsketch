// 設定 (テーマ・文字の大きさ) を最初に反映して、ちらつきを防ぐ
import './editor/prefs';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './editor/coreCommands';
import { registerAutoCommands } from './auto/register';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { boot } from './boot';
import { initPwa } from './pwa';
import './styles.css';

registerAutoCommands();

boot().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  initPwa();
});
