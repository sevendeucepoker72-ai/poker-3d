import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import AvatarModel from '../avatar/AvatarModel';
import { useGameStore } from '../../store/gameStore';
import {
  BODY_TYPES, SKIN_TONES, HAIR_STYLES, HAIR_COLORS,
  EYE_COLORS, TOP_STYLES, TOP_COLORS, BOTTOM_STYLES,
  BOTTOM_COLORS, ACCESSORIES, FACE_SLIDERS,
} from '../../utils/avatarConfig';
import './AvatarCustomizer.css';

export default function AvatarCustomizer() {
  const avatar = useGameStore((s) => s.avatar);
  const updateAvatar = useGameStore((s) => s.updateAvatar);
  const updateFaceShape = useGameStore((s) => s.updateFaceShape);
  const resetAvatar = useGameStore((s) => s.resetAvatar);
  const setScreen = useGameStore((s) => s.setScreen);

  return (
    <div className="customizer">
      {/* 3D Preview */}
      <div className="customizer-preview">
        <Canvas shadows>
          <PerspectiveCamera makeDefault position={[0, 1, 2]} fov={35} />
          <OrbitControls
            target={[0, 0.7, 0]}
            minDistance={1}
            maxDistance={4}
            enablePan={false}
          />
          <ambientLight intensity={0.5} />
          <pointLight position={[2, 3, 2]} intensity={20} />
          <pointLight position={[-2, 2, -1]} intensity={10} color="#4A90D9" />
          <AvatarModel config={avatar} position={[0, 0, 0]} />
          <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.5, 32]} />
            <meshStandardMaterial color="#1A1A2E" />
          </mesh>
        </Canvas>
      </div>

      {/* Controls Panel */}
      <div className="customizer-panel">
        <h2>Create Your Avatar</h2>

        {/* Body Type */}
        <Section title="Body Type">
          <div className="option-grid">
            {BODY_TYPES.map((bt) => (
              <button
                key={bt.id}
                className={`option-btn ${avatar.bodyType === bt.id ? 'active' : ''}`}
                onClick={() => updateAvatar('bodyType', bt.id)}
              >
                {bt.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Skin Tone */}
        <Section title="Skin Tone">
          <div className="color-row">
            {SKIN_TONES.map((color) => (
              <button
                key={color}
                className={`color-swatch ${avatar.skinTone === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => updateAvatar('skinTone', color)}
              />
            ))}
          </div>
        </Section>

        {/* Face Shape */}
        <Section title="Face Shape">
          {FACE_SLIDERS.map((slider) => (
            <div key={slider.id} className="slider-row">
              <label>{slider.label}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={avatar.faceShape[slider.id]}
                onChange={(e) => updateFaceShape(slider.id, parseFloat(e.target.value))}
              />
            </div>
          ))}
        </Section>

        {/* Hair */}
        <Section title="Hair Style">
          <div className="option-grid">
            {HAIR_STYLES.map((h) => (
              <button
                key={h.id}
                className={`option-btn ${avatar.hairStyle === h.id ? 'active' : ''}`}
                onClick={() => updateAvatar('hairStyle', h.id)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Hair Color">
          <div className="color-row">
            {HAIR_COLORS.map((color) => (
              <button
                key={color}
                className={`color-swatch ${avatar.hairColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => updateAvatar('hairColor', color)}
              />
            ))}
          </div>
        </Section>

        {/* Eyes */}
        <Section title="Eye Color">
          <div className="color-row">
            {EYE_COLORS.map((color) => (
              <button
                key={color}
                className={`color-swatch ${avatar.eyeColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => updateAvatar('eyeColor', color)}
              />
            ))}
          </div>
        </Section>

        {/* Clothing - Top */}
        <Section title="Top">
          <div className="option-grid">
            {TOP_STYLES.map((t) => (
              <button
                key={t.id}
                className={`option-btn ${avatar.topStyle === t.id ? 'active' : ''}`}
                onClick={() => updateAvatar('topStyle', t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="color-row" style={{ marginTop: 8 }}>
            {TOP_COLORS.map((color) => (
              <button
                key={color}
                className={`color-swatch ${avatar.topColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => updateAvatar('topColor', color)}
              />
            ))}
          </div>
        </Section>

        {/* Clothing - Bottom */}
        <Section title="Bottom">
          <div className="option-grid">
            {BOTTOM_STYLES.map((b) => (
              <button
                key={b.id}
                className={`option-btn ${avatar.bottomStyle === b.id ? 'active' : ''}`}
                onClick={() => updateAvatar('bottomStyle', b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="color-row" style={{ marginTop: 8 }}>
            {BOTTOM_COLORS.map((color) => (
              <button
                key={color}
                className={`color-swatch ${avatar.bottomColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => updateAvatar('bottomColor', color)}
              />
            ))}
          </div>
        </Section>

        {/* Accessories */}
        <Section title="Accessories">
          <div className="option-grid">
            {ACCESSORIES.map((a) => (
              <button
                key={a.id}
                className={`option-btn ${avatar.accessory === a.id ? 'active' : ''}`}
                onClick={() => updateAvatar('accessory', a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Actions */}
        <div className="customizer-actions">
          <button className="btn-secondary" onClick={resetAvatar}>
            Reset
          </button>
          <button className="btn-primary" onClick={() => setScreen('table')}>
            Join Table
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
