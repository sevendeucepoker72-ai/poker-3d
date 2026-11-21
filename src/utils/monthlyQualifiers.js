/**
 * The MONTHLY online qualifier is hidden on americanpubpoker.online.
 *
 * Owner 2026-11-21, said twice: "I said turn them off. Don't show them at
 * all." / "Do not show the monthly qualifiers." The events are switched off on
 * the server (mono fcb1cfbe: GET /qualifiers/schedule drops type monthly /
 * console_monthly unless MONTHLY_QUALIFIERS_ONLINE=1); this flag hides every
 * player-facing mention of them in this app: list rows, the home card and its
 * cancelled card, "Monthly Major", "the top 10% advance to the monthly", the
 * 3rd-Saturday schedule, monthly credit lines, the rules' monthly lines, a
 * no-show notice naming a monthly event and a monthly event on the broadcast
 * page (broadcast.html shows its slate).
 *
 * Set MONTHLY_QUALIFIERS_SHOWN = true to show them again: every gated path is
 * still in the code and the original sentences come back.
 *
 * NOT this flag (left as they are): the VIP monthly bonus (claimVipMonthly,
 * "Collect monthly VIP bonus"), the Monthly VIP pass, monthly leaderboards and
 * the monthly season, the weekly qualifier, championship seats, and the staff
 * tools (AdminDashboard, the producer panel's EventPicker, broadcast ?ch=
 * URLs and the identify overlay).
 *
 * Pure (no React, no store, no import.meta): the lobby, the rules, the
 * broadcast scene machine and node:test import it.
 */

// owner 2026-11-21; set true to show the monthly qualifiers again.
export const MONTHLY_QUALIFIERS_SHOWN = false;

const MONTHLY_RE = /monthly/i;

function saysMonthly(v) {
  return typeof v === 'string' && MONTHLY_RE.test(v);
}

/**
 * A qualifier list item, a broadcast event or a qualifier notice that is the
 * MONTHLY qualifier: its type ('monthly' / 'console_monthly', the test
 * poker-server's qualifierKind uses), its kind, or its name / title says so.
 */
export function isMonthlyQualifier(item) {
  if (!item || typeof item !== 'object') return false;
  return [item.type, item.qualifierType, item.kind, item.name, item.qualifierName, item.title].some(saysMonthly);
}

/** This qualifier is hidden right now. `shown` is the flag (tests pass true to see it on). */
export function monthlyQualifierHidden(item, shown = MONTHLY_QUALIFIERS_SHOWN) {
  return !shown && isMonthlyQualifier(item);
}

/** The list without the hidden monthly qualifiers (the same array when none is hidden). */
export function withoutHiddenMonthlyQualifiers(list, shown = MONTHLY_QUALIFIERS_SHOWN) {
  if (!Array.isArray(list)) return [];
  if (shown) return list;
  const out = list.filter((q) => !isMonthlyQualifier(q));
  return out.length === list.length ? list : out;
}

/**
 * The broadcast program is a monthly qualifier's (channel 'monthly', event key
 * 'next:monthly' / 'ch:monthly', or its event) and is hidden: broadcast.html
 * shows the slate instead (model/sceneMachine.js chooseScene).
 */
export function broadcastMonthlyHidden(program, shown = MONTHLY_QUALIFIERS_SHOWN) {
  if (shown || !program || typeof program !== 'object') return false;
  if (program.channel === 'monthly' || saysMonthly(program.eventKey)) return true;
  return isMonthlyQualifier(program.event);
}
