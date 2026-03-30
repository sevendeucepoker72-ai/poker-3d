import { useMemo, forwardRef } from 'react';
import { Text } from '@react-three/drei';
import { CanvasTexture, MeshStandardMaterial } from 'three';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../../utils/cardUtils';

const CARD_W = 0.08;
const CARD_H = 0.112;
const CARD_D = 0.003;

// Red suits get bright red, black suits get near-black
const CARD_SUIT_COLORS = {
  hearts: '#E53935',
  diamonds: '#E53935',
  clubs: '#1a1a1a',
  spades: '#1a1a1a',
};

const Card3D = forwardRef(function Card3D(
  { rank: rankProp, suit: suitProp, card, faceUp = false, position = [0, 0, 0], rotation = [0, 0, 0], randomTilt = false },
  ref
) {
  const rank = card?.rank ?? rankProp;
  const suit = card?.suit ?? suitProp;
  const suitColor = suit ? (CARD_SUIT_COLORS[suit] || SUIT_COLORS[suit]) : '#1a1a1a';
  const symbol = suit ? SUIT_SYMBOLS[suit] : '';

  // Slight random tilt for dealt cards
  const tiltRotation = useMemo(() => {
    if (!randomTilt) return rotation;
    const tiltX = (Math.random() - 0.5) * 0.07; // ~2 degrees
    const tiltZ = (Math.random() - 0.5) * 0.07;
    return [
      (rotation[0] || 0) + tiltX,
      rotation[1] || 0,
      (rotation[2] || 0) + tiltZ,
    ];
  }, [randomTilt, rotation[0], rotation[1], rotation[2]]);

  // Card back diamond pattern using canvas texture
  const backTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');

    // Rich red background
    ctx.fillStyle = '#8B0000';
    ctx.fillRect(0, 0, 128, 180);

    // Diamond pattern
    ctx.fillStyle = '#A50000';
    const size = 12;
    for (let row = 0; row < 20; row++) {
      for (let col = 0; col < 14; col++) {
        const cx = col * size + (row % 2 ? size / 2 : 0);
        const cy = row * size;
        ctx.beginPath();
        ctx.moveTo(cx, cy - size / 2);
        ctx.lineTo(cx + size / 2, cy);
        ctx.moveTo(cx, cy + size / 2);
        ctx.lineTo(cx - size / 2, cy);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Border
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 116, 168);
    ctx.strokeStyle = '#CC0000';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, 108, 160);

    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Card front texture (white with subtle border)
  const frontTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');

    // White face
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, 128, 180);

    // Subtle border
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 120, 172);

    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  const faceMat = useMemo(
    () =>
      new MeshStandardMaterial({
        map: frontTexture,
        roughness: 0.25,
        metalness: 0.05,
      }),
    [frontTexture]
  );

  const backMat = useMemo(
    () =>
      new MeshStandardMaterial({
        map: backTexture,
        roughness: 0.35,
        metalness: 0.05,
      }),
    [backTexture]
  );

  const edgeMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#F5F5F5',
        roughness: 0.5,
      }),
    []
  );

  return (
    <group ref={ref} position={position} rotation={tiltRotation}>
      {/* Shadow plane underneath */}
      <mesh position={[0, -CARD_D / 2 - 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CARD_W * 1.1, CARD_H * 1.1]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} depthWrite={false} />
      </mesh>

      {/* Card body - use RoundedBox for nicer edges */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[CARD_W, CARD_D, CARD_H]} />
        {/* Box faces: +X, -X, +Y (top), -Y (bottom), +Z, -Z */}
        <primitive attach="material-0" object={edgeMat} />
        <primitive attach="material-1" object={edgeMat} />
        {/* Top face = card front when flat on table */}
        {faceUp ? (
          <primitive attach="material-2" object={faceMat} />
        ) : (
          <primitive attach="material-2" object={backMat} />
        )}
        {/* Bottom face */}
        {faceUp ? (
          <primitive attach="material-3" object={backMat} />
        ) : (
          <primitive attach="material-3" object={faceMat} />
        )}
        <primitive attach="material-4" object={edgeMat} />
        <primitive attach="material-5" object={edgeMat} />
      </mesh>

      {/* Card front content (rank + suit) - visible when face up */}
      {faceUp && rank && suit && (
        <group position={[0, CARD_D / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          {/* Large center rank */}
          <Text
            fontSize={0.035}
            color={suitColor}
            anchorX="center"
            anchorY="middle"
            position={[0, 0.016, 0]}
            font={undefined}
            fontWeight="bold"
          >
            {rank}
          </Text>
          {/* Large suit symbol below rank */}
          <Text
            fontSize={0.03}
            color={suitColor}
            anchorX="center"
            anchorY="middle"
            position={[0, -0.016, 0]}
            font={undefined}
          >
            {symbol}
          </Text>
          {/* Small top-left rank */}
          <Text
            fontSize={0.014}
            color={suitColor}
            anchorX="center"
            anchorY="middle"
            position={[-0.025, 0.04, 0]}
            font={undefined}
          >
            {rank}
          </Text>
          {/* Small top-left suit */}
          <Text
            fontSize={0.012}
            color={suitColor}
            anchorX="center"
            anchorY="middle"
            position={[-0.025, 0.03, 0]}
            font={undefined}
          >
            {symbol}
          </Text>
          {/* Small bottom-right rank (upside down) */}
          <group rotation={[0, 0, Math.PI]}>
            <Text
              fontSize={0.014}
              color={suitColor}
              anchorX="center"
              anchorY="middle"
              position={[-0.025, 0.04, 0]}
              font={undefined}
            >
              {rank}
            </Text>
            <Text
              fontSize={0.012}
              color={suitColor}
              anchorX="center"
              anchorY="middle"
              position={[-0.025, 0.03, 0]}
              font={undefined}
            >
              {symbol}
            </Text>
          </group>
        </group>
      )}

      {/* Card back diamond overlay decoration when face down */}
      {!faceUp && (
        <group position={[0, CARD_D / 2 + 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          {/* Small center diamond emblem */}
          <Text
            fontSize={0.025}
            color="#FFD700"
            anchorX="center"
            anchorY="middle"
            position={[0, 0, 0]}
            font={undefined}
          >
            {'\u2666'}
          </Text>
        </group>
      )}
    </group>
  );
});

export default Card3D;
export { CARD_W, CARD_H, CARD_D };
