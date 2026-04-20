import { createRoot } from 'react-dom/client'
import './index.css'
import './themes.css'
import './mobile.css'
import App from './App.jsx'

// Register the service worker early so push-enrollment UI doesn't race on
// `navigator.serviceWorker.ready`.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')).render(<App />)
