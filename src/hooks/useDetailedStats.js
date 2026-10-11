import { useEffect, useState } from 'react';
import { getSocket } from '../services/socketService';

// 2026-10-11 (.online R2 — C10 / APPUI-10). The account's tracked stats for a
// lobby panel: getDetailedStats → detailedStats (answered for an unseated
// socket since R2, from the record loaded out of Postgres).
//
// An answer that says the record is still loading ({ hydrated:false }) is
// asked again a few times instead of being drawn as a row of zeros (the old
// panels showed "PFR 0.0%" as a leak). No answer at all → 'unavailable'
// (an older server answered seated sockets only).

const TIMEOUT_MS = 10000;
const RETRY_MS = 2500;
const MAX_RETRIES = 3;

/** { stats, status: 'loading' | 'ready' | 'unavailable' } */
export function useDetailedStats(enabled = true) {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState(enabled ? 'loading' : 'unavailable');

  useEffect(() => {
    if (!enabled) return undefined;
    const socket = getSocket();
    if (!socket) { setStatus('unavailable'); return undefined; }
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    let retries = 0;
    let retryTimer = null;
    let timeout = null;
    const arm = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => setStatus((s) => (s === 'loading' ? 'unavailable' : s)), TIMEOUT_MS);
    };
    const onStats = (s) => {
      if (!s || typeof s !== 'object') return;
      if (s.hydrated === false) {
        if (retries < MAX_RETRIES) {
          retries += 1;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { arm(); try { socket.emit('getDetailedStats'); } catch { /* ignore */ } }, RETRY_MS);
        } else {
          setStatus((st) => (st === 'ready' ? st : 'unavailable'));
        }
        return;
      }
      clearTimeout(timeout);
      setStats(s);
      setStatus('ready');
    };
    socket.on('detailedStats', onStats);
    socket.emit('getDetailedStats');
    arm();
    return () => {
      clearTimeout(timeout);
      clearTimeout(retryTimer);
      socket.off('detailedStats', onStats);
    };
  }, [enabled]);

  return { stats, status };
}
