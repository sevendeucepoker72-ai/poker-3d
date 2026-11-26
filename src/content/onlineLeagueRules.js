// Online League Rules - the text players read on americanpubpoker.online
// (owner decisions 2026-11-21: a free No-Limit Hold'em tournament Monday to
// Saturday at 6:00 PM MT, one re-entry, points like a live venue league, the
// top 5 each night earn a weekly qualifier credit, the nightly winner a
// 1-month seat subscription to a live game).
//
// OWNER-APPROVED 2026-11-21 ("Use your picks"): change it only with the
// owner, then bump ONLINE_LEAGUE_RULES_UPDATED.
// Owner change 2026-11-25 ("signup should be 3 hours before"): sign-up opens
// at 3:00 PM MT (was 4:00 PM), matching poker-server 32533fe
// ONLINE_LEAGUE_SIGNUP_OPENS_BEFORE_MS = 3 h. Nothing else in the text changed.
// Owner change 2026-11-25 ("It should be more clear its a 1month seat
// subscription to a live game"): the prize lines name the prize a "1-month
// seat subscription" (one month of the player app's paid seat subscription),
// never "a free month in a chair". Only the prize description changed.
// Owner change 2026-11-25 ("It currently says if your not online at start you
// are removed. It should seat you and blind you out", Online League only): a
// registrant not online at the start is seated and blinded out, never
// released (poker-server qualifierNoShow.noShowsSeatedAbsent). Two Schedule
// lines added.
// Owner orders 2026-11-25 (FIX 2, every tournament): nobody can sit out more
// than 30 hands in a row; a no-show is protected until late entry closes at
// 7:00 PM MT and, if still away then, removed at the first hand end after it,
// whatever his count (he finishes in the next place, like a bust). Two
// Schedule lines added after the no-show lines, shown only while the league
// item carries the server's sitOutLimitHands (key sitOutLimitHands /
// sitOutLimitNth). A no-show is still never "released". The 30-hand line
// starts "Once you have taken your seat" (review fix 2026-11-26): before
// 7:00 PM a registrant who never arrived is not removed at 30.
// Owner rule 2026-11-25 ~11:15 PM MT ("A player who is seated before 6 and
// then leaves before never played a hand so they should get the 1st hour to
// play a hand"), replacing "never arrived": the first hour belongs to every
// entrant who HAS NOT PLAYED A HAND YET in this event (away at the start, sat
// in the early rooms and left, at another table, late-registered and left).
// A sign-in / seat restore alone is not playing a hand. Once he has played a
// hand the protection is gone for good in this event (a re-entry does not
// bring it back). So the two FIX 2 lines say "If you have not played a hand
// yet" / "Once you have played a hand", never "taken your seat". The two
// no-show lines above them are locked word for word.
//
// Same shape as content/qualifierRules.js QUALIFIER_RULES, so the same rules
// window (components/ui/QualifierRules.jsx) renders it: [{ heading, rules }],
// a rule is a plain string or { needs, text, otherwise }. The keys this page
// uses (content/qualifierRules.js qualifierRulesContext, from the league item
// the player opened the rules from):
//   leaguePoints    the server says the night's points are on
//   leaguePrize     the server says the winner's chair prize is on
//   leagueMinField  the server set a minimum number of finishers for the
//                   night's weekly credits + prize ({leagueMinField}); absent
//                   = no minimum
//   sitOutLimitHands the server removes a player after this many hands in a
//                   row sitting out, and an entrant who has not played a
//                   hand yet and is still away when late entry closes
//                   ({sitOutLimitHands}, {sitOutLimitNth});
//                   absent = no such line
// So a line about points, credits or the prize shows only while the server
// gives them. Never write a rule here that the code does not do.
// Plain ASCII, short sentences, no dashes as asides (AGENT.md rule 20).
//
// Pure data, no imports: content/qualifierRules.js imports this module.

