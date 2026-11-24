// Explicit staging opt-in; set VITE_APP_CINEMATIC=1 at build time.
export const cinematicEnabled = import.meta.env.VITE_APP_CINEMATIC === '1';
export const cinematicAsset = (name) => `${import.meta.env.BASE_URL}cinematic/${name}`;
