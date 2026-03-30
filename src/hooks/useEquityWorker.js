import { useRef, useCallback, useEffect } from 'react';

/**
 * Hook that exposes an async calculateEquity function backed by a Web Worker.
 * The worker is created lazily on first use and reused across calls.
 *
 * calculateEquity signature mirrors simulateEquity from equitySimulator.js:
 *   calculateEquity(playerHands, communityCards, deckRemaining, iterations?)
 *
 * Returns a Promise that resolves to { playerEquities: number[] }.
 */
export function useEquityWorker() {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());

  function getWorker() {
    if (!workerRef.current) {
      workerRef.current = new Worker('/equityWorker.js');
      workerRef.current.onmessage = (e) => {
        const { id, result, error } = e.data;
        const callbacks = pendingRef.current.get(id);
        if (callbacks) {
          pendingRef.current.delete(id);
          if (error) {
            callbacks.reject(new Error(error));
          } else {
            callbacks.resolve(result);
          }
        }
      };
      workerRef.current.onerror = (err) => {
        // Reject all pending promises on a worker-level error
        for (const [id, callbacks] of pendingRef.current.entries()) {
          callbacks.reject(err);
          pendingRef.current.delete(id);
        }
      };
    }
    return workerRef.current;
  }

  const calculateEquity = useCallback(
    (playerHands, communityCards, deckRemaining, iterations = 1000) => {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        pendingRef.current.set(id, { resolve, reject });
        getWorker().postMessage({ id, playerHands, communityCards, deckRemaining, iterations });
      });
    },
    []
  );

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  return { calculateEquity };
}
