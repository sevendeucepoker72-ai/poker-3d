import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../../services/socketService';
import { isItemOwned, equippedIdFor, activeBoostersAt, vipPassActive } from '../../store/progressStore';
import {
  TYPE_EFFECTS, THEMES, CARD_BACKS, FRAMES, TITLES, EMOTES, PROFILE_BGS, COLLECTIBLES, TYPE_LABELS,
  FREE_DEFAULTS, CHIP_PACKS, MYSTERY_BOXES, BOOSTERS, VIP_PASSES, BUNDLES, VIP_PASS_PERKS,
  boosterEffectText, bundleContentsText, chipBoostedRewards, priceOf, purchaseResultText, shopErrorText, itemName,
} from '../../utils/economyCatalog';
import { formatCountdown } from '../../utils/denverTime';
import LoginRewards from './LoginRewards';
import { VipPassStatus } from './VIPPanel';
import { useBattlePassPremium } from './BattlePass';
import './ShopTab.css';

// 2026-10-11 (.online R2 — C7 / C8 / ECON-6 / ECON-7 / APPUI-5). The Shop:
// - every item says what it does (TYPE_EFFECTS), its owned / equipped state
//   comes from the server (inventory rows + C5 equipped / owned), and each
//   kind has Equip / Unequip (Unequip = back to the free default, or
//   `unequipItem` for frames and titles);
// - only cosmetics something draws are sold (economyCatalog SOLD_TYPES);
//   ones bought before that show in "Your collection";
// - buying takes two taps (tap the price, then Confirm) so a stray tap on a
//   phone never spends stars; the answer shows on the item;
// - the old Theme Shop modal (a second price list) is gone.

const ARM_MS = 4000;
const ANSWER_TIMEOUT_MS = 10000;

const EQUIP_ERRORS = {
  not_owned: 'You do not own that yet.',
  unknown_item: 'That item is not available any more.',
  not_equippable: 'That item cannot be equipped.',
};

function useShopActions() {
  const [armed, setArmed] = useState(null);       // 'type:id' awaiting Confirm
  const [pending, setPending] = useState(null);   // { key, action }
  const [status, setStatus] = useState({});       // key -> { ok, text }
  const armTimer = useRef(null);
  const answerTimer = useRef(null);
  const pendingRef = useRef(null);
  pendingRef.current = pending;

  const settle = useCallback((key, ok, text) => {
    if (answerTimer.current) { clearTimeout(answerTimer.current); answerTimer.current = null; }
    setPending((p) => (p && p.key === key ? null : p));
    setStatus((s) => ({ ...s, [key]: { ok, text } }));
    setTimeout(() => setStatus((s) => {
      if (!s[key] || s[key].text !== text) return s;
      const next = { ...s };
      delete next[key];
      return next;
    }), 6000);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onPurchase = (res) => {
      const p = pendingRef.current;
      if (!p || p.action !== 'buy') return;
      const key = res && res.itemType && res.itemId ? `${res.itemType}:${res.itemId}` : p.key;
      if (key !== p.key && res && res.itemType) return;
      settle(p.key, !!(res && res.success), purchaseResultText(res) || (res && res.success ? 'Done.' : 'That did not work — try again.'));
    };
    const onEquip = (res) => {
      const p = pendingRef.current;
      if (!p || (p.action !== 'equip' && p.action !== 'unequip')) return;
      if (res && res.itemType && !p.key.startsWith(`${res.itemType}:`)) return;
      if (res && res.success) settle(p.key, true, p.action === 'unequip' ? 'Removed.' : 'Equipped.');
      else settle(p.key, false, EQUIP_ERRORS[res && res.error] || shopErrorText(res && res.error, 'Could not change that — try again.'));
    };
    socket.on('purchaseResult', onPurchase);
    socket.on('equipResult', onEquip);
    socket.on('unequipResult', onEquip);
    return () => {
      socket.off('purchaseResult', onPurchase);
      socket.off('equipResult', onEquip);
      socket.off('unequipResult', onEquip);
    };
  }, [settle]);

  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    if (answerTimer.current) clearTimeout(answerTimer.current);
  }, []);

  const send = useCallback((key, action, event, payload) => {
    const socket = getSocket();
    if (!socket || !socket.connected) { settle(key, false, 'Not connected — try again in a moment.'); return; }
    setPending({ key, action });
    if (answerTimer.current) clearTimeout(answerTimer.current);
    answerTimer.current = setTimeout(() => {
      answerTimer.current = null;
      setPending((p) => (p && p.key === key ? null : p));
      setStatus((s) => ({ ...s, [key]: { ok: false, text: action === 'unequip' ? 'Removing it is not available on this server yet.' : 'The game server did not answer — check your stars before trying again.' } }));
    }, ANSWER_TIMEOUT_MS);
    socket.emit(event, payload);
  }, [settle]);

  /** First tap arms, second tap (within 4s) buys. */
  const buy = useCallback((type, id) => {
    const key = `${type}:${id}`;
    if (armed !== key) {
      setArmed(key);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed((a) => (a === key ? null : a)), ARM_MS);
      return;
    }
    setArmed(null);
    send(key, 'buy', 'purchaseShopItem', { itemType: type, itemId: id });
  }, [armed, send]);

  const equip = useCallback((type, id) => {
    send(`${type}:${id}`, 'equip', 'equipItem', { itemType: type, itemId: id });
  }, [send]);

  const unequip = useCallback((type, id) => {
    const free = FREE_DEFAULTS[type];
    if (free) { send(`${type}:${id}`, 'unequip', 'equipItem', { itemType: type, itemId: free }); return; }
    send(`${type}:${id}`, 'unequip', 'unequipItem', { itemType: type });
  }, [send]);

  return { armed, pending, status, buy, equip, unequip };
}