export const ONLINE_LEAGUE_RULES_TITLE = 'Online League Rules';

/** The line under the title of the rules window. */
export const ONLINE_LEAGUE_RULES_SUBTITLE = 'Monday to Saturday at 6:00 PM MT on americanpubpoker.online';

/** The day these rules were last changed (YYYY-MM-DD). */
export const ONLINE_LEAGUE_RULES_UPDATED = '2026-11-26';

export const ONLINE_LEAGUE_RULES = [
  {
    heading: 'Free to enter',
    rules: [
      'The Online League is free. No purchase or payment of any kind is needed to enter, play or win.',
      'Buying chips, VIP or anything else gives no advantage.',
      'Chips are play money with no cash value.',
    ],
  },
  {
    heading: 'Who can play',
    rules: [
      'Open to anyone signed in on americanpubpoker.online with an American Pub Poker account.',
      'One account per person.',
    ],
  },
  {
    heading: 'Schedule',
    rules: [
      'The Online League plays Monday to Saturday at 6:00 PM MT.',
      'Sign-up opens at 3:00 PM MT. Tap Register on the Online League card.',
      'Late entry and one re-entry are open until 7:00 PM MT.',
      'If you registered but are not online when it starts, you are still seated and blinded out.',
      'You are dealt in and your blinds are posted until you sign in on americanpubpoker.online and take your seat.',
      // Owner rule 2026-11-25 ~11:15 PM MT: the first hour is for anyone who
      // has not played a hand yet (not only a registrant who never arrived).
      {
        needs: ['sitOutLimitHands'],
        text: 'If you have not played a hand yet, you have until late entry closes at 7:00 PM MT. If you are still away then, you are removed and finish in the next place.',
      },
      // Review fix (2026-11-26): not "Nobody can sit out more than ..." - an
      // entrant who has not played a hand yet is protected until 7:00 PM MT
      // and can sit out more than that many hands before then (the line above
      // covers him). Owner rule 2026-11-25 ~11:15 PM MT: the limit binds once
      // he has PLAYED a hand, never merely once he has taken his seat.
      {
        needs: ['sitOutLimitHands'],
        text: "Once you have played a hand, you can't sit out more than {sitOutLimitHands} hands in a row. On the {sitOutLimitNth} hand you are removed and finish in the next place.",
      },
      'Levels are 10 minutes long, with a 5-minute break after every 5 levels.',
      'All times are Mountain Time (MT).',
    ],
  },
  {
    heading: 'Points and weekly credits',
    rules: [
      {
        needs: ['leaguePoints'],
        text: 'Points use the same points table as the live American Pub Poker leagues. Your points post to the Online League standings.',
      },
      {
        needs: ['leaguePoints'],
        text: 'The top 5 each night earn a weekly qualifier credit for the Sunday Weekly Qualifier.',
      },
      {
        needs: ['leaguePoints', 'leagueMinField'],
        text: 'On a night with fewer than {leagueMinField} finishers, points still count, but no weekly qualifier credits or prizes are given.',
      },
    ],
  },
  {
    heading: "Nightly winner's prize",
    rules: [
      {
        needs: ['leaguePrize'],
        text: 'The winner each night gets a 1-month seat subscription (4 weekly games) to a live American Pub Poker game the winner chooses.',
      },
      {
        needs: ['leaguePrize'],
        text: 'No purchase, VIP or card is needed to claim it. The 1-month seat subscription is never charged.',
      },
      {
        needs: ['leaguePrize'],
        text: "The prize depends on seat availability and the venue's own house rules, including age limits.",
      },
      {
        needs: ['leaguePrize'],
        text: 'It has no cash value and cannot be transferred. Claim it in the American Pub Poker app within 90 days.',
      },
    ],
  },
  {
    heading: 'Fair play',
    rules: [
      'American Pub Poker may void points, credits or prizes for multiple accounts, collusion or cheating.',
    ],
  },
];
