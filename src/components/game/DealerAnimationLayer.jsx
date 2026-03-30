import { useState, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import Card3D from './Card3D';
import useDealerAnimations from '../../hooks/useDealerAnimations';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { SUIT_INDEX_TO_NAME, serverRankDisplay } from '../../utils/cardUtils';

export default function DealerAnimationLayer({ seatPositions }) {
  const { getCardRenderData, getChipRenderData } = useDealerAnimations(seatPositions);
  const [cards, setCards] = useState([]);
  const [chips, setChips] = useState([]);
  const frameCount = useRef(0);

  // Sync render data from animation hook every 2 frames for performance
  useFrame(() => {
    frameCount.current++;
    if (frameCount.current % 2 !== 0) return;

    const cardData = getCardRenderData();
    const chipData = getChipRenderData();

    // Only update state if we have animated objects
    if (cardData.length > 0 || cards.length > 0) {
      setCards(cardData);
    }
    if (chipData.length > 0 || chips.length > 0) {
      setChips(chipData);
    }
  });

  return (
    <group>
      {/* Animated cards in flight */}
      {cards.map((card) =>
        card.visible ? (
          <Card3D
            key={card.id}
            rank={card.rank}
            suit={card.suit}
            faceUp={card.faceUp}
            position={card.position}
          />
        ) : null
      )}

      {/* Animated chip stacks */}
      {chips.map((chip) =>
        chip.visible ? (
          <group key={chip.id} position={chip.position}>
            {Array.from({ length: chip.count }, (_, j) => (
              <mesh key={j} position={[0, j * 0.012, 0]}>
                <cylinderGeometry args={[0.025, 0.025, 0.01, 16]} />
                <meshStandardMaterial color={chip.color} metalness={0.2} roughness={0.4} />
              </mesh>
            ))}
          </group>
        ) : null
      )}

      {/* Settled community cards */}
      <SettledCommunityCards />
    </group>
  );
}

function SettledCommunityCards() {
  const localCommunityCards = useGameStore((s) => s.communityCards);
  const serverCommunityCards = useTableStore((s) => s.gameState)?.communityCards || [];
  const gap = 0.1;
  const startX = -2 * gap;

  // Use server community cards if available, converting suit/rank numbers to strings
  if (serverCommunityCards.length > 0) {
    // Server cards have { suit: number, rank: number }
    // Card3D expects string suit names and string ranks
    return (
      <group>
        {serverCommunityCards.map((card, i) => {
          if (!card) return null;
          return (
            <Card3D
              key={`community-${i}`}
              rank={serverRankDisplay(card.rank)}
              suit={SUIT_INDEX_TO_NAME[card.suit] || 'spades'}
              faceUp={true}
              position={[startX + i * gap, 0.49, 0]}
            />
          );
        })}
      </group>
    );
  }

  // Fallback to local community cards
  return (
    <group>
      {localCommunityCards.map((card, i) => {
        if (!card) return null;
        return (
          <Card3D
            key={`community-${i}`}
            rank={card.rank}
            suit={card.suit}
            faceUp={true}
            position={[startX + i * gap, 0.49, 0]}
          />
        );
      })}
    </group>
  );
}
