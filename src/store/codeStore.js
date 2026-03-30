// Global entry code + promotions store
import { useState, useEffect } from 'react';

const CODES_KEY  = 'poker-entry-codes';
const PROMOS_KEY = 'poker-promotions';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function load(key) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

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

  // ── Promotions ───────────────────────────────────────────────────────────
  addPromo: (promo) => {
    const p = { ...promo, id: `promo-${Date.now()}` };
    _promos = [..._promos, p];
    save(PROMOS_KEY, _promos);
    notifyPromos();
    return p;
  },

  updatePromo: (id, changes) => {
    _promos = _promos.map((p) => p.id === id ? { ...p, ...changes } : p);
    save(PROMOS_KEY, _promos);
    notifyPromos();
  },

  deletePromo: (id) => {
    _promos = _promos.filter((p) => p.id !== id);
    save(PROMOS_KEY, _promos);
    notifyPromos();
  },

  getPromos: () => _promos,
};

export function useCodes() {
  const [codes, set] = useState(_codes);
  useEffect(() => { set(_codes); _codeSubs.add(set); return () => { _codeSubs.delete(set); }; }, []);
  return codes;
}

export function usePromos() {
  const [promos, set] = useState(_promos);
  useEffect(() => { set(_promos); _promoSubs.add(set); return () => { _promoSubs.delete(set); }; }, []);
  return promos;
}
