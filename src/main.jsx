import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './app/store';
import App from './App';
// шрифты лежат внутри приложения — работает без интернета (лицензия SIL OFL)
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/index.css';

// любые необработанные ошибки окна — в журнал приложения
const log = (m) => { try { window.mimis?.logError?.(String(m)); } catch { /* */ } };
window.addEventListener('error', (e) => log(e.error?.stack || e.message));
window.addEventListener('unhandledrejection', (e) => log(e.reason?.stack || e.reason));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
);
