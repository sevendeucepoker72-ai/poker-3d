import { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import AvatarModel from '../avatar/AvatarModel';
import { useGameStore } from '../../store/gameStore';
import {
  BODY_TYPES, SKIN_TONES, HAIR_STYLES, HAIR_COLORS,
  EYE_COLORS, TOP_STYLES, TOP_COLORS, BOTTOM_STYLES,
  BOTTOM_COLORS, ACCESSORIES, FACE_SLIDERS,
} from '../../utils/avatarConfig';
import { getAuthToken } from '../../services/tokenStorage';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { API_BASE as MASTER_API } from '../../config';
import './AvatarCustomizer.css';

/* Upgrade #6: Preset seat-circle colors */
const SEAT_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#3b82f6','#ef4444','#3b82f6',
  '#84cc16','#f97316','#e11d48','#3b82f6',
];

export default function AvatarCustomizer() {
  const avatar = useGameStore((s) => s.avatar);
  const updateAvatar = useGameStore((s) => s.updateAvatar);
  const updateFaceShape = useGameStore((s) => s.updateFaceShape);
  const resetAvatar = useGameStore((s) => s.resetAvatar);
  const setScreen = useGameStore((s) => s.setScreen);

  // Photo moderation status: null | 'uploading' | 'pending' | 'error'.
  // A locally-picked photo is held in `pendingPreview` for the customizer's own
  // preview ONLY — it is NEVER written into the socket-emitted avatar object, so
  // an unmoderated image can't reach the table. It shows table-wide only after
  // admin approval, rendered from the approved master-API avatar (avatarService
  // → GET /avatars/display/:id, which returns approved uploads only).
  const [photoStatus, setPhotoStatus] = useState(null);
  const [photoMessage, setPhotoMessage] = useState('');
  const [pendingPreview, setPendingPreview] = useState(null);

  /* Upgrade #1: photo upload — center-crop & resize to 80×80 JPEG, then submit
     to the MODERATED master-API pipeline (POST /avatars/upload → mime/magic-byte
     check → Cloud Vision SafeSearch → admin approval queue). Fail-closed: not
     shown table-wide until approved. */
  const fileInputRef = useRef(null);
  const submitPhotoForModeration = async (dataUrl) => {
    const userId = useGameStore.getState().userId;
    if (!userId) { setPhotoStatus('error'); setPhotoMessage('Sign in to upload a photo.'); return; }
    const token = getAuthToken();
    if (!token) { setPhotoStatus('error'); setPhotoMessage('Sign in to upload a photo.'); return; }
    setPhotoStatus('uploading');
    setPhotoMessage('Uploading…');
    try {
      const res = await fetchWithTimeout(`${MASTER_API}/avatars/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, imageData: dataUrl }),
      }, 15000);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.success) {
        setPhotoStatus('pending');
        setPhotoMessage('Photo submitted — pending review. It appears at the table once an admin approves it.');
      } else {
        setPhotoStatus('error');
        setPhotoMessage(body?.message || 'Upload failed. Please try again.');
        setPendingPreview(null);
      }
    } catch {
      setPhotoStatus('error');
      setPhotoMessage('Upload failed (network). Please try again.');
      setPendingPreview(null);
    }
  };
  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // 2026-07-06 audit P3 — validate BEFORE processing. The image is center-
    // cropped to an 80×80 JPEG data URL and submitted to the moderated pipeline;
    // guard type + size here so a huge file can't freeze the main thread on
    // decode and a renamed non-image can't reach the upload path. The server
    // remains the moderation authority (mime/magic-byte + Cloud Vision).
    const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — plenty for a source photo
    if (!/^image\/(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.type || '')) {
      // eslint-disable-next-line no-alert
      alert('Please choose an image file (PNG, JPG, WEBP, GIF).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      // eslint-disable-next-line no-alert
      alert('That image is too large (max 8 MB). Pick a smaller photo.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const SIZE = 80;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, SIZE, SIZE);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        // Local preview only — NOT written to the socket-emitted avatar.
        setPendingPreview(dataUrl);
        submitPhotoForModeration(dataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const clearPendingPhoto = () => {
    setPendingPreview(null);
    setPhotoStatus(null);
    setPhotoMessage('');
    // Clear any legacy locally-set photo too so the seat falls back to the
    // moderated/approved avatar rather than an unmoderated table-wide image.
    if (avatar.photo) updateAvatar('photo', null);
  };

  const seatPreview = avatar.seatColor || avatar.skinTone || '#6366f1';

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
            <meshStandardMaterial color="#0c1a44" />
          </mesh>
        </Canvas>
      </div>

      {/* Controls Panel */}
      <div className="customizer-panel">
        <h2>Create Your Avatar</h2>

        {/* Upgrade #1: Photo upload — moderated pipeline (pending until approved) */}
        <Section title="Seat Photo">
          <div className="photo-upload-row">
            <div
              className="photo-preview"
              style={{ background: seatPreview }}
              onClick={() => fileInputRef.current?.click()}
            >
              {(pendingPreview || avatar.photo)
                ? <img src={pendingPreview || avatar.photo} alt="avatar" className="photo-preview__img" />
                : <span className="photo-preview__placeholder">📷</span>
              }
            </div>
            <div className="photo-upload-actions">
              <button className="btn-upload" onClick={() => fileInputRef.current?.click()} disabled={photoStatus === 'uploading'}>
                {photoStatus === 'uploading' ? 'Uploading…' : 'Upload Photo'}
              </button>
              {(pendingPreview || avatar.photo) && (
                <button className="btn-remove-photo" onClick={clearPendingPhoto}>
                  Remove
                </button>
              )}
              {photoMessage
                ? <span className="photo-hint" style={{ color: photoStatus === 'error' ? '#F87171' : (photoStatus === 'pending' ? '#4ADE80' : '#9fb4d8') }}>{photoMessage}</span>
                : <span className="photo-hint">Photos are reviewed before appearing at the table</span>
              }
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoUpload}
            />
          </div>
        </Section>

        {/* Upgrade #6: Seat circle color */}
        <Section title="Seat Color">
          <div className="color-row">
            {SEAT_COLORS.map((color) => (
              <button
                key={color}
                className={`color-swatch ${avatar.seatColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => updateAvatar('seatColor', color)}
              />
            ))}
            <label className="color-swatch color-swatch--custom" title="Custom color" style={{ background: avatar.seatColor && !SEAT_COLORS.includes(avatar.seatColor) ? avatar.seatColor : '#444' }}>
              <span>+</span>
              <input
                type="color"
                value={avatar.seatColor || '#6366f1'}
                onChange={(e) => updateAvatar('seatColor', e.target.value)}
                style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
              />
            </label>
          </div>
        </Section>

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
