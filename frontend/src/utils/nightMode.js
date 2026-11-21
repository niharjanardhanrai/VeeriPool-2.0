import { useEffect, useState } from 'react';
import client from '../api/client';

// Whether the night safety rules apply right now — asked of the backend
// (utils/nightMode.js there), so the app and the server always agree,
// including when FORCE_NIGHT_MODE is on for a demo.
export function useNightMode() {
  const [mode, setMode] = useState({ night: false, window: '9 pm–6 am', loaded: false });

  useEffect(() => {
    let cancelled = false;
    client
      .get('/safety/mode')
      .then(({ data }) => !cancelled && setMode({ night: data.night, window: data.window, loaded: true }))
      .catch(() => !cancelled && setMode((m) => ({ ...m, loaded: true })));
    return () => {
      cancelled = true;
    };
  }, []);

  return mode;
}
