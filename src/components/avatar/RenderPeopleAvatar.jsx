import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { TextureLoader, SRGBColorSpace, MeshStandardMaterial } from 'three';

// Available RenderPeople models
const MODELS = {
  eric: {
    glb: '/models/eric.glb',
    diffuse: '/models/textures/eric_dif.jpg',
    normal: '/models/textures/eric_norm.jpg',
  },
  carla: {
    glb: '/models/carla.glb',
    diffuse: '/models/textures/carla_dif.jpg',
    normal: '/models/textures/carla_norm.jpg',
  },
  claudia: {
    glb: '/models/claudia.glb',
    diffuse: '/models/textures/claudia_dif.jpg',
    normal: '/models/textures/claudia_norm.jpg',
  },
};

// RenderPeople models are ~180 units tall (centimeters).
// Our scene avatars are ~1.1 units tall (meters).
// Scale: 1.1 / 180 ≈ 0.006, but we want upper body visible above table (waist-up ≈ 0.6m)
// The models are standing — we position them so their waist is at table height
const MODEL_SCALE = 0.0018;
const WAIST_OFFSET = -0.12; // Push model down so waist aligns with chair seat

export default function RenderPeopleAvatar({
  modelId = 'eric',
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}) {
  const groupRef = useRef();
  const idleTime = useRef(Math.random() * Math.PI * 2);
  const model = MODELS[modelId];

  const { scene } = useGLTF(model.glb);

  // Load textures
  const diffuseMap = useLoader(TextureLoader, model.diffuse);
  const normalMap = useLoader(TextureLoader, model.normal);

  // Configure textures
  useEffect(() => {
    if (diffuseMap) {
      diffuseMap.flipY = false;
      diffuseMap.colorSpace = SRGBColorSpace;
    }
    if (normalMap) {
      normalMap.flipY = false;
    }
  }, [diffuseMap, normalMap]);

  // Clone the scene so each instance is independent
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);

    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        const mat = new MeshStandardMaterial({
          map: diffuseMap,
          normalMap: normalMap,
          roughness: 0.6,
          metalness: 0.05,
        });
        child.material = mat;
      }
    });

    return clone;
  }, [scene, diffuseMap, normalMap]);

  // Subtle idle breathing animation
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    idleTime.current += delta;
    groupRef.current.position.y = position[1] + WAIST_OFFSET + Math.sin(idleTime.current * 1.5) * 0.003;
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <primitive object={clonedScene} scale={MODEL_SCALE} />
    </group>
  );
}

// Preload all models
Object.values(MODELS).forEach(({ glb }) => useGLTF.preload(glb));

export { MODELS };