function Preview({ type, item }) {
  if (type === 'theme') {
    return (
      <div className={`shop-preview shop-preview--felt ${item.glow ? 'shop-preview--glow' : ''}`} style={{ background: item.felt, borderColor: item.rail }}>
        <span>♠</span>
      </div>
    );
  }
  if (type === 'card_back') {
    return (
      <div className="shop-preview shop-preview--cardback" style={{ background: `repeating-linear-gradient(45deg, ${item.color}, ${item.color} 6px, rgba(255,255,255,0.18) 6px, rgba(255,255,255,0.18) 8px)` }} />
    );
  }
  if (type === 'frame') {
    return (
      <div className="shop-preview shop-preview--frame" style={{ borderColor: item.color, boxShadow: `0 0 10px ${item.color}66` }}>
        <span style={{ color: item.color }}>{item.icon}</span>
      </div>
    );
  }
  if (type === 'emote') return <div className="shop-preview shop-preview--emote"><span>{item.icon}</span></div>;
  if (type === 'profile_bg') return <div className="shop-preview shop-preview--bg" style={{ background: item.bg }} />;
  return <div className="shop-preview"><span>{item.icon || '🎁'}</span></div>;
}

function CosmeticCard({ type, item, progress, actions }) {
  const price = priceOf(type, item.id, item.price ?? 0);
  const free = price === 0;
  const owned = isItemOwned(progress, type, item.id, { free });
  const equippable = type !== 'emote';
  const current = equippedIdFor(progress, type) || FREE_DEFAULTS[type] || null;
  const equipped = equippable && current === item.id;
  const key = `${type}:${item.id}`;
  const busy = actions.pending && actions.pending.key === key;
  const st = actions.status[key];
  const isArmed = actions.armed === key;
  const canUnequip = equipped && !(FREE_DEFAULTS[type] && FREE_DEFAULTS[type] === item.id);
  return (
    <div className={`lobby-card-back shop-card ${owned ? 'owned' : 'locked'} ${equipped ? 'shop-card--equipped' : ''}`}>
      <Preview type={type} item={item} />
      <span className="lobby-card-back-name">{item.name}</span>
      <span className="shop-card-state">
        {equipped ? 'Equipped ✓' : owned ? (type === 'emote' ? 'In your emote wheel' : 'Owned') : `${price.toLocaleString()} ⭐`}
      </span>
      <div className="shop-card-actions">
        {!owned && (
          <button type="button" className={`shop-btn ${isArmed ? 'shop-btn--confirm' : ''}`} disabled={busy} onClick={() => actions.buy(type, item.id)}>
            {busy ? '…' : isArmed ? `Confirm ${price.toLocaleString()}⭐` : 'Buy'}
          </button>
        )}
        {owned && equippable && !equipped && (
          <button type="button" className="shop-btn shop-btn--equip" disabled={busy} onClick={() => actions.equip(type, item.id)}>
            {busy ? '…' : 'Equip'}
          </button>
        )}
        {canUnequip && (
          <button type="button" className="shop-btn shop-btn--ghost" disabled={busy} onClick={() => actions.unequip(type, item.id)}>
            {busy ? '…' : 'Unequip'}
          </button>
        )}
      </div>
      {st && <div className={`shop-card-status ${st.ok ? 'shop-card-status--ok' : ''}`}>{st.text}</div>}
    </div>
  );
}

