import { create } from 'zustand';
import { useGameStore } from './gameStore';

/**
 * Tournament registrations — ONE shared store (R2 contract C2, 2026-10-11;
 * TOURNEY-7 / TOURNEY-5).
 *
 * WHY. TournamentLobby kept `registeredIds` in component state and the lobby
 * mounts it on two tabs (Home and Play): every tab switch / Back to Lobby /
 * reload forgot the registration, the card offered Register again, and a
 * second tap paid a second entry fee (the server deduped on a random playerId).
 *
 * Now:
 *  - the SERVER is the source: every `tournamentList` item carries
 *    `registered:boolean` and `entryId|null` for the asking socket (C2). A list
 *    that carries the flags is authoritative for every item it lists;
 *  - between lists (and on an older server that sends no flag) the
 *    `tournamentRegistered` / `tournamentUnregistered` answers are recorded
 *    here, in memory and in this tab's sessionStorage FOR THIS ACCOUNT (a
 *    different account signing in on the tab starts empty);
 *  - a tournament that is no longer listed is forgotten;
 *  - `tournamentCancelled { tournamentId, refunded, reason }` drops the entry
 *    and keeps a notice with the refund until the player dismisses it.
 */

const STORAGE_KEY = 'poker_tourney_reg_v1';
const MAX_CANCEL_NOTICES = 5;
/** A Register / Withdraw nobody answered stops showing as in flight after this long. */
export const REGISTRATION_PENDING_MS = 12000;

/** The in-flight action for a tournament ('register' | 'withdraw'), or null (none, or too old). */
export function pendingKind(pending, tournamentId, now = Date.now()) {
  const p = pending && tournamentId != null ? pending[String(tournamentId)] : null;
  if (!p || typeof p !== 'object') return null;
  return now - (p.at || 0) < REGISTRATION_PENDING_MS ? p.kind : null;
}

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function writeStored(owner, registered) {
  try {
    if (!owner) { sessionStorage.removeItem(STORAGE_KEY); return; }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ owner, registered }));
  } catch { /* storage blocked: memory only */ }
}

function currentOwner() {
  try {
    const uid = useGameStore.getState().userId;
    return uid !== null && uid !== undefined && uid !== '' ? String(uid) : null;
  } catch { return null; }
}

