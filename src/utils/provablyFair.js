/**
 * 2026-10-24 (owner 2026-10-23: "Fix both") — the Provably Fair panel's view of
 * a hand's commitment / revelation (pure; components/ui/ProvablyFair.jsx).
 *
 * A newer poker-server keeps a RUNNING qualifier's deck seeds private until the
 * qualifier ends (the seed rebuilds every folded hand): its `deckCommitment`
 * frame carries `seedHeld: true`, and its /api/fairness answer for such a hand
 * is `{seed: null, seedHeld: true}`. The panel then says when the seed will be
 * shown — never a red / failed verification. An older server sends no flag:
 * everything reads as before.
 */
export const SEED_HELD_TEXT = 'Seed shown after the qualifier ends';
// Sit & Go fix-all F17 (owner 2026-10-23): the server holds the seeds of EVERY
// running tournament (Sit & Go, scheduled, club, Spin & Go) and says which kind
// (`seedHeldFor: 'qualifier' | 'tournament'`); without the key (the Saturday
// qualifier server) a held seed is a qualifier's, as before.
export const SEED_HELD_TOURNAMENT_TEXT = 'Seed shown after the tournament ends';
export const SEED_PENDING_TEXT = 'Seed will be revealed when this hand ends';

const hasText = (v) => typeof v === 'string' && v.length > 0;

/** The server says this hand's seed is held until the qualifier ends. */
export function seedIsHeld(x) {
  return !!x && typeof x === 'object' && x.seedHeld === true;
}

/** The held-seed line for this commitment / revelation (F17: by `seedHeldFor`). */
export function heldSeedText(x) {
  return x && typeof x === 'object' && x.seedHeldFor === 'tournament' ? SEED_HELD_TOURNAMENT_TEXT : SEED_HELD_TEXT;
}

/** The line under a commitment's hash. */
export function commitmentNote(commitment) {
  return seedIsHeld(commitment) ? heldSeedText(commitment) : SEED_PENDING_TEXT;
}

/** A revelation that can be checked: a seed and a hash, not held. */
export function revelationVerifiable(r) {
  return !!r && typeof r === 'object' && !seedIsHeld(r) && hasText(r.seed) && hasText(r.hash);
}

/** A revelation shown as HELD (flagged, or carrying no seed) — never as a failed verification. */
export function revelationHeld(r) {
  return !!r && typeof r === 'object' && (seedIsHeld(r) || !hasText(r.seed));
}