function TitleRow({ item, progress, actions }) {
  const price = priceOf('title', item.id, item.price);
  const owned = isItemOwned(progress, 'title', item.id);
  const equipped = equippedIdFor(progress, 'title') === item.id;
  const key = `title:${item.id}`;
  const busy = actions.pending && actions.pending.key === key;
  const st = actions.status[key];
  const isArmed = actions.armed === key;
  return (
    <div className={`lobby-vip-package-card shop-row ${equipped ? 'shop-card--equipped' : ''}`} style={{ borderLeftColor: item.color }}>
      <div className="shop-row-main">
        <div className="shop-title-preview" style={{ color: item.color }}>{item.name}</div>
        <div className="shop-row-desc">{item.desc}</div>
        {st && <div className={`shop-card-status ${st.ok ? 'shop-card-status--ok' : ''}`}>{st.text}</div>}
      </div>
      <div className="shop-row-actions">
        {!owned && (
          <button type="button" className={`shop-btn ${isArmed ? 'shop-btn--confirm' : ''}`} disabled={busy} onClick={() => actions.buy('title', item.id)}>
            {busy ? '…' : isArmed ? `Confirm ${price.toLocaleString()}⭐` : `${price.toLocaleString()} ⭐`}
          </button>
        )}
        {owned && !equipped && <button type="button" className="shop-btn shop-btn--equip" disabled={busy} onClick={() => actions.equip('title', item.id)}>{busy ? '…' : 'Equip'}</button>}
        {equipped && <button type="button" className="shop-btn shop-btn--ghost" disabled={busy} onClick={() => actions.unequip('title', item.id)}>{busy ? '…' : 'Unequip'}</button>}
      </div>
    </div>
  );
}

/** A non-cosmetic product (chip pack, box, booster, VIP pass, bundle). */
function ProductRow({ type, id, name, desc, price, color, actions, extra }) {
  const key = `${type}:${id}`;
  const busy = actions.pending && actions.pending.key === key;
  const st = actions.status[key];
  const isArmed = actions.armed === key;
  const p = priceOf(type, id, price);
  return (
    <div className="lobby-vip-package-card shop-row" style={{ borderLeftColor: color }}>
      <div className="shop-row-main">
        <div className="shop-row-name" style={{ color }}>{name}</div>
        <div className="shop-row-desc">{desc}</div>
        {extra}
        {st && <div className={`shop-card-status ${st.ok ? 'shop-card-status--ok' : ''}`}>{st.text}</div>}
      </div>
      <div className="shop-row-actions">
        <button type="button" className={`shop-btn ${isArmed ? 'shop-btn--confirm' : ''}`} disabled={busy} onClick={() => actions.buy(type, id)}>
          {busy ? '…' : isArmed ? `Confirm ${p.toLocaleString()}⭐` : `${p.toLocaleString()} ⭐`}
        </button>
      </div>
    </div>
  );
}

function Section({ title, effect, children }) {
  return (
    <section className="shop-section">
      <div className="lobby-section-header">
        <h2 className="lobby-section-title">{title}</h2>
        <div className="lobby-section-divider" />
      </div>
      {effect && <p className="shop-section-effect">{effect}</p>}
      {children}
    </section>
  );
}

