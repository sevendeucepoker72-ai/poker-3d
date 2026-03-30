import { useRef, useEffect, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useGameStore } from '../store/gameStore';
import { DEALER_POSITION } from '../components/avatar/DealerAvatar';
import { createDeck, shuffleDeck, dealFromDeck } from '../utils/cardUtils';

// Easing function: ease-out cubic
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Arc height for card toss
function arcOffset(t, height = 0.15) {
  return 4 * t * (1 - t) * height;
}

const DEAL_CARD_DURATION = 0.35; // seconds per card flight
const DEAL_STAGGER = 0.15; // seconds between each card
const COMMUNITY_CARD_DURATION = 0.4;
const COMMUNITY_STAGGER = 0.2;
const FLIP_DURATION = 0.3;
const GATHER_DURATION = 0.6;
const COMMUNITY_Y = 0.49;
const COMMUNITY_GAP = 0.1;
const COMMUNITY_START_X = -2 * COMMUNITY_GAP;

// Dealer hand position (where cards originate)
const DEALER_HAND = new Vector3(
  DEALER_POSITION[0],
  0.55,
  DEALER_POSITION[2] + 0.3
);

export default function useDealerAnimations(seatPositions) {
  const phase = useGameStore((s) => s.animationPhase);
  const seats = useGameStore((s) => s.seats);
  const setAnimationComplete = useGameStore((s) => s.setAnimationComplete);
  const setCommunityCards = useGameStore((s) => s.setCommunityCards);
  const setSeatCards = useGameStore((s) => s.setSeatCards);
  const setDeck = useGameStore((s) => s.setDeck);
  const setPot = useGameStore((s) => s.setPot);
  const setSeatBet = useGameStore((s) => s.setSeatBet);
  const clearSeatBets = useGameStore((s) => s.clearSeatBets);

  // Animation state refs (don't trigger re-renders)
  const animCards = useRef([]); // { id, start, end, startTime, duration, faceUp, rank, suit, progress, settled }
  const animChips = useRef([]); // { id, start, end, startTime, duration, color, count, progress, settled }
  const communityCardRefs = useRef([]); // settled community cards { rank, suit, position, faceUp }
  const elapsed = useRef(0);
  const phaseInitialized = useRef('');
  const deckRef = useRef([]);

  // Get occupied seat indices
  const getOccupiedSeats = useCallback(() => {
    const occupied = [];
    for (let i = 0; i < seats.length; i++) {
      if (seats[i]) occupied.push(i);
    }
    return occupied;
  }, [seats]);

  // Initialize phase
  useEffect(() => {
    if (phase === phaseInitialized.current) return;
    phaseInitialized.current = phase;
    elapsed.current = 0;
    animCards.current = [];
    animChips.current = [];

    if (phase === 'dealing') {
      // Create and shuffle deck
      const deck = shuffleDeck(createDeck());
      deckRef.current = deck;

      const occupied = getOccupiedSeats();
      let cardIndex = 0;
      const allDealtCards = {};

      // Deal 2 cards to each player (round 1 then round 2)
      for (let round = 0; round < 2; round++) {
        for (let p = 0; p < occupied.length; p++) {
          const seatIdx = occupied[p];
          const seat = seatPositions[seatIdx];
          const targetX = seat.pos[0] * 0.82;
          const targetZ = seat.pos[2] * 0.82;

          const card = deck[cardIndex];
          if (!allDealtCards[seatIdx]) allDealtCards[seatIdx] = [];
          allDealtCards[seatIdx].push(card);

          animCards.current.push({
            id: `deal-${seatIdx}-${round}`,
            start: DEALER_HAND.clone(),
            end: new Vector3(targetX + (round * 0.05 - 0.025), COMMUNITY_Y, targetZ),
            startTime: cardIndex * DEAL_STAGGER,
            duration: DEAL_CARD_DURATION,
            faceUp: false,
            rank: card.rank,
            suit: card.suit,
            progress: 0,
            settled: false,
            seatIndex: seatIdx,
          });
          cardIndex++;
        }
      }

      // Store dealt cards in state
      for (const [seatIdx, cards] of Object.entries(allDealtCards)) {
        setSeatCards(parseInt(seatIdx), cards);
      }
      // Save remaining deck
      deckRef.current = deck.slice(cardIndex);
      setDeck(deckRef.current);

    } else if (phase === 'flop') {
      const deck = deckRef.current;
      // Burn 1, deal 3
      const flopCards = deck.slice(1, 4);
      deckRef.current = deck.slice(4);
      setDeck(deckRef.current);

      flopCards.forEach((card, i) => {
        animCards.current.push({
          id: `flop-${i}`,
          start: DEALER_HAND.clone(),
          end: new Vector3(COMMUNITY_START_X + i * COMMUNITY_GAP, COMMUNITY_Y, 0),
          startTime: i * COMMUNITY_STAGGER,
          duration: COMMUNITY_CARD_DURATION,
          faceUp: false,
          flipAfter: true,
          flipStartTime: null,
          rank: card.rank,
          suit: card.suit,
          progress: 0,
          settled: false,
          communityIndex: i,
        });
      });

    } else if (phase === 'turn') {
      const deck = deckRef.current;
      // Burn 1, deal 1
      const turnCard = deck[1];
      deckRef.current = deck.slice(2);
      setDeck(deckRef.current);

      animCards.current.push({
        id: 'turn-0',
        start: DEALER_HAND.clone(),
        end: new Vector3(COMMUNITY_START_X + 3 * COMMUNITY_GAP, COMMUNITY_Y, 0),
        startTime: 0,
        duration: COMMUNITY_CARD_DURATION,
        faceUp: false,
        flipAfter: true,
        flipStartTime: null,
        rank: turnCard.rank,
        suit: turnCard.suit,
        progress: 0,
        settled: false,
        communityIndex: 3,
      });

    } else if (phase === 'river') {
      const deck = deckRef.current;
      // Burn 1, deal 1
      const riverCard = deck[1];
      deckRef.current = deck.slice(2);
      setDeck(deckRef.current);

      animCards.current.push({
        id: 'river-0',
        start: DEALER_HAND.clone(),
        end: new Vector3(COMMUNITY_START_X + 4 * COMMUNITY_GAP, COMMUNITY_Y, 0),
        startTime: 0,
        duration: COMMUNITY_CARD_DURATION,
        faceUp: false,
        flipAfter: true,
        flipStartTime: null,
        rank: riverCard.rank,
        suit: riverCard.suit,
        progress: 0,
        settled: false,
        communityIndex: 4,
      });

    } else if (phase === 'gathering') {
      const occupied = getOccupiedSeats();
      // Simulate bets from random players
      occupied.forEach((seatIdx, i) => {
        const seat = seatPositions[seatIdx];
        const chipX = seat.pos[0] * 0.65;
        const chipZ = seat.pos[2] * 0.65;

        animChips.current.push({
          id: `gather-${seatIdx}`,
          start: new Vector3(chipX, 0.48, chipZ),
          end: new Vector3(0, 0.48, 0),
          startTime: i * 0.1,
          duration: GATHER_DURATION,
          color: ['#E63946', '#457B9D', '#FFD700', '#4ADE80'][i % 4],
          count: 3 + Math.floor(Math.random() * 4),
          progress: 0,
          settled: false,
        });
      });

    } else if (phase === 'idle') {
      // Clear everything
      animCards.current = [];
      animChips.current = [];
      communityCardRefs.current = [];
    }
  }, [phase, seats, seatPositions, getOccupiedSeats, setSeatCards, setDeck, setCommunityCards, setPot, setSeatBet, clearSeatBets, setAnimationComplete]);

  // Animation frame update
  useFrame((_, delta) => {
    if (phase === 'idle') return;

    elapsed.current += delta;
    const t = elapsed.current;
    let allDone = true;

    // Update card animations
    for (const card of animCards.current) {
      if (card.settled) continue;

      const localT = (t - card.startTime) / card.duration;
      if (localT < 0) {
        allDone = false;
        continue;
      }

      if (localT >= 1) {
        card.progress = 1;

        // Handle flip after arrival for community cards
        if (card.flipAfter && !card.faceUp) {
          if (!card.flipStartTime) {
            card.flipStartTime = t;
          }
          const flipT = (t - card.flipStartTime) / FLIP_DURATION;
          if (flipT >= 1) {
            card.faceUp = true;
            card.settled = true;
            // Add to settled community cards
            if (card.communityIndex !== undefined) {
              const prev = useGameStore.getState().communityCards;
              const updated = [...prev];
              updated[card.communityIndex] = { rank: card.rank, suit: card.suit };
              setCommunityCards(updated);
            }
          } else {
            allDone = false;
          }
        } else {
          card.settled = true;
        }
      } else {
        card.progress = easeOutCubic(Math.min(localT, 1));
        allDone = false;
      }
    }

    // Update chip animations
    for (const chip of animChips.current) {
      if (chip.settled) continue;

      const localT = (t - chip.startTime) / chip.duration;
      if (localT < 0) {
        allDone = false;
        continue;
      }

      if (localT >= 1) {
        chip.progress = 1;
        chip.settled = true;
      } else {
        chip.progress = easeOutCubic(Math.min(localT, 1));
        allDone = false;
      }
    }

    if (allDone && (animCards.current.length > 0 || animChips.current.length > 0)) {
      setAnimationComplete(true);
    }
  });

  // Compute current positions for rendering
  const getCardRenderData = useCallback(() => {
    return animCards.current.map((card) => {
      const p = card.progress;
      const pos = new Vector3().lerpVectors(card.start, card.end, p);
      // Add arc
      pos.y += arcOffset(p, 0.15);

      return {
        id: card.id,
        rank: card.rank,
        suit: card.suit,
        faceUp: card.faceUp,
        position: [pos.x, pos.y, pos.z],
        visible: (elapsed.current >= card.startTime),
      };
    });
  }, []);

  const getChipRenderData = useCallback(() => {
    return animChips.current.map((chip) => {
      const p = chip.progress;
      const pos = new Vector3().lerpVectors(chip.start, chip.end, p);

      return {
        id: chip.id,
        color: chip.color,
        count: chip.count,
        position: [pos.x, pos.y, pos.z],
        visible: (elapsed.current >= chip.startTime),
      };
    });
  }, []);

  return { getCardRenderData, getChipRenderData };
}
