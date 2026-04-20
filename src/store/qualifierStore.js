// Simple custom store for qualifiers — avoids Zustand/React19 useSyncExternalStore issues
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'poker-qualifiers';

export const DEFAULT_BLIND_STRUCTURE = [
  { type: 'level', sb: 25,   bb: 50,   ante: 0,    duration: 20 },
  { type: 'level', sb: 50,   bb: 100,  ante: 0,    duration: 20 },
  { type: 'level', sb: 75,   bb: 150,  ante: 25,   duration: 20 },
  { type: 'level', sb: 100,  bb: 200,  ante: 25,   duration: 20 },
  { type: 'level', sb: 150,  bb: 300,  ante: 50,   duration: 20 },
  { type: 'level', sb: 200,  bb: 400,  ante: 50,   duration: 20 },
  { type: 'level', sb: 300,  bb: 600,  ante: 75,   duration: 20 },
  { type: 'level', sb: 400,  bb: 800,  ante: 100,  duration: 20 },
  { type: 'level', sb: 500,  bb: 1000, ante: 100,  duration: 20 },
  { type: 'level', sb: 600,  bb: 1200, ante: 200,  duration: 20 },
  { type: 'level', sb: 800,  bb: 1600, ante: 200,  duration: 20 },
  { type: 'level', sb: 1000, bb: 2000, ante: 300,  duration: 20 },
  { type: 'level', sb: 1500, bb: 3000, ante: 500,  duration: 20 },
  { type: 'level', sb: 2000, bb: 4000, ante: 500,  duration: 20 },
  { type: 'level', sb: 3000, bb: 6000, ante: 1000, duration: 20 },
];

const DEFAULT_QUALIFIERS = [
  {
    id: 'weekly-qualifier',
    type: 'Weekly',
    name: 'Weekly Qualifier',
    icon: '🗓️',
    startingStack: 50000,
    maxPlayers: 999,
    registered: 0,
    registrants: [],
    scheduledAt: '2026-04-26T12:00:00.000Z',
    color: '#00D9FF',
    active: true,
    promotionId: null,
    recurrence: null,
    templateId: null,
    blindStructure: DEFAULT_BLIND_STRUCTURE,
  },
  {
    id: 'monthly-qualifier',
    type: 'Monthly',
    name: 'Monthly Major Qualifier',
    icon: '🏆',
    startingStack: 50000,
    maxPlayers: 999,
    registered: 0,
    registrants: [],
    scheduledAt: '2026-05-17T11:00:00.000Z',
    color: '#B388FF',
    active: true,
    promotionId: null,
    recurrence: null,
    templateId: null,
    blindStructure: DEFAULT_BLIND_STRUCTURE,
  },
];

// ── Recurrence helpers ────────────────────────────────────────────────────────

function get3rdSundayUTC(year, month) {
  let sundays = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(Date.UTC(year, month, d));
    if (date.getUTCMonth() !== month) break;
    if (date.getUTCDay() === 0) {
      sundays++;
      if (sundays === 3) return d;
    }
  }
  return 1;
}

// Returns array of ISO date strings for upcoming occurrences
function getOccurrenceDates(recurrence) {
  if (!recurrence?.enabled) return [];
  const now = new Date();
  const horizon = new Date(now.getTime() + 180 * 86400000); // 6-month lookahead cap
  const end = recurrence.endDate
    ? new Date(Math.min(new Date(recurrence.endDate + 'T23:59:59Z').getTime(), horizon.getTime()))
    : horizon;
  const [hh, mm] = (recurrence.time || '12:00').split(':').map(Number);
  const dates = [];

  if (recurrence.type === 'weekly') {
    const dow = recurrence.dayOfWeek ?? 6; // default Saturday
    // Start from today; advance to the right weekday
    let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0));
    while (d.getUTCDay() !== dow) d = new Date(d.getTime() + 86400000);
    // If that day is today but in the past, skip to next week
    if (d <= now) d = new Date(d.getTime() + 7 * 86400000);
    while (d <= end) {
      dates.push(d.toISOString());
      d = new Date(d.getTime() + 7 * 86400000);
    }
  } else if (recurrence.type === 'monthly-3rd-sunday') {
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth();
    for (let i = 0; i < 24; i++) {
      const day = get3rdSundayUTC(year, month);
      const d = new Date(Date.UTC(year, month, day, hh, mm, 0));
      if (d > now && d <= end) dates.push(d.toISOString());
      month++;
      if (month > 11) { month = 0; year++; }
      const nextMonthStart = new Date(Date.UTC(year, month, 1));
      if (nextMonthStart > end) break;
    }
  }

  return dates;
}

// ── Storage ──────────────────────────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

function saveToStorage(qualifiers) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(qualifiers)); } catch (_) {}
}

// ── Auto-advance past-due default qualifiers ────────────────────────────────
// If the weekly/monthly qualifier's scheduledAt is in the past (because the
// event didn't run or wasn't rescheduled), advance it to the next occurrence.
// This prevents "Sun 19 Apr — Starting soon" from persisting after Apr 19.
function nextSundayUTC(from = new Date(), hour = 12, minute = 0) {
  const d = new Date(from);
  d.setUTCHours(hour, minute, 0, 0);
  // If today is Sunday and the time has already passed, roll to next Sunday
  const isSunday = d.getUTCDay() === 0;
  if (!isSunday || d <= from) {
    const daysUntilSunday = (7 - d.getUTCDay()) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  }
  return d.toISOString();
}

