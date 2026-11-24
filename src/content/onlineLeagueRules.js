// Online League Rules - the text players read on americanpubpoker.online
// (owner decisions 2026-11-21: a free No-Limit Hold'em tournament Monday to
// Saturday at 6:00 PM MT, one re-entry, points like a live venue league, the
// top 5 each night earn a weekly qualifier credit, the nightly winner a free
// month in a chair at a live game).
//
// OWNER-APPROVED 2026-11-21 ("Use your picks"): change it only with the
// owner, then bump ONLINE_LEAGUE_RULES_UPDATED.
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
// So a line about points, credits or the prize shows only while the server
// gives them. Never write a rule here that the code does not do.
// Plain ASCII, short sentences, no dashes as asides (AGENT.md rule 20).
//
// Pure data, no imports: content/qualifierRules.js imports this module.

export const ONLINE_LEAGUE_RULES_TITLE = 'Online League Rules';

/** The line under the title of the rules window. */
export const ONLINE_LEAGUE_RULES_SUBTITLE = 'Monday to Saturday at 6:00 PM MT on americanpubpoker.online';

/** The day these rules were last changed (YYYY-MM-DD). */
export const ONLINE_LEAGUE_RULES_UPDATED = '2026-11-21';

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
      'Sign-up opens at 4:00 PM MT. Tap Register on the Online League card.',
      'Late entry and one re-entry are open until 7:00 PM MT.',
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
        text: 'The winner each night wins one free month (4 weekly games) in a chair at a live American Pub Poker game the winner chooses.',
      },
      {
        needs: ['leaguePrize'],
        text: 'No purchase, VIP or card is needed to claim it. The free month is never charged.',
      },
      {
        needs: ['leaguePrize'],
        text: "The prize depends on chair availability and the venue's own house rules, including age limits.",
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
