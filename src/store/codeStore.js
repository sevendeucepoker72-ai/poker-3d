// Global entry code + promotions store
import { useState, useEffect } from 'react';
import { getSocket } from '../services/socketService';

const CODES_KEY  = 'poker-entry-codes';
const PROMOS_KEY = 'poker-promotions';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function load(key) { try { const r = sessionStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; } }
function save(key, val) { try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {} }

let _codes  = load(CODES_KEY)  || [];
let _promos = load(PROMOS_KEY) || [];

const _codeSubs  = new Set();
const _promoSubs = new Set();
function notifyCodes()  { _codeSubs.forEach((fn) => fn(_codes)); }
function notifyPromos() { _promoSubs.forEach((fn) => fn(_promos)); }

export const codeActions = {
  // ── Code generation ─────────────────────────────────────────────────────
  generate: ({ count, qualifierType, promotionId, expiresAt }) => {
    const newCodes = Array.from({ length: count }, () => ({
      code:        genCode(),
      createdAt:   new Date().toISOString(),
      expiresAt:   expiresAt || null, // null = never expires
      qualifierType: qualifierType || null,   // 'Weekly' | 'Monthly' | 'Special' | null
      promotionId: promotionId    || null,
      usedBy:      null,
      usedAt:      null,
      usedForQualifierId: null,
    }));
    _codes = [..._codes, ...newCodes];
    save(CODES_KEY, _codes);
    notifyCodes();
    return newCodes;
  },

  // ── Validation (used by QualifierLobby) ─────────────────────────────────
  // Returns { valid: bool, reason?: string }
  validate: (rawCode, qualifier) => {
    const code = rawCode.trim().toUpperCase();
    const entry = _codes.find((c) => c.code === code);
    if (!entry)       return { valid: false, reason: 'Code not found.' };
    if (entry.usedBy) return { valid: false, reason: 'Code already used.' };
    if (entry.expiresAt && new Date(entry.expiresAt) < Date.now()) return { valid: false, reason: 'Code expired.' };

    // Scope check — type-based
    if (entry.qualifierType && entry.qualifierType !== qualifier.type) {
      return { valid: false, reason: `This code is for ${entry.qualifierType} qualifiers only.` };
    }
    // Scope check — promotion-based
    if (entry.promotionId) {
      if (!qualifier.promotionId || qualifier.promotionId !== entry.promotionId) {
        const promoName = _promos.find((p) => p.id === entry.promotionId)?.name || entry.promotionId;
        return { valid: false, reason: `Code is only valid for the "${promoName}" promotion.` };
      }
    }
    return { valid: true };
  },

  markUsed: (rawCode, playerName, qualifierId) => {
    const code = rawCode.trim().toUpperCase();
    _codes = _codes.map((c) => c.code === code
      ? { ...c, usedBy: playerName, usedAt: new Date().toISOString(), usedForQualifierId: qualifierId }
      : c
    );
    save(CODES_KEY, _codes);
    notifyCodes();
  },

  revoke: (code) => {
    _codes = _codes.filter((c) => c.code !== code);
    save(CODES_KEY, _codes);
    notifyCodes();
  },

  revokeAll: (filter) => {
    // filter: { qualifierType?, promotionId?, unusedOnly? }
    _codes = _codes.filter((c) => {
      if (filter.qualifierType && c.qualifierType !== filter.qualifierType) return true;
      if (filter.promotionId   && c.promotionId   !== filter.promotionId)   return true;
      if (filter.unusedOnly    && c.usedBy)                                  return true;
      return false;
    });
    save(CODES_KEY, _codes);
    notifyCodes();
  },

  getCodes: () => _codes,

  // ── Promotions (SERVER-persisted; was sessionStorage only) ─────────────────
  // Mutations emit admin socket events; the server persists + broadcasts the
  // updated list back via 'adminPromotions', which refreshes _promos.
  addPromo: (promo) => {
    const socket = getSocket();
    if (socket) socket.emit('savePromotion', { name: promo.name, description: promo.description || '', startDate: promo.startDate || '', endDate: promo.endDate || '' });
  },

  updatePromo: (id, changes) => {
    const socket = getSocket();
    if (socket) socket.emit('savePromotion', { id, name: changes.name, description: changes.description || '', startDate: changes.startDate || '', endDate: changes.endDate || '' });
  },

  deletePromo: (id) => {
    const socket = getSocket();
    if (socket) socket.emit('deletePromotion', { id });
  },

  getPromos: () => _promos,
};

// Register the server-promotions listener once + fetch the current list. Called
// from usePromos() so the admin panel is populated from the server on mount.
let _promoSynced = false;
function ensurePromoSync() {
  const socket = getSocket();
  if (!socket) return;
  if (!_promoSynced) {
    _promoSynced = true;
    socket.on('adminPromotions', (list) => {
      _promos = Array.isArray(list) ? list : [];
      save(PROMOS_KEY, _promos); // cache for instant paint next mount
      notifyPromos();
    });
  }
  socket.emit('getPromotions');
}

export function useCodes() {
  const [codes, set] = useState(_codes);
  useEffect(() => { set(_codes); _codeSubs.add(set); return () => { _codeSubs.delete(set); }; }, []);
  return codes;
}

export function usePromos() {
  const [promos, set] = useState(_promos);
  useEffect(() => { set(_promos); _promoSubs.add(set); ensurePromoSync(); return () => { _promoSubs.delete(set); }; }, []);
  return promos;
}
