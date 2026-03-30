import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import './ClubsPanel.css';

// ─── Role badge colors ───
const ROLE_COLORS = {
  owner: '#FFD700',
  manager: '#60A5FA',
  member: '#6b6b8a',
};

const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  member: 'Member',
};

const VARIANT_OPTIONS = [
  { value: 'texas-holdem', label: "Texas Hold'em" },
  { value: 'omaha', label: 'Omaha' },
  { value: 'omaha-hi-lo', label: 'Omaha Hi-Lo' },
  { value: 'short-deck', label: 'Short Deck' },
  { value: 'five-card-draw', label: '5-Card Draw' },
  { value: 'seven-card-stud', label: '7-Card Stud' },
];

// ─── Sub-Components ───

function RoleBadge({ role }) {
  return (
    <span
      className="club-role-badge"
      style={{ color: ROLE_COLORS[role] || '#6b6b8a', borderColor: ROLE_COLORS[role] || '#6b6b8a' }}
    >
      {ROLE_LABELS[role] || role}
    </span>
  );
}

function ClubCodeDisplay({ code }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <span className="club-code-display" onClick={handleCopy} title="Click to copy">
      <span className="club-code-text">{code}</span>
      <span className="club-code-copy">{copied ? 'Copied!' : 'Copy'}</span>
    </span>
  );
}

// ═══════════════════════════════════════════
// MAIN CLUBS PANEL
// ═══════════════════════════════════════════