function nextThirdSundayUTC(from = new Date(), hour = 11, minute = 0) {
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  while (true) {
    const day = get3rdSundayUTC(year, month);
    const candidate = new Date(Date.UTC(year, month, day, hour, minute, 0));
    if (candidate > from) return candidate.toISOString();
    // Roll to next month
    month++;
    if (month > 11) { month = 0; year++; }
  }
}

function advancePastDueDefaults(qualifiers) {
  const now = new Date();
  let changed = false;
  const updated = qualifiers.map((q) => {
    if (!q?.scheduledAt || q.templateId) return q; // skip instances of templates
    const scheduled = new Date(q.scheduledAt);
    if (isNaN(scheduled.getTime()) || scheduled > now) return q;
    if (q.id === 'weekly-qualifier') {
      changed = true;
      return { ...q, scheduledAt: nextSundayUTC(now, 12, 0), registered: 0, registrants: [] };
    }
    if (q.id === 'monthly-qualifier') {
      changed = true;
      return { ...q, scheduledAt: nextThirdSundayUTC(now, 11, 0), registered: 0, registrants: [] };
    }
    return q;
  });
  return { qualifiers: updated, changed };
}

// ── Store ─────────────────────────────────────────────────────────────────────

let _qualifiers = loadFromStorage() || DEFAULT_QUALIFIERS;
{
  const { qualifiers, changed } = advancePastDueDefaults(_qualifiers);
  if (changed) {
    _qualifiers = qualifiers;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_qualifiers)); } catch {}
  }
}
const _subscribers = new Set();

function notify() {
  _subscribers.forEach((fn) => fn(_qualifiers));
}

// Generate instances for all template qualifiers; call on init and on demand
function syncRecurring() {
  const templates = _qualifiers.filter((q) => q.recurrence?.enabled);
  if (templates.length === 0) return;

  let changed = false;
  templates.forEach((tmpl) => {
    const dates = getOccurrenceDates(tmpl.recurrence);
    dates.forEach((iso) => {
      const instanceId = `${tmpl.id}::${iso.slice(0, 10)}`;
      const exists = _qualifiers.some((q) => q.id === instanceId);
      if (!exists) {
        _qualifiers = [..._qualifiers, {
          ...tmpl,
          id: instanceId,
          templateId: tmpl.id,
          scheduledAt: iso,
          registered: 0,
          registrants: [],
          recurrence: null, // instances don't recurse
          active: true,
        }];
        changed = true;
      }
    });
  });

  if (changed) {
    saveToStorage(_qualifiers);
    notify();
  }
}

// Run on init
syncRecurring();

export const qualifierActions = {
  getAll: () => _qualifiers,

  add: (q) => {
    const newQ = { ...q, id: `qualifier-${Date.now()}`, registered: 0, registrants: [], active: true, templateId: null };
    _qualifiers = [..._qualifiers, newQ];
    saveToStorage(_qualifiers);
    notify();
    // If it has recurrence, immediately generate instances
    if (newQ.recurrence?.enabled) syncRecurring();
  },

  update: (id, changes) => {
    _qualifiers = _qualifiers.map((q) => q.id === id ? { ...q, ...changes } : q);
    saveToStorage(_qualifiers);
    notify();
    // Re-sync if recurrence changed
    if (changes.recurrence !== undefined) syncRecurring();
  },

  delete: (id) => {
    // Also delete any instances of this template
    _qualifiers = _qualifiers.filter((q) => q.id !== id && q.templateId !== id);
    saveToStorage(_qualifiers);
    notify();
  },

  toggleActive: (id) => {
    _qualifiers = _qualifiers.map((q) => q.id === id ? { ...q, active: !q.active } : q);
    saveToStorage(_qualifiers);
    notify();
  },

  register: (qualifierId, playerName) => {
    _qualifiers = _qualifiers.map((q) => {
      if (q.id !== qualifierId) return q;
      const existing = q.registrants || [];
      if (existing.includes(playerName)) return q; // already registered, don't double-count
      return { ...q, registrants: [...existing, playerName], registered: (q.registered || 0) + 1 };
    });
    saveToStorage(_qualifiers);
    notify();
  },

  removeRegistrant: (qualifierId, playerName) => {
    _qualifiers = _qualifiers.map((q) => {
      if (q.id !== qualifierId) return q;
      const existing = q.registrants || [];
      if (!existing.includes(playerName)) return q; // not registered, nothing to remove
      return { ...q, registrants: existing.filter((r) => r !== playerName), registered: Math.max(0, (q.registered || 0) - 1) };
    });
    saveToStorage(_qualifiers);
    notify();
  },

  syncRecurring,
};

export function useQualifiers() {
  const [qualifiers, setQualifiers] = useState(_qualifiers);

  useEffect(() => {
    setQualifiers(_qualifiers);
    _subscribers.add(setQualifiers);
    return () => { _subscribers.delete(setQualifiers); };
  }, []);

  return qualifiers;
}