function idOf(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function entryIdOf(v) {
  if (v === null || v === undefined || v === '') return null;
  return String(v).slice(0, 80);
}

/** Player-facing line for a cancelled tournament (refund included when there was one). */
export function tournamentCancelledText({ name, refunded }) {
  const n = Number(refunded);
  const title = name ? String(name) : 'A tournament you registered for';
  return Number.isFinite(n) && n > 0
    ? `${title} was cancelled. Your ${n.toLocaleString()}-chip entry was refunded.`
    : `${title} was cancelled. Your registration has been removed.`;
}

export const useTournamentRegistrationStore = create((set, get) => ({
  owner: null,
  tournaments: [],
  listAt: 0,
  /** The last list carried per-socket `registered` flags (C2 server). */
  serverFlags: false,
  /** tournamentId -> { entryId, at } */
  registered: {},
  /** tournamentId -> { kind: 'register' | 'withdraw', at } (read through pendingKind) */
  pending: {},
  /** [{ tournamentId, name, refunded, reason, at }] newest first */
  cancellations: [],

  /** Bind the store to the signed-in account (another account on this tab starts empty). */
  syncOwner: () => {
    const owner = currentOwner();
    if (owner === get().owner) return;
    const stored = readStored();
    const registered = owner && stored && stored.owner === owner && stored.registered && typeof stored.registered === 'object'
      ? stored.registered : {};
    set({ owner, registered, pending: {}, cancellations: [], serverFlags: false });
  },

  applyTournamentList: (list) => {
    get().syncOwner();
    const items = Array.isArray(list) ? list.filter((t) => t && idOf(t.tournamentId)) : [];
    const flags = items.some((t) => typeof t.registered === 'boolean');
    const registered = { ...get().registered };
    const pending = { ...get().pending };
    if (flags) {
      for (const t of items) {
        const id = idOf(t.tournamentId);
        if (typeof t.registered !== 'boolean') continue;
        if (t.registered) {
          registered[id] = { entryId: entryIdOf(t.entryId) ?? registered[id]?.entryId ?? null, at: registered[id]?.at || Date.now() };
          if (pending[id]?.kind === 'register') delete pending[id];
        } else {
          delete registered[id];
          if (pending[id]?.kind === 'withdraw') delete pending[id];
        }
      }
    }
    const listed = new Set(items.map((t) => idOf(t.tournamentId)));
    for (const id of Object.keys(registered)) if (!listed.has(id)) delete registered[id];
    set({ tournaments: items, listAt: Date.now(), serverFlags: flags, registered, pending });
    writeStored(get().owner, registered);
  },

  noteRegistered: (data) => {
    get().syncOwner();
    const id = idOf(data?.tournamentId);
    if (!id) return;
    const registered = { ...get().registered, [id]: { entryId: entryIdOf(data?.entryId), at: Date.now() } };
    const pending = { ...get().pending };
    delete pending[id];
    set({ registered, pending });
    writeStored(get().owner, registered);
  },

  noteUnregistered: (data) => {
    get().syncOwner();
    const id = idOf(data?.tournamentId);
    if (!id) return;
    const registered = { ...get().registered };
    delete registered[id];
    const pending = { ...get().pending };
    delete pending[id];
    set({ registered, pending });
    writeStored(get().owner, registered);
  },

  noteCancelled: (data) => {
    get().syncOwner();
    const id = idOf(data?.tournamentId);
    if (!id) return null;
    const t = get().tournaments.find((x) => idOf(x.tournamentId) === id);
    const notice = {
      tournamentId: id,
      name: (t && t.name) || (data?.name ? String(data.name).slice(0, 60) : null),
      refunded: Number.isFinite(Number(data?.refunded)) ? Math.max(0, Number(data.refunded)) : 0,
      reason: data?.reason ? String(data.reason).slice(0, 120) : null,
      at: Date.now(),
    };
    const registered = { ...get().registered };
    delete registered[id];
    const pending = { ...get().pending };
    delete pending[id];
    const cancellations = [notice, ...get().cancellations.filter((c) => c.tournamentId !== id)].slice(0, MAX_CANCEL_NOTICES);
    set({ registered, pending, cancellations, tournaments: get().tournaments.filter((x) => idOf(x.tournamentId) !== id) });
    writeStored(get().owner, registered);
    return notice;
  },

  dismissCancellation: (tournamentId) => {
    const id = idOf(tournamentId);
    set({ cancellations: get().cancellations.filter((c) => c.tournamentId !== id) });
  },

  setPending: (tournamentId, kind) => {
    const id = idOf(tournamentId);
    if (!id) return;
    const pending = { ...get().pending };
    if (kind) pending[id] = { kind, at: Date.now() }; else delete pending[id];
    set({ pending });
  },

  isRegistered: (tournamentId) => {
    const id = idOf(tournamentId);
    return !!(id && get().registered[id]);
  },
}));

/**
 * Wire the store to the app socket ONCE (App.jsx's socket effect). Specific
 * handler refs, so the returned teardown removes only these.
 * `onCancelled(notice)` lets the app show a toast wherever the player is.
 */
export function installTournamentRegistry(socket, { onCancelled } = {}) {
  if (!socket || typeof socket.on !== 'function') return () => {};
  const s = useTournamentRegistrationStore.getState;
  const handleList = (list) => { try { s().applyTournamentList(list); } catch { /* malformed frame */ } };
  const handleRegistered = (data) => { try { s().noteRegistered(data); } catch { /* ignore */ } };
  const handleUnregistered = (data) => { try { s().noteUnregistered(data); } catch { /* ignore */ } };
  const handleCancelled = (data) => {
    let notice = null;
    try { notice = s().noteCancelled(data); } catch { /* ignore */ }
    if (notice && typeof onCancelled === 'function') { try { onCancelled(notice); } catch { /* ignore */ } }
  };
  socket.on('tournamentList', handleList);
  socket.on('tournamentRegistered', handleRegistered);
  socket.on('tournamentUnregistered', handleUnregistered);
  socket.on('tournamentCancelled', handleCancelled);
  return () => {
    socket.off('tournamentList', handleList);
    socket.off('tournamentRegistered', handleRegistered);
    socket.off('tournamentUnregistered', handleUnregistered);
    socket.off('tournamentCancelled', handleCancelled);
  };
}