export default function ClubsPanel({ onClose }) {
  const playerName = useGameStore((s) => s.playerName);
  const avatar = useGameStore((s) => s.avatar);
  const joinTable = useTableStore((s) => s.joinTable);

  // View state
  const [view, setView] = useState('list'); // 'list' | 'detail' | 'create' | 'join'
  const [selectedClub, setSelectedClub] = useState(null);
  const [detailTab, setDetailTab] = useState('tables');

  // Data
  const [myClubs, setMyClubs] = useState([]);
  const [clubMembers, setClubMembers] = useState([]);
  const [clubTables, setClubTables] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Create club form
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createMaxMembers, setCreateMaxMembers] = useState(100);
  const [createRequireApproval, setCreateRequireApproval] = useState(false);
  const [createRake, setCreateRake] = useState(0);

  // Join club form
  const [joinCode, setJoinCode] = useState('');

  // Create table form
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [tableName, setTableName] = useState('');
  const [tableVariant, setTableVariant] = useState('texas-holdem');
  const [tableSB, setTableSB] = useState(25);
  const [tableBB, setTableBB] = useState(50);
  const [tableMinBuy, setTableMinBuy] = useState(1000);
  const [tableMaxBuy, setTableMaxBuy] = useState(5000);
  const [tableMaxSeats, setTableMaxSeats] = useState(9);

  // Settings form
  const [settingsName, setSettingsName] = useState('');
  const [settingsDesc, setSettingsDesc] = useState('');
  const [settingsRake, setSettingsRake] = useState(0);
  const [settingsMaxMembers, setSettingsMaxMembers] = useState(100);
  const [settingsRequireApproval, setSettingsRequireApproval] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [announcements, setAnnouncements] = useState([]);
  const chatEndRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState('alltime');

  // Activity feed
  const [activityFeed, setActivityFeed] = useState([]);

  // Club statistics
  const [clubStats, setClubStats] = useState(null);

  // Announcement form
  const [announcementText, setAnnouncementText] = useState('');

  // Tournaments
  const [clubTournaments, setClubTournaments] = useState([]);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [tourneyName, setTourneyName] = useState('');
  const [tourneyFormat, setTourneyFormat] = useState('freezeout');
  const [tourneyBuyIn, setTourneyBuyIn] = useState(100);
  const [tourneyStartingChips, setTourneyStartingChips] = useState(5000);
  const [tourneyMaxPlayers, setTourneyMaxPlayers] = useState(20);
  const [tourneyScheduledAt, setTourneyScheduledAt] = useState('');

  // Challenges
  const [clubChallenges, setClubChallenges] = useState([]);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [challengeTargetId, setChallengeTargetId] = useState(null);
  const [challengeTargetName, setChallengeTargetName] = useState('');
  const [challengeStakes, setChallengeStakes] = useState(100);

  // Scheduled tables
  const [scheduledTables, setScheduledTables] = useState([]);
  const [showScheduleTable, setShowScheduleTable] = useState(false);
  const [schedTableName, setSchedTableName] = useState('');
  const [schedTableVariant, setSchedTableVariant] = useState('texas-holdem');
  const [schedTableSB, setSchedTableSB] = useState(25);
  const [schedTableBB, setSchedTableBB] = useState(50);
  const [schedTableMinBuy, setSchedTableMinBuy] = useState(1000);
  const [schedTableMaxBuy, setSchedTableMaxBuy] = useState(5000);
  const [schedTableTime, setSchedTableTime] = useState('');
  const [schedTableRecurring, setSchedTableRecurring] = useState(false);
  const [schedTableRecurrence, setSchedTableRecurrence] = useState('daily');

  // Blind structures
  const [blindStructures, setBlindStructures] = useState([]);
  const [showCreateBlindStructure, setShowCreateBlindStructure] = useState(false);
  const [blindStructureName, setBlindStructureName] = useState('');
  const [blindStructureLevels, setBlindStructureLevels] = useState([
    { smallBlind: 25, bigBlind: 50, ante: 0, durationMinutes: 15 },
  ]);

  // Invitations (Feature 10)
  const [myInvitations, setMyInvitations] = useState([]);
  const [inviteUsername, setInviteUsername] = useState('');

  // Unions (Feature 11)
  const [unionInfo, setUnionInfo] = useState(null);
  const [unionName, setUnionName] = useState('');
  const [unionDesc, setUnionDesc] = useState('');

  // Member Profile (Feature 12)
  const [memberProfile, setMemberProfile] = useState(null);
  const [showMemberProfile, setShowMemberProfile] = useState(false);

  // Club Badge (Feature 13)
  const [selectedBadge, setSelectedBadge] = useState('♠');

  // Referral (Feature 14)
  const [referralCode, setReferralCode] = useState('');
  const [referralStats, setReferralStats] = useState(null);
  const [referralJoinCode, setReferralJoinCode] = useState('');

  // Club Level (Feature 15)
  const [clubLevelInfo, setClubLevelInfo] = useState(null);

  // Featured Clubs (Feature 16)
  const [featuredClubs, setFeaturedClubs] = useState([]);
  const [clubOfWeek, setClubOfWeek] = useState(null);

  const BADGE_OPTIONS = ['♠', '♥', '♦', '♣', '🃏', '🎰', '🎲', '🏆', '👑', '💎', '🔥', '⚡'];

  // ─── Socket listeners ───
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onMyClubs = (data) => {
      setLoading(false);
      if (data.success) setMyClubs(data.clubs || []);
    };

    const onClubCreated = (data) => {
      setLoading(false);
      if (data.success && data.club) {
        setMyClubs((prev) => [data.club, ...prev]);
        setView('list');
        setError('');
      }
    };

    const onClubJoined = (data) => {
      setLoading(false);
      if (data.success) {
        if (data.status === 'pending') {
          setError('Join request sent! Waiting for approval.');
        } else {
          setError('');
          // Refresh clubs list
          socket.emit('getMyClubs');
        }
        setView('list');
        setJoinCode('');
      }
    };

    const onClubLeft = (data) => {
      setMyClubs((prev) => prev.filter((c) => c.id !== data.clubId));
      setView('list');
      setSelectedClub(null);
    };

    const onClubMembers = (data) => {
      if (data.success) setClubMembers(data.members || []);
    };

    const onClubTables = (data) => {
      if (data.success) setClubTables(data.tables || []);
    };

    const onClubTableCreated = (data) => {
      setLoading(false);
      if (data.success && data.table) {
        setClubTables((prev) => [...prev, data.table]);
        setShowCreateTable(false);
        resetTableForm();
      }
    };

    const onMemberApproved = () => {
      if (selectedClub) socket.emit('getClubMembers', { clubId: selectedClub.id });
    };

    const onMemberRemoved = () => {
      if (selectedClub) socket.emit('getClubMembers', { clubId: selectedClub.id });
    };

    const onMemberPromoted = () => {
      if (selectedClub) socket.emit('getClubMembers', { clubId: selectedClub.id });
    };

    const onClubSettingsUpdated = (data) => {
      setLoading(false);
      if (data.success && data.club) {
        setSelectedClub(data.club);
        setMyClubs((prev) => prev.map((c) => (c.id === data.club.id ? data.club : c)));
      }
    };

    const onClubDeleted = (data) => {
      setMyClubs((prev) => prev.filter((c) => c.id !== data.clubId));
      setView('list');
      setSelectedClub(null);
    };

    const onClubSearchResults = (data) => {
      setLoading(false);
      if (data.success) setSearchResults(data.clubs || []);
    };

    const onError = (data) => {
      setLoading(false);
      setError(data.message || 'An error occurred');
    };

    // Chat listeners
    const onClubMessage = (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    };

    const onClubMessages = (data) => {
      if (data.success) setChatMessages(data.messages || []);
    };

    const onClubAnnouncements = (data) => {
      if (data.success) setAnnouncements(data.announcements || []);
    };

    const onClubMessagePinned = (data) => {
      setChatMessages((prev) => prev.map((m) =>
        m.id === data.messageId ? { ...m, isPinned: data.pinned ? 1 : 0 } : m
      ));
    };

    // Leaderboard listener
    const onClubLeaderboard = (data) => {
      if (data.success) setLeaderboard(data.leaderboard || []);
    };

    // Statistics listener
    const onClubStatistics = (data) => {
      if (data.success) setClubStats(data.statistics || null);
    };

    // Activity listener
    const onClubActivity = (data) => {
      if (data.success) setActivityFeed(data.activities || []);
    };

    // Tournament listeners
    const onClubTournaments = (data) => {
      if (data.success) setClubTournaments(data.tournaments || []);
    };
    const onClubTournamentCreated = (data) => {
      setLoading(false);
      if (data.success && data.tournament) {
        setClubTournaments((prev) => [data.tournament, ...prev]);
        setShowCreateTournament(false);
      }
    };
    const onClubTournamentRegistered = (data) => {
      if (selectedClub) {
        const s = getSocket();
        if (s) s.emit('getClubTournaments', { clubId: selectedClub.id });
      }
    };
    const onClubTournamentStarted = () => {
      if (selectedClub) {
        const s = getSocket();
        if (s) s.emit('getClubTournaments', { clubId: selectedClub.id });
      }
    };

    // Challenge listeners
    const onClubChallenges = (data) => {
      if (data.success) setClubChallenges(data.challenges || []);
    };
    const onClubChallengeCreated = (data) => {
      setLoading(false);
      if (data.success && data.challenge) {
        setClubChallenges((prev) => [data.challenge, ...prev]);
        setShowChallengeModal(false);
      }
    };
    const onClubChallengeAccepted = () => {
      if (selectedClub) {
        const s = getSocket();
        if (s) s.emit('getClubChallenges', { clubId: selectedClub.id });
      }
    };
    const onClubChallengeDeclined = () => {
      if (selectedClub) {
        const s = getSocket();
        if (s) s.emit('getClubChallenges', { clubId: selectedClub.id });
      }
    };

    // Scheduled table listeners
    const onScheduledClubTables = (data) => {
      if (data.success) setScheduledTables(data.scheduledTables || []);
    };
    const onClubTableScheduled = (data) => {
      setLoading(false);
      if (data.success && data.scheduledTable) {
        setScheduledTables((prev) => [...prev, data.scheduledTable]);
        setShowScheduleTable(false);
      }
    };
    const onScheduledClubTableActivated = () => {
      if (selectedClub) {
        const s = getSocket();
        if (s) s.emit('getScheduledClubTables', { clubId: selectedClub.id });
      }
    };
    const onScheduledClubTableDeleted = (data) => {
      setScheduledTables((prev) => prev.filter((t) => t.id !== data.id));
    };

    // Blind structure listeners
    const onBlindStructures = (data) => {
      if (data.success) setBlindStructures(data.structures || []);
    };
    const onBlindStructureCreated = (data) => {
      setLoading(false);
      if (data.success && data.structure) {
        setBlindStructures((prev) => [data.structure, ...prev]);
        setShowCreateBlindStructure(false);
      }
    };
    const onBlindStructureDeleted = (data) => {
      setBlindStructures((prev) => prev.filter((s) => s.id !== data.id));
    };

    // Feature 10: Invitations
    const onMyInvitations = (data) => {
      if (data.success) setMyInvitations(data.invitations || []);
    };
    const onInvitationSent = (data) => {
      setLoading(false);
      if (data.success) { setInviteUsername(''); setError(''); }
    };
    const onInvitationAccepted = (data) => {
      if (data.success) {
        setMyInvitations((prev) => prev.filter((inv) => inv.id !== data.invitationId));
        socket.emit('getMyClubs');
      }
    };
    const onInvitationDeclined = (data) => {
      setMyInvitations((prev) => prev.filter((inv) => inv.id !== data.invitationId));
    };

    // Feature 11: Unions
    const onUnionCreated = (data) => {
      setLoading(false);
      if (data.success && data.union) setUnionInfo(data.union);
    };
    const onUnionInfoReceived = (data) => {
      if (data.success) setUnionInfo(data.union || null);
    };

    // Feature 12: Member Profile
    const onMemberProfileReceived = (data) => {
      if (data.success && data.profile) {
        setMemberProfile(data.profile);
        setShowMemberProfile(true);
      }
    };

    // Feature 13: Badge
    const onClubBadgeUpdated = (data) => {
      if (data.clubId && data.badge) {
        setSelectedBadge(data.badge);
        if (selectedClub && selectedClub.id === data.clubId) {
          setSelectedClub((prev) => prev ? { ...prev, badge: data.badge } : prev);
        }
        setMyClubs((prev) => prev.map((c) => c.id === data.clubId ? { ...c, badge: data.badge } : c));
      }
    };

    // Feature 14: Referral
    const onReferralCode = (data) => {
      if (data.success && data.referralCode) setReferralCode(data.referralCode);
    };
    const onReferralJoined = (data) => {
      setLoading(false);
      if (data.success) {
        setReferralJoinCode('');
        socket.emit('getMyClubs');
      }
    };
    const onReferralStatsReceived = (data) => {
      if (data.success) setReferralStats(data);
    };

    // Feature 15: Club Level
    const onClubLevel = (data) => {
      if (data.success) setClubLevelInfo(data);
    };

    // Feature 16: Featured Clubs
    const onFeaturedClubs = (data) => {
      if (data.success) {
        setFeaturedClubs(data.clubs || []);
        setClubOfWeek(data.clubOfWeek || null);
      }
    };

    socket.on('myClubs', onMyClubs);
    socket.on('clubCreated', onClubCreated);
    socket.on('clubJoined', onClubJoined);
    socket.on('clubLeft', onClubLeft);
    socket.on('clubMembers', onClubMembers);
    socket.on('clubTables', onClubTables);
    socket.on('clubTableCreated', onClubTableCreated);
    socket.on('memberApproved', onMemberApproved);
    socket.on('memberRemoved', onMemberRemoved);
    socket.on('memberPromoted', onMemberPromoted);
    socket.on('clubSettingsUpdated', onClubSettingsUpdated);
    socket.on('clubDeleted', onClubDeleted);
    socket.on('clubSearchResults', onClubSearchResults);
    socket.on('clubMessage', onClubMessage);
    socket.on('clubMessages', onClubMessages);
    socket.on('clubAnnouncements', onClubAnnouncements);
    socket.on('clubMessagePinned', onClubMessagePinned);
    socket.on('clubLeaderboard', onClubLeaderboard);
    socket.on('clubStatistics', onClubStatistics);
    socket.on('clubActivity', onClubActivity);
    socket.on('clubTournaments', onClubTournaments);
    socket.on('clubTournamentCreated', onClubTournamentCreated);
    socket.on('clubTournamentRegistered', onClubTournamentRegistered);
    socket.on('clubTournamentStarted', onClubTournamentStarted);
    socket.on('clubChallenges', onClubChallenges);
    socket.on('clubChallengeCreated', onClubChallengeCreated);
    socket.on('clubChallengeAccepted', onClubChallengeAccepted);
    socket.on('clubChallengeDeclined', onClubChallengeDeclined);
    socket.on('scheduledClubTables', onScheduledClubTables);
    socket.on('clubTableScheduled', onClubTableScheduled);
    socket.on('scheduledClubTableActivated', onScheduledClubTableActivated);
    socket.on('scheduledClubTableDeleted', onScheduledClubTableDeleted);
    socket.on('blindStructures', onBlindStructures);
    socket.on('blindStructureCreated', onBlindStructureCreated);
    socket.on('blindStructureDeleted', onBlindStructureDeleted);
    socket.on('myInvitations', onMyInvitations);
    socket.on('invitationSent', onInvitationSent);
    socket.on('invitationAccepted', onInvitationAccepted);
    socket.on('invitationDeclined', onInvitationDeclined);
    socket.on('unionCreated', onUnionCreated);
    socket.on('unionInfo', onUnionInfoReceived);
    socket.on('memberProfile', onMemberProfileReceived);
    socket.on('clubBadgeUpdated', onClubBadgeUpdated);
    socket.on('referralCode', onReferralCode);
    socket.on('referralJoined', onReferralJoined);
    socket.on('referralStats', onReferralStatsReceived);
    socket.on('clubLevel', onClubLevel);
    socket.on('featuredClubs', onFeaturedClubs);
    socket.on('error', onError);

    // Initial fetch
    socket.emit('getMyClubs');
    socket.emit('getMyInvitations');
    socket.emit('getFeaturedClubs');
    setLoading(true);

    return () => {
      socket.off('myClubs', onMyClubs);
      socket.off('clubCreated', onClubCreated);
      socket.off('clubJoined', onClubJoined);
      socket.off('clubLeft', onClubLeft);
      socket.off('clubMembers', onClubMembers);
      socket.off('clubTables', onClubTables);
      socket.off('clubTableCreated', onClubTableCreated);
      socket.off('memberApproved', onMemberApproved);
      socket.off('memberRemoved', onMemberRemoved);
      socket.off('memberPromoted', onMemberPromoted);
      socket.off('clubSettingsUpdated', onClubSettingsUpdated);
      socket.off('clubDeleted', onClubDeleted);
      socket.off('clubSearchResults', onClubSearchResults);
      socket.off('clubMessage', onClubMessage);
      socket.off('clubMessages', onClubMessages);
      socket.off('clubAnnouncements', onClubAnnouncements);
      socket.off('clubMessagePinned', onClubMessagePinned);
      socket.off('clubLeaderboard', onClubLeaderboard);
      socket.off('clubStatistics', onClubStatistics);
      socket.off('clubActivity', onClubActivity);
      socket.off('clubTournaments', onClubTournaments);
      socket.off('clubTournamentCreated', onClubTournamentCreated);
      socket.off('clubTournamentRegistered', onClubTournamentRegistered);
      socket.off('clubTournamentStarted', onClubTournamentStarted);
      socket.off('clubChallenges', onClubChallenges);
      socket.off('clubChallengeCreated', onClubChallengeCreated);
      socket.off('clubChallengeAccepted', onClubChallengeAccepted);
      socket.off('clubChallengeDeclined', onClubChallengeDeclined);
      socket.off('scheduledClubTables', onScheduledClubTables);
      socket.off('clubTableScheduled', onClubTableScheduled);
      socket.off('scheduledClubTableActivated', onScheduledClubTableActivated);
      socket.off('scheduledClubTableDeleted', onScheduledClubTableDeleted);
      socket.off('blindStructures', onBlindStructures);
      socket.off('blindStructureCreated', onBlindStructureCreated);
      socket.off('blindStructureDeleted', onBlindStructureDeleted);
      socket.off('myInvitations', onMyInvitations);
      socket.off('invitationSent', onInvitationSent);
      socket.off('invitationAccepted', onInvitationAccepted);
      socket.off('invitationDeclined', onInvitationDeclined);
      socket.off('unionCreated', onUnionCreated);
      socket.off('unionInfo', onUnionInfoReceived);
      socket.off('memberProfile', onMemberProfileReceived);
      socket.off('clubBadgeUpdated', onClubBadgeUpdated);
      socket.off('referralCode', onReferralCode);
      socket.off('referralJoined', onReferralJoined);
      socket.off('referralStats', onReferralStatsReceived);
      socket.off('clubLevel', onClubLevel);
      socket.off('featuredClubs', onFeaturedClubs);
      socket.off('error', onError);
    };
  }, [selectedClub]);

  // ─── Actions ───
  const resetTableForm = () => {
    setTableName('');
    setTableVariant('texas-holdem');
    setTableSB(25);
    setTableBB(50);
    setTableMinBuy(1000);
    setTableMaxBuy(5000);
    setTableMaxSeats(9);
  };

  const handleCreateClub = () => {
    const socket = getSocket();
    if (!socket || !createName.trim()) return;
    setLoading(true);
    setError('');
    socket.emit('createClub', {
      name: createName.trim(),
      description: createDesc.trim(),
      settings: {
        maxMembers: createMaxMembers,
        requireApproval: createRequireApproval,
        rake: createRake,
        isPrivate: true,
      },
    });
  };

  const handleJoinClub = () => {
    const socket = getSocket();
    if (!socket || !joinCode.trim()) return;
    setLoading(true);
    setError('');
    socket.emit('joinClub', { clubCode: joinCode.trim() });
  };

  const handleOpenClub = (club) => {
    const socket = getSocket();
    setSelectedClub(club);
    setView('detail');
    setDetailTab('tables');
    setError('');
    setChatMessages([]);
    setAnnouncements([]);
    setLeaderboard([]);
    setActivityFeed([]);
    setClubStats(null);
    if (socket) {
      socket.emit('getClubMembers', { clubId: club.id });
      socket.emit('getClubTables', { clubId: club.id });
      socket.emit('getClubAnnouncements', { clubId: club.id });
      socket.emit('getClubStatistics', { clubId: club.id });
      socket.emit('getClubTournaments', { clubId: club.id });
      socket.emit('getClubChallenges', { clubId: club.id });
      socket.emit('getScheduledClubTables', { clubId: club.id });
      socket.emit('getBlindStructures', { clubId: club.id });
      socket.emit('getUnionInfo', { clubId: club.id });
      socket.emit('getClubLevel', { clubId: club.id });
      socket.emit('generateReferralCode', { clubId: club.id });
      socket.emit('getReferralStats', { clubId: club.id });
    }
    // Init settings form
    setSettingsName(club.name);
    setSettingsDesc(club.description || '');
    setSettingsRake(club.settings?.rake || 0);
    setSettingsMaxMembers(club.settings?.maxMembers || 100);
    setSettingsRequireApproval(club.settings?.requireApproval || false);
    setSelectedBadge(club.badge || '♠');
  };

  const handleLeaveClub = () => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('leaveClub', { clubId: selectedClub.id });
  };

  const handleCreateTable = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !tableName.trim()) return;
    setLoading(true);
    socket.emit('createClubTable', {
      clubId: selectedClub.id,
      config: {
        tableName: tableName.trim(),
        variant: tableVariant,
        smallBlind: tableSB,
        bigBlind: tableBB,
        minBuyIn: tableMinBuy,
        maxBuyIn: tableMaxBuy,
        maxSeats: tableMaxSeats,
      },
    });
  };

  const handleJoinClubTable = (table) => {
    if (table.tableId) {
      // Join via the regular joinTable with the runtime tableId
      joinTable(table.tableId, playerName, -1, table.minBuyIn, avatar);
    }
  };

  const handleApproveMember = (userId) => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('approveMember', { clubId: selectedClub.id, userId });
  };

  const handleRemoveMember = (userId) => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('removeMember', { clubId: selectedClub.id, userId });
  };

  const handlePromoteMember = (userId) => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('promoteToManager', { clubId: selectedClub.id, userId });
  };

  const handleSaveSettings = () => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    setLoading(true);
    socket.emit('updateClubSettings', {
      clubId: selectedClub.id,
      settings: {
        name: settingsName,
        description: settingsDesc,
        rake: settingsRake,
        maxMembers: settingsMaxMembers,
        requireApproval: settingsRequireApproval,
      },
    });
  };

  const handleDeleteClub = () => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    if (!window.confirm('Are you sure you want to delete this club? This cannot be undone.')) return;
    socket.emit('deleteClub', { clubId: selectedClub.id });
  };

  const handleSearch = () => {
    const socket = getSocket();
    if (!socket || !searchQuery.trim()) return;
    setLoading(true);
    socket.emit('searchClubs', { query: searchQuery.trim() });
  };

  // ─── Auto-scroll chat ───
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // ─── Chat Actions ───
  const handleSendMessage = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !chatInput.trim()) return;
    socket.emit('sendClubMessage', { clubId: selectedClub.id, message: chatInput.trim(), type: 'chat' });
    setChatInput('');
  };

  const handlePostAnnouncement = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !announcementText.trim()) return;
    socket.emit('sendClubMessage', { clubId: selectedClub.id, message: announcementText.trim(), type: 'announcement' });
    setAnnouncementText('');
  };

  const handlePinMessage = (messageId, pin) => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('pinClubMessage', { clubId: selectedClub.id, messageId, pin });
    setContextMenu(null);
  };

  // ─── Tournament Actions ───
  const handleCreateTournament = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !tourneyName.trim() || !tourneyScheduledAt) return;
    setLoading(true);
    socket.emit('createClubTournament', {
      clubId: selectedClub.id,
      config: {
        name: tourneyName.trim(),
        format: tourneyFormat,
        buyIn: tourneyBuyIn,
        startingChips: tourneyStartingChips,
        maxPlayers: tourneyMaxPlayers,
        scheduledAt: tourneyScheduledAt,
      },
    });
  };

  const handleRegisterTournament = (tournamentId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('registerClubTournament', { tournamentId });
  };

  const handleStartTournament = (tournamentId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('startClubTournament', { tournamentId });
  };

  // ─── Challenge Actions ───
  const handleOpenChallenge = (userId, username) => {
    setChallengeTargetId(userId);
    setChallengeTargetName(username);
    setChallengeStakes(100);
    setShowChallengeModal(true);
  };

  const handleCreateChallenge = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !challengeTargetId) return;
    setLoading(true);
    socket.emit('createClubChallenge', {
      clubId: selectedClub.id,
      challengedId: challengeTargetId,
      stakes: challengeStakes,
    });
  };

  const handleAcceptChallenge = (challengeId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('acceptClubChallenge', { challengeId });
  };

  const handleDeclineChallenge = (challengeId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('declineClubChallenge', { challengeId });
  };

  // ─── Scheduled Table Actions ───
  const handleScheduleTable = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !schedTableTime) return;
    setLoading(true);
    socket.emit('scheduleClubTable', {
      clubId: selectedClub.id,
      config: {
        tableName: schedTableName.trim() || 'Scheduled Table',
        variant: schedTableVariant,
        smallBlind: schedTableSB,
        bigBlind: schedTableBB,
        minBuyIn: schedTableMinBuy,
        maxBuyIn: schedTableMaxBuy,
      },
      scheduledTime: schedTableTime,
      recurring: schedTableRecurring,
      recurrencePattern: schedTableRecurring ? schedTableRecurrence : undefined,
    });
  };

  const handleActivateScheduledTable = (id) => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('activateScheduledClubTable', { id, clubId: selectedClub.id });
  };

  const handleDeleteScheduledTable = (id) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('deleteScheduledClubTable', { id });
  };

  // ─── Blind Structure Actions ───
  const handleCreateBlindStructure = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !blindStructureName.trim() || blindStructureLevels.length === 0) return;
    setLoading(true);
    socket.emit('createBlindStructure', {
      clubId: selectedClub.id,
      name: blindStructureName.trim(),
      levels: blindStructureLevels,
    });
  };

  const handleDeleteBlindStructure = (id) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('deleteBlindStructure', { id });
  };

  const handleAddBlindLevel = () => {
    const last = blindStructureLevels[blindStructureLevels.length - 1] || { smallBlind: 25, bigBlind: 50, ante: 0, durationMinutes: 15 };
    setBlindStructureLevels((prev) => [...prev, {
      smallBlind: last.smallBlind * 2,
      bigBlind: last.bigBlind * 2,
      ante: last.ante > 0 ? last.ante * 2 : 0,
      durationMinutes: last.durationMinutes,
    }]);
  };

  const handleRemoveBlindLevel = (index) => {
    setBlindStructureLevels((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateBlindLevel = (index, field, value) => {
    setBlindStructureLevels((prev) => prev.map((lvl, i) => i === index ? { ...lvl, [field]: Number(value) || 0 } : lvl));
  };

  // ─── Invitation Actions (Feature 10) ───
  const handleInvitePlayer = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !inviteUsername.trim()) return;
    setError('');
    socket.emit('inviteToClub', { clubId: selectedClub.id, invitedUsername: inviteUsername.trim() });
  };

  const handleAcceptInvitation = (invitationId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('acceptInvitation', { invitationId });
    setMyInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
  };

  const handleDeclineInvitation = (invitationId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('declineInvitation', { invitationId });
    setMyInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
  };

  // ─── Union Actions (Feature 11) ───
  const handleCreateUnion = () => {
    const socket = getSocket();
    if (!socket || !selectedClub || !unionName.trim()) return;
    setLoading(true);
    socket.emit('createUnion', { clubId: selectedClub.id, name: unionName.trim(), description: unionDesc.trim() });
  };

  // ─── Member Profile Actions (Feature 12) ───
  const handleViewMemberProfile = (userId) => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('getMemberProfile', { clubId: selectedClub.id, userId });
  };

  // ─── Badge Actions (Feature 13) ───
  const handleUpdateBadge = (badge) => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    setSelectedBadge(badge);
    socket.emit('updateClubBadge', { clubId: selectedClub.id, badge });
  };

  // ─── Referral Actions (Feature 14) ───
  const handleGenerateReferralCode = () => {
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('generateReferralCode', { clubId: selectedClub.id });
  };

  const handleCopyReferralCode = () => {
    if (referralCode) {
      navigator.clipboard.writeText(referralCode).catch(() => {});
    }
  };

  const handleJoinByReferral = () => {
    const socket = getSocket();
    if (!socket || !referralJoinCode.trim()) return;
    setLoading(true);
    socket.emit('joinByReferral', { referralCode: referralJoinCode.trim() });
  };

  // ─── Tab switch data fetching ───
  const handleDetailTabChange = (tab) => {
    setDetailTab(tab);
    const socket = getSocket();
    if (!socket || !selectedClub) return;

    if (tab === 'chat') {
      socket.emit('joinClubRoom', { clubId: selectedClub.id });
      socket.emit('getClubMessages', { clubId: selectedClub.id });
      socket.emit('getClubAnnouncements', { clubId: selectedClub.id });
    } else if (tab === 'leaderboard') {
      socket.emit('getClubLeaderboard', { clubId: selectedClub.id, period: leaderboardPeriod });
      socket.emit('getClubStatistics', { clubId: selectedClub.id });
    } else if (tab === 'activity') {
      socket.emit('getClubActivity', { clubId: selectedClub.id });
    } else if (tab === 'tables') {
      socket.emit('getClubTables', { clubId: selectedClub.id });
      socket.emit('getClubTournaments', { clubId: selectedClub.id });
      socket.emit('getScheduledClubTables', { clubId: selectedClub.id });
    } else if (tab === 'members') {
      socket.emit('getClubMembers', { clubId: selectedClub.id });
      socket.emit('getClubChallenges', { clubId: selectedClub.id });
    } else if (tab === 'settings') {
      socket.emit('getBlindStructures', { clubId: selectedClub.id });
    }
  };

  const handleLeaderboardPeriodChange = (period) => {
    setLeaderboardPeriod(period);
    const socket = getSocket();
    if (!socket || !selectedClub) return;
    socket.emit('getClubLeaderboard', { clubId: selectedClub.id, period });
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  const formatChatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // ─── Determine user's role in selected club ───
  const myRole = selectedClub?.myRole || null;
  const isOwner = myRole === 'owner';
  const isManager = myRole === 'manager' || isOwner;

  // ─── RENDER: My Clubs List ───
  const renderClubList = () => (
    <div className="clubs-list-view">
      <div className="clubs-header">
        <h2 className="clubs-title">My Clubs</h2>
        <div className="clubs-header-actions">
          <button className="clubs-btn clubs-btn-primary" onClick={() => { setView('join'); setError(''); }}>
            Join Club
          </button>
          <button className="clubs-btn clubs-btn-gold" onClick={() => { setView('create'); setError(''); }}>
            + Create Club
          </button>
        </div>
      </div>

      {/* Pending Invitations (Feature 10) */}
      {myInvitations.length > 0 && (
        <div className="clubs-invitations-section">
          <h3 className="clubs-subtitle" style={{ color: '#f59e0b' }}>
            Pending Invitations ({myInvitations.length})
          </h3>
          {myInvitations.map((inv) => (
            <div key={inv.id} className="club-invitation-card">
              <div className="club-invitation-info">
                <span className="club-invitation-club">{inv.clubName}</span>
                <span className="club-invitation-from">from {inv.inviterName}</span>
              </div>
              <div className="club-invitation-actions">
                <button className="clubs-btn clubs-btn-green clubs-btn-sm" onClick={() => handleAcceptInvitation(inv.id)}>
                  Accept
                </button>
                <button className="clubs-btn clubs-btn-danger clubs-btn-sm" onClick={() => handleDeclineInvitation(inv.id)}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && myClubs.length === 0 && (
        <div className="clubs-loading">Loading clubs...</div>
      )}

      {!loading && myClubs.length === 0 && (
        <div className="clubs-empty">
          <p>You are not in any clubs yet.</p>
          <p style={{ fontSize: '0.8rem', color: '#6b6b8a' }}>
            Create your own club or join one with a 6-digit code.
          </p>
        </div>
      )}

      <div className="clubs-card-list">
        {myClubs.map((club) => (
          <div key={club.id} className="club-card" onClick={() => handleOpenClub(club)}>
            <div className="club-card-header">
              <span className="club-card-name">
                <span className="club-badge-icon">{club.badge || '♠'}</span>
                {club.name}
                {club.clubLevel > 1 && <span className="club-level-badge">Lv.{club.clubLevel}</span>}
              </span>
              <RoleBadge role={club.myRole} />
            </div>
            <div className="club-card-meta">
              <span className="club-card-members">{club.memberCount} members</span>
              <ClubCodeDisplay code={club.clubCode} />
            </div>
          </div>
        ))}
      </div>

      {/* Search public clubs */}
      <div className="clubs-search-section">
        <h3 className="clubs-subtitle">Search Public Clubs</h3>
        <div className="clubs-search-row">
          <input
            type="text"
            className="clubs-input"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="clubs-btn clubs-btn-primary" onClick={handleSearch}>
            Search
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="clubs-card-list" style={{ marginTop: '8px' }}>
            {searchResults.map((club) => (
              <div key={club.id} className="club-card club-card-search">
                <div className="club-card-header">
                  <span className="club-card-name">
                    <span className="club-badge-icon">{club.badge || '♠'}</span>
                    {club.name}
                  </span>
                  <span className="club-card-members">{club.memberCount} members</span>
                </div>
                <div className="club-card-meta">
                  <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                    {club.description || 'No description'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Featured Clubs (Feature 16) */}
      {(featuredClubs.length > 0 || clubOfWeek) && (
        <div className="clubs-featured-section">
          {clubOfWeek && (
            <div className="club-of-week-card">
              <div className="club-of-week-label">Club of the Week</div>
              <div className="club-card-header">
                <span className="club-card-name">
                  <span className="club-badge-icon">{clubOfWeek.badge || '♠'}</span>
                  {clubOfWeek.name}
                </span>
                <span className="club-card-members">{clubOfWeek.memberCount} members</span>
              </div>
              <div className="club-card-meta">
                <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                  {clubOfWeek.description || 'No description'}
                </span>
              </div>
            </div>
          )}
          {featuredClubs.length > 0 && (
            <>
              <h3 className="clubs-subtitle">Featured Clubs</h3>
              <div className="clubs-card-list">
                {featuredClubs.map((club) => (
                  <div key={club.id} className="club-card club-card-featured">
                    <div className="club-card-header">
                      <span className="club-card-name">
                        <span className="club-badge-icon">{club.badge || '♠'}</span>
                        {club.name}
                        {club.clubLevel > 1 && <span className="club-level-badge">Lv.{club.clubLevel}</span>}
                      </span>
                      <span className="club-card-members">{club.memberCount} members</span>
                    </div>
                    <div className="club-card-meta">
                      <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                        {club.description || 'No description'}
                      </span>
                      <button
                        className="clubs-btn clubs-btn-green clubs-btn-sm"
                        onClick={(e) => { e.stopPropagation(); const s = getSocket(); if (s) { s.emit('joinClub', { clubCode: club.clubCode }); } }}
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  // ─── RENDER: Create Club Modal ───
  const renderCreateClub = () => (
    <div className="clubs-form-view">
      <div className="clubs-form-header">
        <button className="clubs-back-btn" onClick={() => setView('list')}>&larr; Back</button>
        <h2 className="clubs-title">Create Club</h2>
      </div>

      <div className="clubs-form-group">
        <label>Club Name</label>
        <input
          type="text"
          className="clubs-input"
          placeholder="Enter club name..."
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          maxLength={30}
        />
      </div>

      <div className="clubs-form-group">
        <label>Description</label>
        <textarea
          className="clubs-textarea"
          placeholder="What's your club about?"
          value={createDesc}
          onChange={(e) => setCreateDesc(e.target.value)}
          maxLength={200}
          rows={3}
        />
      </div>

      <div className="clubs-form-group">
        <label>Max Members</label>
        <input
          type="number"
          className="clubs-input clubs-input-small"
          value={createMaxMembers}
          onChange={(e) => setCreateMaxMembers(Math.max(2, Math.min(500, Number(e.target.value) || 100)))}
          min={2}
          max={500}
        />
      </div>

      <div className="clubs-form-group">
        <label>Rake % (0-5)</label>
        <input
          type="range"
          className="clubs-slider"
          min={0}
          max={5}
          step={0.5}
          value={createRake}
          onChange={(e) => setCreateRake(Number(e.target.value))}
        />
        <span className="clubs-slider-value">{createRake}%</span>
      </div>

      <div className="clubs-form-group clubs-form-toggle">
        <label>Require Approval to Join</label>
        <button
          className={`clubs-toggle ${createRequireApproval ? 'active' : ''}`}
          onClick={() => setCreateRequireApproval(!createRequireApproval)}
        >
          {createRequireApproval ? 'ON' : 'OFF'}
        </button>
      </div>

      <button
        className="clubs-btn clubs-btn-gold clubs-btn-full"
        onClick={handleCreateClub}
        disabled={loading || !createName.trim()}
      >
        {loading ? 'Creating...' : 'Create Club'}
      </button>
    </div>
  );

  // ─── RENDER: Join Club Modal ───
  const renderJoinClub = () => (
    <div className="clubs-form-view">
      <div className="clubs-form-header">
        <button className="clubs-back-btn" onClick={() => setView('list')}>&larr; Back</button>
        <h2 className="clubs-title">Join Club</h2>
      </div>

      <div className="clubs-form-group">
        <label>Club Code (6 digits)</label>
        <input
          type="text"
          className="clubs-input clubs-code-input"
          placeholder="000000"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          maxLength={6}
        />
      </div>

      <button
        className="clubs-btn clubs-btn-primary clubs-btn-full"
        onClick={handleJoinClub}
        disabled={loading || joinCode.length !== 6}
      >
        {loading ? 'Joining...' : 'Join Club'}
      </button>
    </div>
  );

  // ─── RENDER: Club Detail ───
  const renderClubDetail = () => {
    if (!selectedClub) return null;

    const handleBackFromDetail = () => {
      const socket = getSocket();
      if (socket && selectedClub) {
        socket.emit('leaveClubRoom', { clubId: selectedClub.id });
      }
      setView('list');
      setSelectedClub(null);
    };

    return (
      <div className="clubs-detail-view">
        <div className="clubs-form-header">
          <button className="clubs-back-btn" onClick={handleBackFromDetail}>
            &larr; Back
          </button>
          <h2 className="clubs-title">
            <span className="club-badge-icon" style={{ fontSize: '1.2rem' }}>{selectedClub.badge || '♠'}</span>
            {selectedClub.name}
          </h2>
        </div>

        {/* Club Level & XP Bar (Feature 15) */}
        {clubLevelInfo && (
          <div className="club-level-header">
            <div className="club-level-info-row">
              <span className="club-level-text">Level {clubLevelInfo.level}</span>
              <span className="club-level-xp">{clubLevelInfo.xp} / {clubLevelInfo.nextLevelXp} XP</span>
            </div>
            <div className="club-xp-bar">
              <div
                className="club-xp-fill"
                style={{ width: `${Math.min(100, (clubLevelInfo.xp / clubLevelInfo.nextLevelXp) * 100)}%` }}
              />
            </div>
            {clubLevelInfo.perks && (
              <div className="club-level-perks">
                {clubLevelInfo.perks.slice(0, 5).map((p) => (
                  <span key={p.level} className={`club-perk-item ${p.unlocked ? 'unlocked' : 'locked'}`}>
                    Lv.{p.level}: {p.perk}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Club Stats Banner */}
        {clubStats && (
          <div className="club-stats-banner">
            <div className="club-stat-item">
              <span className="club-stat-value">{clubStats.totalMembers}</span>
              <span className="club-stat-label">Members</span>
            </div>
            <div className="club-stat-item">
              <span className="club-stat-value">{clubStats.totalHandsPlayed.toLocaleString()}</span>
              <span className="club-stat-label">Hands</span>
            </div>
            <div className="club-stat-item">
              <span className="club-stat-value">{clubStats.biggestPotEver.toLocaleString()}</span>
              <span className="club-stat-label">Biggest Pot</span>
            </div>
            <div className="club-stat-item">
              <span className="club-stat-value">{clubStats.clubAge}</span>
              <span className="club-stat-label">Age</span>
            </div>
          </div>
        )}

        {/* Announcements Banner */}
        {announcements.length > 0 && (
          <div className="club-announcements-banner">
            <div className="club-announcement-icon">&#128204;</div>
            <div className="club-announcement-text">
              <strong>{announcements[0].username}:</strong> {announcements[0].message}
            </div>
          </div>
        )}

        <div className="club-detail-info">
          <div className="club-detail-row">
            <span>Club Code:</span>
            <ClubCodeDisplay code={selectedClub.clubCode} />
          </div>
          <div className="club-detail-row">
            <span>Owner:</span>
            <span>{selectedClub.ownerName}</span>
          </div>
          {clubStats && clubStats.mostActivePlayer !== 'N/A' && (
            <div className="club-detail-row">
              <span>Most Active:</span>
              <span>{clubStats.mostActivePlayer}</span>
            </div>
          )}
          {selectedClub.description && (
            <div className="club-detail-desc">{selectedClub.description}</div>
          )}
        </div>

        {/* Tabs */}
        <div className="club-detail-tabs">
          <button
            className={`club-tab ${detailTab === 'tables' ? 'active' : ''}`}
            onClick={() => handleDetailTabChange('tables')}
          >
            Tables
          </button>
          <button
            className={`club-tab ${detailTab === 'chat' ? 'active' : ''}`}
            onClick={() => handleDetailTabChange('chat')}
          >
            Chat
          </button>
          <button
            className={`club-tab ${detailTab === 'members' ? 'active' : ''}`}
            onClick={() => handleDetailTabChange('members')}
          >
            Members
          </button>
          <button
            className={`club-tab ${detailTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => handleDetailTabChange('leaderboard')}
          >
            Ranks
          </button>
          <button
            className={`club-tab ${detailTab === 'activity' ? 'active' : ''}`}
            onClick={() => handleDetailTabChange('activity')}
          >
            Activity
          </button>
          {isOwner && (
            <button
              className={`club-tab ${detailTab === 'settings' ? 'active' : ''}`}
              onClick={() => handleDetailTabChange('settings')}
            >
              Settings
            </button>
          )}
        </div>

        {/* Tab content */}
        <div className="club-detail-content">
          {detailTab === 'tables' && renderTablesTab()}
          {detailTab === 'chat' && renderChatTab()}
          {detailTab === 'members' && renderMembersTab()}
          {detailTab === 'leaderboard' && renderLeaderboardTab()}
          {detailTab === 'activity' && renderActivityTab()}
          {detailTab === 'settings' && isOwner && renderSettingsTab()}
        </div>

        {/* Leave club (non-owners only) */}
        {!isOwner && (
          <button
            className="clubs-btn clubs-btn-danger clubs-btn-full"
            style={{ marginTop: '16px' }}
            onClick={handleLeaveClub}
          >
            Leave Club
          </button>
        )}
      </div>
    );
  };

  // ─── RENDER: Tables Tab ───
  const renderTablesTab = () => (
    <div className="club-tables-tab">
      {isManager && (
        <button
          className="clubs-btn clubs-btn-primary"
          style={{ marginBottom: '12px' }}
          onClick={() => setShowCreateTable(true)}
        >
          + Create Table
        </button>
      )}

      {clubTables.length === 0 && (
        <div className="clubs-empty" style={{ padding: '16px 0' }}>
          No tables yet. {isManager ? 'Create one!' : 'Ask a manager to create tables.'}
        </div>
      )}

      {clubTables.map((table) => (
        <div key={table.id} className="club-table-card">
          <div className="club-table-header">
            <span className="club-table-name">{table.tableName}</span>
            <span className="club-table-variant">{table.variant}</span>
          </div>
          <div className="club-table-meta">
            <span>Blinds: {table.smallBlind}/{table.bigBlind}</span>
            <span>Buy-in: {table.minBuyIn}-{table.maxBuyIn}</span>
            <span>Seats: {table.maxSeats}</span>
          </div>
          <button
            className="clubs-btn clubs-btn-green"
            onClick={() => handleJoinClubTable(table)}
            disabled={!table.tableId}
          >
            Join Table
          </button>
        </div>
      ))}

      {/* Create Table Modal */}
      {showCreateTable && renderCreateTableModal()}

      {/* Tournaments Section */}
      <div style={{ marginTop: '20px', borderTop: '1px solid #2a2a3e', paddingTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 style={{ color: '#e2e2f0', fontSize: '0.85rem', fontWeight: 600, margin: 0 }}>Tournaments</h4>
          {isManager && (
            <button className="clubs-btn clubs-btn-gold clubs-btn-sm" onClick={() => setShowCreateTournament(true)}>+ Schedule Tournament</button>
          )}
        </div>
        {clubTournaments.length === 0 && <div className="clubs-empty" style={{ padding: '8px 0', fontSize: '0.75rem' }}>No tournaments yet.</div>}
        {clubTournaments.map((t) => (
          <div key={t.id} className="club-table-card">
            <div className="club-table-header">
              <span className="club-table-name">{t.name}</span>
              <span className="club-table-variant">{t.status}</span>
            </div>
            <div className="club-table-meta">
              <span>Format: {t.format}</span>
              <span>Buy-in: {t.buyIn}</span>
              <span>{t.registeredCount || 0}/{t.maxPlayers} players</span>
            </div>
            <div className="club-table-meta">
              <span>Chips: {t.startingChips}</span>
              <span>Starts: {new Date(t.scheduledAt).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              {t.status === 'registering' && <button className="clubs-btn clubs-btn-primary clubs-btn-sm" onClick={() => handleRegisterTournament(t.id)}>Register / Unregister</button>}
              {t.status === 'registering' && isManager && <button className="clubs-btn clubs-btn-green clubs-btn-sm" onClick={() => handleStartTournament(t.id)}>Start Now</button>}
            </div>
          </div>
        ))}
      </div>

      {/* Scheduled Tables Section */}
      <div style={{ marginTop: '20px', borderTop: '1px solid #2a2a3e', paddingTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 style={{ color: '#e2e2f0', fontSize: '0.85rem', fontWeight: 600, margin: 0 }}>Scheduled Tables</h4>
          {isManager && <button className="clubs-btn clubs-btn-primary clubs-btn-sm" onClick={() => setShowScheduleTable(true)}>+ Schedule Table</button>}
        </div>
        {scheduledTables.length === 0 && <div className="clubs-empty" style={{ padding: '8px 0', fontSize: '0.75rem' }}>No scheduled tables.</div>}
        {scheduledTables.map((st) => {
          const cfg = typeof st.tableConfig === 'string' ? JSON.parse(st.tableConfig) : st.tableConfig;
          const timeLeft = new Date(st.scheduledTime) - Date.now();
          const countdown = timeLeft > 0 ? Math.floor(timeLeft / 3600000) + 'h ' + Math.floor((timeLeft % 3600000) / 60000) + 'm' : 'Now';
          return (
            <div key={st.id} className="club-table-card">
              <div className="club-table-header">
                <span className="club-table-name">{cfg.tableName || 'Scheduled Table'}</span>
                <span className="club-table-variant">{st.status}{st.recurring ? ' (recurring)' : ''}</span>
              </div>
              <div className="club-table-meta">
                <span>Blinds: {cfg.smallBlind || 25}/{cfg.bigBlind || 50}</span>
                <span>Starts: {countdown}</span>
                <span>{new Date(st.scheduledTime).toLocaleString()}</span>
              </div>
              {isManager && st.status === 'scheduled' && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <button className="clubs-btn clubs-btn-green clubs-btn-sm" onClick={() => handleActivateScheduledTable(st.id)}>Activate Now</button>
                  <button className="clubs-btn clubs-btn-danger clubs-btn-sm" onClick={() => handleDeleteScheduledTable(st.id)}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create Tournament Modal */}
      {showCreateTournament && (
        <div className="clubs-modal-overlay" onClick={() => setShowCreateTournament(false)}>
          <div className="clubs-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="clubs-modal-title">Schedule Tournament</h3>
            <div className="clubs-form-group"><label>Tournament Name</label><input type="text" className="clubs-input" value={tourneyName} onChange={(e) => setTourneyName(e.target.value)} placeholder="Sunday Showdown" maxLength={40} /></div>
            <div className="clubs-form-group"><label>Format</label><select className="clubs-select" value={tourneyFormat} onChange={(e) => setTourneyFormat(e.target.value)}><option value="freezeout">Freezeout</option><option value="rebuy">Rebuy</option><option value="bounty">Bounty</option></select></div>
            <div className="clubs-form-row">
              <div className="clubs-form-group"><label>Buy-In</label><input type="number" className="clubs-input clubs-input-small" value={tourneyBuyIn} onChange={(e) => setTourneyBuyIn(Number(e.target.value) || 100)} min={0} /></div>
              <div className="clubs-form-group"><label>Starting Chips</label><input type="number" className="clubs-input clubs-input-small" value={tourneyStartingChips} onChange={(e) => setTourneyStartingChips(Number(e.target.value) || 5000)} min={100} /></div>
            </div>
            <div className="clubs-form-group"><label>Max Players</label><input type="number" className="clubs-input clubs-input-small" value={tourneyMaxPlayers} onChange={(e) => setTourneyMaxPlayers(Math.max(2, Math.min(200, Number(e.target.value) || 20)))} min={2} max={200} /></div>
            <div className="clubs-form-group"><label>Scheduled Start</label><input type="datetime-local" className="clubs-input" value={tourneyScheduledAt} onChange={(e) => setTourneyScheduledAt(e.target.value)} /></div>
            <div className="clubs-modal-actions">
              <button className="clubs-btn" onClick={() => setShowCreateTournament(false)}>Cancel</button>
              <button className="clubs-btn clubs-btn-gold" onClick={handleCreateTournament} disabled={loading || !tourneyName.trim() || !tourneyScheduledAt}>{loading ? 'Creating...' : 'Schedule Tournament'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Table Modal */}
      {showScheduleTable && (
        <div className="clubs-modal-overlay" onClick={() => setShowScheduleTable(false)}>
          <div className="clubs-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="clubs-modal-title">Schedule Table</h3>
            <div className="clubs-form-group"><label>Table Name</label><input type="text" className="clubs-input" value={schedTableName} onChange={(e) => setSchedTableName(e.target.value)} placeholder="Evening Cash Game" maxLength={30} /></div>
            <div className="clubs-form-group"><label>Variant</label><select className="clubs-select" value={schedTableVariant} onChange={(e) => setSchedTableVariant(e.target.value)}>{VARIANT_OPTIONS.map((v) => (<option key={v.value} value={v.value}>{v.label}</option>))}</select></div>
            <div className="clubs-form-row">
              <div className="clubs-form-group"><label>Small Blind</label><input type="number" className="clubs-input clubs-input-small" value={schedTableSB} onChange={(e) => setSchedTableSB(Number(e.target.value) || 25)} min={1} /></div>
              <div className="clubs-form-group"><label>Big Blind</label><input type="number" className="clubs-input clubs-input-small" value={schedTableBB} onChange={(e) => setSchedTableBB(Number(e.target.value) || 50)} min={2} /></div>
            </div>
            <div className="clubs-form-row">
              <div className="clubs-form-group"><label>Min Buy-In</label><input type="number" className="clubs-input clubs-input-small" value={schedTableMinBuy} onChange={(e) => setSchedTableMinBuy(Number(e.target.value) || 1000)} min={1} /></div>
              <div className="clubs-form-group"><label>Max Buy-In</label><input type="number" className="clubs-input clubs-input-small" value={schedTableMaxBuy} onChange={(e) => setSchedTableMaxBuy(Number(e.target.value) || 5000)} min={1} /></div>
            </div>
            <div className="clubs-form-group"><label>Scheduled Time</label><input type="datetime-local" className="clubs-input" value={schedTableTime} onChange={(e) => setSchedTableTime(e.target.value)} /></div>
            <div className="clubs-form-group clubs-form-toggle"><label>Recurring</label><button className={'clubs-toggle ' + (schedTableRecurring ? 'active' : '')} onClick={() => setSchedTableRecurring(!schedTableRecurring)}>{schedTableRecurring ? 'ON' : 'OFF'}</button></div>
            {schedTableRecurring && (<div className="clubs-form-group"><label>Recurrence</label><select className="clubs-select" value={schedTableRecurrence} onChange={(e) => setSchedTableRecurrence(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>)}
            <div className="clubs-modal-actions">
              <button className="clubs-btn" onClick={() => setShowScheduleTable(false)}>Cancel</button>
              <button className="clubs-btn clubs-btn-gold" onClick={handleScheduleTable} disabled={loading || !schedTableTime}>{loading ? 'Scheduling...' : 'Schedule Table'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ─── RENDER: Create Table Modal ───
  const renderCreateTableModal = () => (
    <div className="clubs-modal-overlay" onClick={() => setShowCreateTable(false)}>
      <div className="clubs-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="clubs-modal-title">Create Club Table</h3>

        <div className="clubs-form-group">
          <label>Table Name</label>
          <input
            type="text"
            className="clubs-input"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="My Table"
            maxLength={30}
          />
        </div>

        <div className="clubs-form-group">
          <label>Variant</label>
          <select
            className="clubs-select"
            value={tableVariant}
            onChange={(e) => setTableVariant(e.target.value)}
          >
            {VARIANT_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>

        <div className="clubs-form-row">
          <div className="clubs-form-group">
            <label>Small Blind</label>
            <input
              type="number"
              className="clubs-input clubs-input-small"
              value={tableSB}
              onChange={(e) => setTableSB(Number(e.target.value) || 5)}
              min={1}
            />
          </div>
          <div className="clubs-form-group">
            <label>Big Blind</label>
            <input
              type="number"
              className="clubs-input clubs-input-small"
              value={tableBB}
              onChange={(e) => setTableBB(Number(e.target.value) || 10)}
              min={2}
            />
          </div>
        </div>

        <div className="clubs-form-row">
          <div className="clubs-form-group">
            <label>Min Buy-In</label>
            <input
              type="number"
              className="clubs-input clubs-input-small"
              value={tableMinBuy}
              onChange={(e) => setTableMinBuy(Number(e.target.value) || 100)}
              min={1}
            />
          </div>
          <div className="clubs-form-group">
            <label>Max Buy-In</label>
            <input
              type="number"
              className="clubs-input clubs-input-small"
              value={tableMaxBuy}
              onChange={(e) => setTableMaxBuy(Number(e.target.value) || 5000)}
              min={1}
            />
          </div>
        </div>

        <div className="clubs-form-group">
          <label>Max Seats</label>
          <select
            className="clubs-select"
            value={tableMaxSeats}
            onChange={(e) => setTableMaxSeats(Number(e.target.value))}
          >
            {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>{n} seats</option>
            ))}
          </select>
        </div>

        <div className="clubs-modal-actions">
          <button className="clubs-btn" onClick={() => setShowCreateTable(false)}>Cancel</button>
          <button
            className="clubs-btn clubs-btn-gold"
            onClick={handleCreateTable}
            disabled={loading || !tableName.trim()}
          >
            {loading ? 'Creating...' : 'Create Table'}
          </button>
        </div>
      </div>
    </div>
  );

  // ─── RENDER: Members Tab ───
  const renderMembersTab = () => {
    const pendingMembers = clubMembers.filter((m) => m.status === 'pending');
    const activeMembers = clubMembers.filter((m) => m.status === 'active');

    return (
      <div className="club-members-tab">
        {/* Invite Player (Feature 10) */}
        {isManager && (
          <div className="club-invite-section">
            <div className="clubs-search-row" style={{ marginBottom: '12px' }}>
              <input
                type="text"
                className="clubs-input"
                placeholder="Username to invite..."
                value={inviteUsername}
                onChange={(e) => setInviteUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInvitePlayer()}
              />
              <button className="clubs-btn clubs-btn-primary" onClick={handleInvitePlayer} disabled={!inviteUsername.trim()}>
                Invite
              </button>
            </div>
          </div>
        )}

        {/* Referral Section (Feature 14) */}
        <div className="club-referral-section">
          <h4 className="club-pending-title" style={{ color: '#60a5fa' }}>My Referral Code</h4>
          {referralCode ? (
            <div className="club-referral-row">
              <span className="club-referral-code">{referralCode}</span>
              <button className="clubs-btn clubs-btn-sm" onClick={handleCopyReferralCode}>Copy</button>
            </div>
          ) : (
            <button className="clubs-btn clubs-btn-primary clubs-btn-sm" onClick={handleGenerateReferralCode}>
              Generate Referral Code
            </button>
          )}
          {referralStats && referralStats.chipsEarned > 0 && (
            <div className="club-referral-stats">
              <span>Chips earned from referrals: {referralStats.chipsEarned.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Pending approvals */}
        {pendingMembers.length > 0 && isManager && (
          <div className="club-pending-section">
            <h4 className="club-pending-title">Pending Requests ({pendingMembers.length})</h4>
            {pendingMembers.map((m) => (
              <div key={m.id} className="club-member-row club-member-pending">
                <span className="club-member-name">{m.username || `User #${m.userId}`}</span>
                <div className="club-member-actions">
                  <button className="clubs-btn clubs-btn-green clubs-btn-sm" onClick={() => handleApproveMember(m.userId)}>
                    Approve
                  </button>
                  <button className="clubs-btn clubs-btn-danger clubs-btn-sm" onClick={() => handleRemoveMember(m.userId)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active members */}
        <div className="club-active-members">
          {activeMembers.map((m) => (
            <div key={m.id} className="club-member-row">
              <div className="club-member-info">
                <span
                  className="club-member-name club-member-clickable"
                  onClick={() => handleViewMemberProfile(m.userId)}
                  title="View profile"
                >
                  {m.username || `User #${m.userId}`}
                </span>
                <RoleBadge role={m.role} />
              </div>
              <div className="club-member-actions" style={{ display: 'flex', gap: '4px' }}>
                  <button className="clubs-btn clubs-btn-primary clubs-btn-sm" onClick={() => handleOpenChallenge(m.userId, m.username || 'User #' + m.userId)}>Challenge</button>
                </div>
              {isManager && m.role === 'member' && (
                <div className="club-member-actions">
                  {isOwner && (
                    <button className="clubs-btn clubs-btn-sm" onClick={() => handlePromoteMember(m.userId)}>
                      Promote
                    </button>
                  )}
                  <button className="clubs-btn clubs-btn-danger clubs-btn-sm" onClick={() => handleRemoveMember(m.userId)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Member Profile Popup (Feature 12) */}
        {showMemberProfile && memberProfile && (
          <div className="clubs-modal-overlay" onClick={() => setShowMemberProfile(false)}>
            <div className="clubs-modal club-profile-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="clubs-modal-title">{memberProfile.username}</h3>
              <div className="club-profile-grid">
                <div className="club-profile-stat">
                  <span className="club-profile-label">Role</span>
                  <span className="club-profile-value" style={{ color: ROLE_COLORS[memberProfile.role] || '#6b6b8a', textTransform: 'capitalize' }}>
                    {memberProfile.role}
                  </span>
                </div>
                <div className="club-profile-stat">
                  <span className="club-profile-label">Joined</span>
                  <span className="club-profile-value">{memberProfile.joinedAt ? new Date(memberProfile.joinedAt).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div className="club-profile-stat">
                  <span className="club-profile-label">Hands Played</span>
                  <span className="club-profile-value">{memberProfile.handsPlayed.toLocaleString()}</span>
                </div>
                <div className="club-profile-stat">
                  <span className="club-profile-label">Chips Won</span>
                  <span className="club-profile-value" style={{ color: '#4ade80' }}>{memberProfile.chipsWon.toLocaleString()}</span>
                </div>
                <div className="club-profile-stat">
                  <span className="club-profile-label">Chips Lost</span>
                  <span className="club-profile-value" style={{ color: '#f87171' }}>{memberProfile.chipsLost.toLocaleString()}</span>
                </div>
                <div className="club-profile-stat">
                  <span className="club-profile-label">Biggest Pot</span>
                  <span className="club-profile-value" style={{ color: '#f59e0b' }}>{memberProfile.biggestPot.toLocaleString()}</span>
                </div>
                <div className="club-profile-stat">
                  <span className="club-profile-label">Win Rate</span>
                  <span className="club-profile-value">{memberProfile.winRate}%</span>
                </div>
              </div>
              <button className="clubs-btn clubs-btn-full" style={{ marginTop: '12px' }} onClick={() => setShowMemberProfile(false)}>
                Close
              </button>
            </div>
          </div>
        )}
      {/* Challenges Section */}
        <div style={{ marginTop: '16px', borderTop: '1px solid #2a2a3e', paddingTop: '12px' }}>
          <h4 style={{ color: '#e2e2f0', fontSize: '0.85rem', fontWeight: 600, margin: '0 0 8px' }}>Challenges</h4>
          {clubChallenges.filter((c) => c.status === 'pending').length === 0 && <div className="clubs-empty" style={{ padding: '8px 0', fontSize: '0.75rem' }}>No pending challenges.</div>}
          {clubChallenges.filter((c) => c.status === 'pending').map((ch) => (
            <div key={ch.id} className="club-member-row club-member-pending" style={{ marginBottom: '4px' }}>
              <div className="club-member-info">
                <span className="club-member-name">{ch.challengerName} vs {ch.challengedName}</span>
                <span style={{ color: '#f59e0b', fontSize: '0.7rem', marginLeft: '6px' }}>Stakes: {ch.stakes}</span>
              </div>
              <div className="club-member-actions">
                <button className="clubs-btn clubs-btn-green clubs-btn-sm" onClick={() => handleAcceptChallenge(ch.id)}>Accept</button>
                <button className="clubs-btn clubs-btn-danger clubs-btn-sm" onClick={() => handleDeclineChallenge(ch.id)}>Decline</button>
              </div>
            </div>
          ))}
        </div>

        {/* Challenge Modal */}
        {showChallengeModal && (
          <div className="clubs-modal-overlay" onClick={() => setShowChallengeModal(false)}>
            <div className="clubs-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="clubs-modal-title">Challenge {challengeTargetName}</h3>
              <div className="clubs-form-group"><label>Stakes</label><input type="number" className="clubs-input clubs-input-small" value={challengeStakes} onChange={(e) => setChallengeStakes(Number(e.target.value) || 0)} min={0} /></div>
              <div className="clubs-modal-actions">
                <button className="clubs-btn" onClick={() => setShowChallengeModal(false)}>Cancel</button>
                <button className="clubs-btn clubs-btn-gold" onClick={handleCreateChallenge} disabled={loading}>Send Challenge</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── RENDER: Settings Tab (owner only) ───
  const renderSettingsTab = () => (
    <div className="club-settings-tab">
      <div className="clubs-form-group">
        <label>Club Name</label>
        <input
          type="text"
          className="clubs-input"
          value={settingsName}
          onChange={(e) => setSettingsName(e.target.value)}
          maxLength={30}
        />
      </div>

      <div className="clubs-form-group">
        <label>Description</label>
        <textarea
          className="clubs-textarea"
          value={settingsDesc}
          onChange={(e) => setSettingsDesc(e.target.value)}
          maxLength={200}
          rows={3}
        />
      </div>

      <div className="clubs-form-group">
        <label>Rake %</label>
        <input
          type="range"
          className="clubs-slider"
          min={0}
          max={5}
          step={0.5}
          value={settingsRake}
          onChange={(e) => setSettingsRake(Number(e.target.value))}
        />
        <span className="clubs-slider-value">{settingsRake}%</span>
      </div>

      <div className="clubs-form-group">
        <label>Max Members</label>
        <input
          type="number"
          className="clubs-input clubs-input-small"
          value={settingsMaxMembers}
          onChange={(e) => setSettingsMaxMembers(Math.max(2, Math.min(500, Number(e.target.value) || 100)))}
          min={2}
          max={500}
        />
      </div>

      <div className="clubs-form-group clubs-form-toggle">
        <label>Require Approval</label>
        <button
          className={`clubs-toggle ${settingsRequireApproval ? 'active' : ''}`}
          onClick={() => setSettingsRequireApproval(!settingsRequireApproval)}
        >
          {settingsRequireApproval ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Badge Picker (Feature 13) */}
      <div className="clubs-form-group">
        <label>Club Badge</label>
        <div className="club-badge-grid">
          {BADGE_OPTIONS.map((b) => (
            <button
              key={b}
              className={`club-badge-option ${selectedBadge === b ? 'selected' : ''}`}
              onClick={() => handleUpdateBadge(b)}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <button
        className="clubs-btn clubs-btn-gold clubs-btn-full"
        onClick={handleSaveSettings}
        disabled={loading}
      >
        {loading ? 'Saving...' : 'Save Settings'}
      </button>

      {/* Union Section (Feature 11) */}
      <div style={{ marginTop: '24px', borderTop: '1px solid #2a2a3e', paddingTop: '16px' }}>
        <h4 style={{ color: '#60a5fa', fontSize: '0.8rem', fontWeight: 600, margin: '0 0 8px' }}>Club Union / Alliance</h4>
        {unionInfo ? (
          <div className="club-union-info">
            <div className="club-union-name">{unionInfo.name}</div>
            {unionInfo.description && <div className="club-union-desc">{unionInfo.description}</div>}
            <div className="club-union-clubs">
              <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Allied Clubs:</span>
              {unionInfo.clubs?.map((c) => (
                <div key={c.clubId} className="club-union-member">
                  <span>{c.badge || '♠'} {c.clubName}</span>
                  <span style={{ color: '#6b6b8a', fontSize: '0.7rem' }}>{c.memberCount} members</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="clubs-form-group">
              <input
                type="text"
                className="clubs-input"
                placeholder="Union name..."
                value={unionName}
                onChange={(e) => setUnionName(e.target.value)}
                maxLength={30}
              />
            </div>
            <div className="clubs-form-group">
              <input
                type="text"
                className="clubs-input"
                placeholder="Union description..."
                value={unionDesc}
                onChange={(e) => setUnionDesc(e.target.value)}
                maxLength={100}
              />
            </div>
            <button
              className="clubs-btn clubs-btn-primary clubs-btn-full"
              onClick={handleCreateUnion}
              disabled={loading || !unionName.trim()}
            >
              Create Union
            </button>
          </div>
        )}
      </div>

      {/* Post Announcement */}
      <div style={{ marginTop: '24px', borderTop: '1px solid #2a2a3e', paddingTop: '16px' }}>
        <h4 style={{ color: '#f59e0b', fontSize: '0.8rem', fontWeight: 600, margin: '0 0 8px' }}>Post Announcement</h4>
        <textarea
          className="clubs-textarea"
          placeholder="Write an announcement for all members..."
          value={announcementText}
          onChange={(e) => setAnnouncementText(e.target.value)}
          maxLength={500}
          rows={2}
        />
        <button
          className="clubs-btn clubs-btn-gold clubs-btn-full"
          style={{ marginTop: '8px' }}
          onClick={handlePostAnnouncement}
          disabled={!announcementText.trim()}
        >
          Post Announcement
        </button>
      </div>

      {/* Blind Structures */}
      <div style={{ marginTop: '20px', borderTop: '1px solid #2a2a3e', paddingTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 style={{ color: '#e2e2f0', fontSize: '0.85rem', fontWeight: 600, margin: 0 }}>Blind Structures</h4>
          <button className="clubs-btn clubs-btn-gold clubs-btn-sm" onClick={() => { setShowCreateBlindStructure(true); setBlindStructureName(''); setBlindStructureLevels([{ smallBlind: 25, bigBlind: 50, ante: 0, durationMinutes: 15 }]); }}>+ Create Structure</button>
        </div>
        {blindStructures.length === 0 && <div className="clubs-empty" style={{ padding: '8px 0', fontSize: '0.75rem' }}>No custom blind structures.</div>}
        {blindStructures.map((bs) => (
          <div key={bs.id} className="club-table-card" style={{ marginBottom: '8px' }}>
            <div className="club-table-header">
              <span className="club-table-name">{bs.name}</span>
              <button className="clubs-btn clubs-btn-danger clubs-btn-sm" onClick={() => handleDeleteBlindStructure(bs.id)}>Delete</button>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#6b6b8a' }}>
              {bs.levels.map((lvl, i) => (
                <div key={i} style={{ padding: '2px 0' }}>Level {i + 1}: {lvl.smallBlind}/{lvl.bigBlind} (ante {lvl.ante}) - {lvl.durationMinutes}min</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Create Blind Structure Modal */}
      {showCreateBlindStructure && (
        <div className="clubs-modal-overlay" onClick={() => setShowCreateBlindStructure(false)}>
          <div className="clubs-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="clubs-modal-title">Create Blind Structure</h3>
            <div className="clubs-form-group"><label>Structure Name</label><input type="text" className="clubs-input" value={blindStructureName} onChange={(e) => setBlindStructureName(e.target.value)} placeholder="Turbo Structure" maxLength={30} /></div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Levels</label>
              {blindStructureLevels.map((lvl, i) => (
                <div key={i} style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ color: '#6b6b8a', fontSize: '0.7rem', minWidth: '18px' }}>{i + 1}.</span>
                  <input type="number" className="clubs-input" style={{ width: '60px', padding: '4px 6px', fontSize: '0.75rem' }} value={lvl.smallBlind} onChange={(e) => handleUpdateBlindLevel(i, 'smallBlind', e.target.value)} placeholder="SB" min={1} />
                  <input type="number" className="clubs-input" style={{ width: '60px', padding: '4px 6px', fontSize: '0.75rem' }} value={lvl.bigBlind} onChange={(e) => handleUpdateBlindLevel(i, 'bigBlind', e.target.value)} placeholder="BB" min={2} />
                  <input type="number" className="clubs-input" style={{ width: '50px', padding: '4px 6px', fontSize: '0.75rem' }} value={lvl.ante} onChange={(e) => handleUpdateBlindLevel(i, 'ante', e.target.value)} placeholder="Ante" min={0} />
                  <input type="number" className="clubs-input" style={{ width: '50px', padding: '4px 6px', fontSize: '0.75rem' }} value={lvl.durationMinutes} onChange={(e) => handleUpdateBlindLevel(i, 'durationMinutes', e.target.value)} placeholder="Min" min={1} />
                  <span style={{ color: '#6b6b8a', fontSize: '0.6rem' }}>min</span>
                  {blindStructureLevels.length > 1 && <button className="clubs-btn clubs-btn-danger clubs-btn-sm" style={{ padding: '2px 6px', fontSize: '0.65rem' }} onClick={() => handleRemoveBlindLevel(i)}>X</button>}
                </div>
              ))}
              <button className="clubs-btn clubs-btn-sm" style={{ marginTop: '4px' }} onClick={handleAddBlindLevel}>+ Add Level</button>
            </div>
            <div className="clubs-modal-actions">
              <button className="clubs-btn" onClick={() => setShowCreateBlindStructure(false)}>Cancel</button>
              <button className="clubs-btn clubs-btn-gold" onClick={handleCreateBlindStructure} disabled={loading || !blindStructureName.trim() || blindStructureLevels.length === 0}>{loading ? 'Creating...' : 'Create Structure'}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: '24px', borderTop: '1px solid #2a2a3e', paddingTop: '16px' }}>
        <button
          className="clubs-btn clubs-btn-danger clubs-btn-full"
          onClick={handleDeleteClub}
        >
          Delete Club
        </button>
      </div>
    </div>
  );

  // ─── RENDER: Chat Tab ───
  const renderChatTab = () => (
    <div className="club-chat-tab">
      {/* Message list */}
      <div className="club-chat-messages" onClick={() => setContextMenu(null)}>
        {chatMessages.length === 0 && (
          <div className="clubs-empty" style={{ padding: '24px 0' }}>
            No messages yet. Start the conversation!
          </div>
        )}
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={`club-chat-msg ${msg.type === 'system' ? 'club-chat-system' : ''} ${msg.type === 'announcement' || msg.isPinned ? 'club-chat-announcement' : ''}`}
            onContextMenu={(e) => {
              if (isManager && msg.type !== 'system') {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, messageId: msg.id, isPinned: msg.isPinned });
              }
            }}
          >
            {msg.type === 'system' ? (
              <span className="club-chat-system-text">{msg.message}</span>
            ) : (
              <>
                {(msg.type === 'announcement' || msg.isPinned) && (
                  <span className="club-chat-pin-icon">&#128204;</span>
                )}
                <span className="club-chat-username" style={{ color: msg.type === 'announcement' ? '#f59e0b' : '#60a5fa' }}>
                  {msg.username}
                </span>
                <span className="club-chat-text">{msg.message}</span>
                <span className="club-chat-time">{formatChatTime(msg.createdAt)}</span>
              </>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Context menu for pin/unpin */}
      {contextMenu && (
        <div
          className="club-chat-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={() => handlePinMessage(contextMenu.messageId, !contextMenu.isPinned)}>
            {contextMenu.isPinned ? 'Unpin Message' : 'Pin Message'}
          </button>
        </div>
      )}

      {/* Input */}
      <div className="club-chat-input-row">
        <input
          type="text"
          className="clubs-input club-chat-input"
          placeholder="Type a message..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          maxLength={500}
        />
        <button
          className="clubs-btn clubs-btn-primary"
          onClick={handleSendMessage}
          disabled={!chatInput.trim()}
        >
          Send
        </button>
      </div>

      {/* Announcement button for managers */}
      {isManager && (
        <div className="club-chat-announce-row">
          <input
            type="text"
            className="clubs-input club-chat-input"
            placeholder="Post an announcement..."
            value={announcementText}
            onChange={(e) => setAnnouncementText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePostAnnouncement()}
            maxLength={500}
          />
          <button
            className="clubs-btn clubs-btn-gold"
            onClick={handlePostAnnouncement}
            disabled={!announcementText.trim()}
          >
            Announce
          </button>
        </div>
      )}
    </div>
  );

  // ─── RENDER: Leaderboard Tab ───
  const renderLeaderboardTab = () => {
    const auth = useGameStore.getState();
    return (
      <div className="club-leaderboard-tab">
        {/* Period Tabs */}
        <div className="club-leaderboard-periods">
          {[{ key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' }, { key: 'alltime', label: 'All Time' }].map((p) => (
            <button
              key={p.key}
              className={`clubs-btn clubs-btn-sm ${leaderboardPeriod === p.key ? 'clubs-btn-primary' : ''}`}
              onClick={() => handleLeaderboardPeriodChange(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {leaderboard.length === 0 && (
          <div className="clubs-empty" style={{ padding: '24px 0' }}>
            No stats recorded yet. Play some hands!
          </div>
        )}

        {leaderboard.length > 0 && (
          <div className="club-leaderboard-table">
            <div className="club-leaderboard-header">
              <span className="club-lb-rank">#</span>
              <span className="club-lb-name">Player</span>
              <span className="club-lb-stat">Chips Won</span>
              <span className="club-lb-stat">Hands</span>
              <span className="club-lb-stat">Best Pot</span>
            </div>
            {leaderboard.map((entry, idx) => (
              <div
                key={entry.id}
                className={`club-leaderboard-row ${entry.username === playerName ? 'club-lb-highlight' : ''}`}
              >
                <span className="club-lb-rank">
                  {idx === 0 ? '\uD83E\uDD47' : idx === 1 ? '\uD83E\uDD48' : idx === 2 ? '\uD83E\uDD49' : idx + 1}
                </span>
                <span className="club-lb-name">{entry.username}</span>
                <span className="club-lb-stat club-lb-chips">{entry.chipsWon.toLocaleString()}</span>
                <span className="club-lb-stat">{entry.handsPlayed}</span>
                <span className="club-lb-stat">{entry.biggestPot.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ─── RENDER: Activity Tab ───
  const renderActivityTab = () => {
    const ACTIVITY_ICONS = {
      member_join: '\uD83C\uDF89',
      member_leave: '\uD83D\uDEAA',
      big_win: '\uD83C\uDFC6',
      tournament: '\uD83C\uDFAF',
      announcement: '\uD83D\uDCE2',
    };

    const formatActivityText = (item) => {
      try {
        const data = JSON.parse(item.data);
        switch (item.type) {
          case 'member_join': return `${data.username} joined the club`;
          case 'member_leave': return `${data.username} left the club`;
          case 'big_win': return `${data.username} won a ${data.amount?.toLocaleString() || ''} pot`;
          case 'tournament': return `Tournament: ${data.name || 'started'}`;
          case 'announcement': return `${data.username}: ${data.message || 'New announcement'}`;
          default: return 'Activity';
        }
      } catch {
        return 'Activity';
      }
    };

    return (
      <div className="club-activity-tab">
        {activityFeed.length === 0 && (
          <div className="clubs-empty" style={{ padding: '24px 0' }}>
            No activity yet.
          </div>
        )}

        {activityFeed.map((item) => (
          <div key={item.id} className="club-activity-item">
            <span className="club-activity-icon">{ACTIVITY_ICONS[item.type] || '\u2022'}</span>
            <span className="club-activity-text">{formatActivityText(item)}</span>
            <span className="club-activity-time">{formatTimestamp(item.createdAt)}</span>
          </div>
        ))}
      </div>
    );
  };

  // ─── MAIN RENDER ───
  const content = (
    <div className="clubs-panel-overlay" onClick={onClose}>
      <div className="clubs-panel" onClick={(e) => e.stopPropagation()}>
        <button className="clubs-close-btn" onClick={onClose}>&times;</button>

        {error && (
          <div className="clubs-error">{error}</div>
        )}

        {view === 'list' && renderClubList()}
        {view === 'create' && renderCreateClub()}
        {view === 'join' && renderJoinClub()}
        {view === 'detail' && renderClubDetail()}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
