// Explicit staging opt-in; set VITE_APP_CINEMATIC=1 at build time.
import APP_ART_VERSIONS from 'virtual:app-art-versions';

export const cinematicEnabled = import.meta.env.VITE_APP_CINEMATIC === '1';
// (?v=<content hash>: the host keeps /cinematic/ art for a year, so a changed
// picture needs a new URL; see vite.config.js appArtCacheBust)
export const cinematicAsset = (name) => `${import.meta.env.BASE_URL}cinematic/${name}${APP_ART_VERSIONS[name] ? `?v=${APP_ART_VERSIONS[name]}` : ''}`;

// APP Precision: the skin's two display faces (Exo 2 for the HUD, Playfair
// Display for the hero name), loaded only when the skin is on. The CSP already
// allows fonts.googleapis.com / fonts.gstatic.com (index.html loads Inter there).
const APP_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,500;0,600;0,700;0,800;0,900;1,400;1,600;1,700;1,800;1,900&family=Playfair+Display:ital,wght@0,800;1,800&display=swap';
if (cinematicEnabled && typeof document !== 'undefined' && !document.getElementById('app-precision-fonts')) {
  try {
    const link = document.createElement('link');
    link.id = 'app-precision-fonts';
    link.rel = 'stylesheet';
    link.href = APP_FONTS_HREF;
    document.head.appendChild(link);
  } catch { /* the system fonts in the CSS stack stand in */ }
}
