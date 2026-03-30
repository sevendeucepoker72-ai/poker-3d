import { useState, useEffect } from 'react';
import './ProvablyFair.css';

// SHA-256 in the browser using SubtleCrypto
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function ProvablyFair({ commitment, revelation, onClose }) {
  const [verifyResult, setVerifyResult] = useState(null); // null | 'valid' | 'invalid'
  const [verifying, setVerifying] = useState(false);
  const [manualSeed, setManualSeed] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [manualResult, setManualResult] = useState(null);

  // Auto-verify when revelation arrives
  useEffect(() => {
    if (revelation?.seed && revelation?.hash) {
      setVerifying(true);
      sha256(revelation.seed).then(computed => {
        setVerifyResult(computed === revelation.hash ? 'valid' : 'invalid');
        setVerifying(false);
      });
    }
  }, [revelation]);

  const handleManualVerify = async () => {
    if (!manualSeed || !manualHash) return;
    const computed = await sha256(manualSeed);
    setManualResult(computed === manualHash ? 'valid' : 'invalid');
  };

  return (
    <div className="pf-overlay" onClick={onClose}>
      <div className="pf-modal" onClick={e => e.stopPropagation()}>
        <button className="pf-close" onClick={onClose}>✕</button>
        <div className="pf-header">
          <span className="pf-icon">🔐</span>
          <h2 className="pf-title">Provably Fair Dealing</h2>
          <p className="pf-subtitle">Every shuffle is cryptographically verifiable</p>
        </div>

        <div className="pf-how">
          <div className="pf-step"><span className="pf-step-num">1</span><span>Server generates a random seed before dealing</span></div>
          <div className="pf-step"><span className="pf-step-num">2</span><span>SHA-256 hash of seed is broadcast to all players</span></div>
          <div className="pf-step"><span className="pf-step-num">3</span><span>Deck is shuffled using that seed deterministically</span></div>
          <div className="pf-step"><span className="pf-step-num">4</span><span>Seed is revealed after the hand — you verify it matches</span></div>
        </div>

        {commitment && (
          <div className="pf-section">
            <div className="pf-section-label">Current Hand #{commitment.handNumber} — Committed Hash</div>
            <div className="pf-hash">{commitment.hash}</div>
            <div className="pf-note">Seed will be revealed when this hand ends</div>
          </div>
        )}

        {revelation && (
          <div className="pf-section">
            <div className="pf-section-label">Hand #{revelation.handNumber} — Revealed Seed</div>
            <div className="pf-seed">{revelation.seed}</div>
            <div className="pf-section-label" style={{ marginTop: 8 }}>SHA-256 Hash</div>
            <div className="pf-hash">{revelation.hash}</div>
            <div className={`pf-result pf-result--${verifying ? 'checking' : verifyResult}`}>
              {verifying ? '⏳ Verifying…' : verifyResult === 'valid' ? '✅ Verified — shuffle is provably fair' : verifyResult === 'invalid' ? '❌ Hash mismatch — contact support' : ''}
            </div>
          </div>
        )}

        <div className="pf-section">
          <div className="pf-section-label">Verify Any Hand Manually</div>
          <input className="pf-input" placeholder="Seed (hex)" value={manualSeed} onChange={e => setManualSeed(e.target.value)} />
          <input className="pf-input" placeholder="Hash (hex)" value={manualHash} onChange={e => setManualHash(e.target.value)} style={{ marginTop: 8 }} />
          <button className="pf-verify-btn" onClick={handleManualVerify} disabled={!manualSeed || !manualHash}>Verify</button>
          {manualResult && (
            <div className={`pf-result pf-result--${manualResult}`}>
              {manualResult === 'valid' ? '✅ Hash matches — shuffle is fair' : '❌ Hash mismatch'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
