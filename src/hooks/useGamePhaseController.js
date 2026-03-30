import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useTableStore } from '../store/tableStore';

// Phases that auto-advance after animation completes
const ANIMATION_TRANSITIONS = {
  dealing: 'dealt',
  flop: 'flopRevealed',
  turn: 'turnRevealed',
  river: 'riverRevealed',
  gathering: 'idle',
};

// Phases that auto-advance after a timer (no animation)
const TIMED_TRANSITIONS = {
  dealt: { next: 'flop', delay: 1000 },
  showdown: { next: 'gathering', delay: 2000 },
};

// Map server phases to animation phases
const SERVER_PHASE_MAP = {
  PreFlop: 'dealing',
  Flop: 'flop',
  Turn: 'turn',
  River: 'river',
  Showdown: 'showdown',
  HandComplete: 'gathering',
  WaitingForPlayers: 'idle',
};

export default function useGamePhaseController() {
  const phase = useGameStore((s) => s.animationPhase);
  const animationComplete = useGameStore((s) => s.animationComplete);
  const setAnimationPhase = useGameStore((s) => s.setAnimationPhase);
  const setAnimationComplete = useGameStore((s) => s.setAnimationComplete);
  const setPot = useGameStore((s) => s.setPot);
  const timerRef = useRef(null);
  const lastServerPhase = useRef(null);

  // React to server game state phase changes
  const gameState = useTableStore((s) => s.gameState);
  const serverPhase = gameState?.phase;

  useEffect(() => {
    if (!serverPhase || serverPhase === lastServerPhase.current) return;
    lastServerPhase.current = serverPhase;

    const animPhase = SERVER_PHASE_MAP[serverPhase];
    if (animPhase && animPhase !== phase) {
      setAnimationComplete(false);
      setAnimationPhase(animPhase);
    }

    // Update pot from server
    if (gameState?.pot !== undefined) {
      setPot(gameState.pot);
    }
  }, [serverPhase, gameState, phase, setAnimationPhase, setAnimationComplete, setPot]);

  // Handle animation-driven transitions
  useEffect(() => {
    if (!animationComplete) return;
    const nextPhase = ANIMATION_TRANSITIONS[phase];
    if (!nextPhase) return;

    // When gathering completes, update pot from server if available
    if (phase === 'gathering') {
      const serverState = useTableStore.getState().gameState;
      if (serverState?.pot !== undefined) {
        setPot(serverState.pot);
      } else {
        const currentPot = useGameStore.getState().pot;
        setPot(currentPot + 500);
      }
    }

    setAnimationComplete(false);
    setAnimationPhase(nextPhase);
  }, [animationComplete, phase, setAnimationPhase, setAnimationComplete, setPot]);

  // Handle timer-driven transitions (phases without animations)
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const timed = TIMED_TRANSITIONS[phase];
    if (!timed) return;

    // When connected to server, skip auto-advance for dealt phase
    // (server controls the pace)
    const serverState = useTableStore.getState().gameState;
    if (serverState && phase === 'dealt') {
      // Don't auto-advance; wait for server phase change
      return;
    }

    timerRef.current = setTimeout(() => {
      setAnimationComplete(false);
      setAnimationPhase(timed.next);
    }, timed.delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, setAnimationPhase, setAnimationComplete]);

  // User action handlers (kept for backward compatibility)
  const advanceFromBetting = () => {
    const transitions = {
      flopRevealed: 'turn',
      turnRevealed: 'river',
      riverRevealed: 'showdown',
    };
    const next = transitions[phase];
    if (next) {
      setAnimationComplete(false);
      setAnimationPhase(next);
    }
  };

  const startNewRound = () => {
    // Try server first
    const tableStore = useTableStore.getState();
    if (tableStore.gameState) {
      tableStore.startHand();
    } else {
      useGameStore.getState().startRound();
    }
  };

  return { advanceFromBetting, startNewRound, phase };
}