export default function ShopTab({ progress, chipCount, onOpenBattlePass, onOpenDailyRewards, onOpenSpin, onOpenScratch, onOpenVip }) {
  const actions = useShopActions();
  const bp = useBattlePassPremium();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  const stars = progress?.stars ?? 0;
  const chips = typeof chipCount === 'number' ? chipCount : (progress?.chips ?? 0);
  const scratch = Math.max(0, Number(progress?.scratchCardsAvailable) || 0);
  const boostersOn = activeBoostersAt(progress, now);
  const boosterOn = (kind) => boostersOn.find((b) => b.type === kind);
  const vipOn = vipPassActive(progress, now);

  // Owned collectibles (bundles / boxes) — drawn nowhere, never sold.
  const collection = [];
  for (const [type, list] of Object.entries(COLLECTIBLES)) {
    for (const item of list) {
      if (isItemOwned(progress, type, item.id)) collection.push({ type, item });
    }
  }

  const grid = (type, list) => (
    <div className="lobby-card-backs-grid shop-grid">
      {list.map((item) => <CosmeticCard key={item.id} type={type} item={item} progress={progress} actions={actions} />)}
    </div>
  );

  return (
    <div className="lobby-tab-content lobby-tab-fade shop-tab" key="shop">
      {/* Sticky balance — what he can afford before browsing. */}
      <div className="lobby-shop-balance shop-balance">
        <span className="shop-balance-stars">⭐ {stars.toLocaleString()} Stars</span>
        <span className="shop-balance-chips">🪙 {chips.toLocaleString()} Chips</span>
      </div>

      {/* Battle Pass */}
      <Section title="Battle Pass" effect="Earn season XP by playing; every 500 XP unlocks a tier of rewards.">
        <button className="btn-accent lobby-full-width-btn lobby-bp-btn" onClick={onOpenBattlePass}>
          ⚔️ Season 1: The River — View Battle Pass
        </button>
        {!bp.premium ? (
          <div className="shop-bp-premium">
            <span>Premium track: cosmetics, chips and stars on every tier.</span>
            <button type="button" className="shop-btn shop-btn--confirm" onClick={bp.buy} disabled={bp.state.phase === 'pending'}>
              {bp.state.phase === 'pending' ? 'Buying…' : `Go Premium · ${bp.cost.toLocaleString()}⭐`}
            </button>
            {bp.state.text && <div className={`shop-card-status ${bp.state.phase === 'done' ? 'shop-card-status--ok' : ''}`}>{bp.state.text}</div>}
          </div>
        ) : (
          <div className="shop-bp-premium shop-bp-premium--owned">⭐ Premium unlocked — claim premium rewards in the Battle Pass.</div>
        )}
      </Section>

      {/* Daily Rewards */}
      <Section title="Daily Rewards" effect="One claim per day (resets at midnight, Denver time). Claim on back-to-back days to grow your streak.">
        <div className="lobby-daily-rewards-inline">
          <LoginRewards onClose={() => {}} autoOpened={false} inline={true} />
        </div>
        <button
          className="btn-accent lobby-full-width-btn"
          style={{ marginBottom: '12px', background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0a0a1a', borderColor: 'rgba(245,158,11,0.5)' }}
          onClick={onOpenDailyRewards}
        >
          Open Daily Rewards
        </button>
        <div className="shop-two-buttons">
          <button className="btn-accent shop-spin-btn" onClick={onOpenSpin}>Daily Spin</button>
          <button className="btn-accent shop-scratch-btn" onClick={() => onOpenScratch(false)}>Scratch Cards</button>
        </div>
      </Section>

      {/* Scratch cards (banked by the server: 1 per 20 hands) */}
      <Section title="Scratch Cards" effect="You bank one scratch card every 20 hands you play. Each reveals chips, stars or an emote.">
        <div className="lobby-vip-packages">
          <div className="lobby-vip-package-card shop-row" style={{ borderLeftColor: '#D97706' }}>
            <div className="shop-row-main">
              <div className="shop-row-name" style={{ color: '#ffd24a' }}>🎟️ {scratch} scratch card{scratch === 1 ? '' : 's'} ready</div>
              <div className="shop-row-desc">{scratch > 0 ? 'Reveal one now — the result shows right away.' : 'Play hands to earn your next card.'}</div>
            </div>
            <div className="shop-row-actions">
              <button type="button" className="shop-btn" disabled={scratch === 0} onClick={() => onOpenScratch(true)}>Reveal</button>
            </div>
          </div>
        </div>
      </Section>

      {/* VIP */}
      <Section title="VIP Pass" effect="While your pass is active: VIP badge and gold frame at tables, +50% daily login reward, a monthly chip bonus and VIP emotes.">
        <VipPassStatus compact />
        <ul className="shop-vip-perks">
          {VIP_PASS_PERKS.map((p) => <li key={p.id}><span aria-hidden="true">{p.icon}</span> {p.text}</li>)}
        </ul>
        <div className="lobby-vip-packages">
          {VIP_PASSES.map((v) => (
            <ProductRow
              key={v.id} type="vip_pass" id={v.id} name={v.name} price={v.price} color={v.id === 'lifetime' ? '#FFD700' : '#3B82F6'} actions={actions}
              desc={v.id === 'lifetime' ? 'Every VIP perk, for good.' : `Every VIP perk for ${v.days} day${v.days === 1 ? '' : 's'}${vipOn ? ' — added to the time you have left' : ''}.`}
            />
          ))}
        </div>
        <button type="button" className="shop-link-btn" onClick={onOpenVip}>VIP details and XP-rate tiers →</button>
      </Section>

      {/* Boosters */}
      <Section title="Boosters" effect="Timed boosts. Buying one that is already running adds its time.">
        {boostersOn.length > 0 && (
          <div className="shop-active-boosters">
            {boostersOn.map((b) => (
              <span key={b.type} className="shop-active-booster">
                {b.type === 'xp' ? `${b.multiplier}× XP` : `${b.multiplier}× chip rewards`} — {formatCountdown(b.expiresAt, now)} left
              </span>
            ))}
          </div>
        )}
        <div className="lobby-vip-packages">
          {BOOSTERS.map((b) => (
            <ProductRow
              key={b.id} type="booster" id={b.id} name={b.name} price={b.price} color={b.kind === 'xp' ? '#8B5CF6' : '#F59E0B'} actions={actions}
              desc={boosterEffectText(b, chipBoostedRewards())}
              extra={boosterOn(b.kind) ? <div className="shop-row-note">Active now — this adds {b.minutes >= 60 ? `${b.minutes / 60} h` : `${b.minutes} min`}.</div> : null}
            />
          ))}
        </div>
      </Section>

      <Section title="Table Themes" effect={TYPE_EFFECTS.theme}>{grid('theme', THEMES)}</Section>
      <Section title="Card Backs" effect={TYPE_EFFECTS.card_back}>{grid('card_back', CARD_BACKS)}</Section>
      <Section title="Nameplate Frames" effect={TYPE_EFFECTS.frame}>{grid('frame', FRAMES)}</Section>
      <Section title="Titles" effect={TYPE_EFFECTS.title}>
        <div className="lobby-vip-packages">
          {TITLES.map((t) => <TitleRow key={t.id} item={t} progress={progress} actions={actions} />)}
        </div>
      </Section>
      <Section title="Emotes" effect={TYPE_EFFECTS.emote}>{grid('emote', EMOTES)}</Section>
      <Section title="Profile Backgrounds" effect={TYPE_EFFECTS.profile_bg}>{grid('profile_bg', PROFILE_BGS)}</Section>

      {/* Chip Packs — stars → chips */}
      <Section title="Chip Packs" effect="Turn stars into play chips (play money — chips can never be cashed out).">
        <div className="lobby-vip-packages">
          {CHIP_PACKS.map((p) => (
            <ProductRow key={p.id} type="chip_pack" id={p.id} name={p.name} price={p.price} color="#3B82F6" actions={actions}
              desc={`${p.chips.toLocaleString()} chips added to your balance.`} />
          ))}
        </div>
      </Section>

      {/* Mystery Boxes — stars → a random reward */}
      <Section title="Mystery Boxes" effect="Each box rolls one reward. An item you already own is refunded in stars.">
        <div className="lobby-vip-packages">
          {MYSTERY_BOXES.map((b) => (
            <ProductRow key={b.id} type="mystery_box" id={b.id} name={`${b.icon} ${b.name}`} price={b.price} color={b.id === 'legendary' ? '#FFD700' : '#A78BFA'} actions={actions} desc={b.desc} />
          ))}
        </div>
      </Section>

      {/* Bundles */}
      <Section title="Bundle Deals" effect="Several items at once. Items you already own are refunded in stars (25% of the bundle price, shared out).">
        <div className="lobby-vip-packages">
          {BUNDLES.map((b) => (
            <ProductRow key={b.id} type="bundle" id={b.id} name={`${b.icon} ${b.name}`} price={b.price} color="#84CC16" actions={actions}
              desc={`${b.contents.length} items — ${bundleContentsText(b.contents)}`} />
          ))}
        </div>
      </Section>

      {collection.length > 0 && (
        <Section title="Your Collection" effect="Collectibles you own from bundles and boxes. They are not shown at tables yet.">
          <div className="shop-collection">
            {collection.map(({ type, item }) => (
              <span key={`${type}:${item.id}`} className="shop-collectible" title={`${itemName(type, item.id)} — ${TYPE_LABELS[type] || type}`}>
                <span aria-hidden="true">{item.icon}</span> {item.name} <em>{(TYPE_LABELS[type] || type).toLowerCase()}</em>
              </span>
            ))}
          </div>
        </Section>
      )}

      <div className="shop-footnote">
        💡 Earn ⭐ stars by leveling up, finishing missions and achievements, daily rewards, spins and scratch cards. Stars and chips are play money.
      </div>
    </div>
  );
}
