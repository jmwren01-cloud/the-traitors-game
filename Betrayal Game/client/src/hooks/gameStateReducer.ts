import type { GameState, Player, Role, Vote, ChatMessage, TimerState, VoteTally, GameSettings, RoundRecord, SheriffReport, Whisper, WhisperErrorCode, ConfessionPhase, ConfessionReveal, SuspicionToken, SuspicionTokenPhase, SuspicionTokenErrorCode } from '../types';

type Msg = { type: string; payload: Record<string, unknown> };

export function gameStateReducer(state: GameState | null, msg: Msg): GameState | null {
  switch (msg.type) {
    case 'S2C_GAME_CREATED': {
      const payload = msg.payload as { sessionId: string; playerId: string; playerName: string; sessionToken: string; settings: GameSettings };
      return {
        sessionId: payload.sessionId,
        phase: 'LOBBY',
        players: [],
        myPlayerId: payload.playerId,
        settings: payload.settings,
      };
    }

    case 'S2C_GAME_JOINED': {
      const payload = msg.payload as { sessionId: string; playerId: string; playerName: string; players: Player[]; sessionToken: string; settings: GameSettings };
      return {
        sessionId: payload.sessionId,
        phase: 'LOBBY',
        players: payload.players,
        myPlayerId: payload.playerId,
        settings: payload.settings,
      };
    }

    case 'S2C_SETTINGS_UPDATED': {
      const payload = msg.payload as { settings: GameSettings };
      return state ? { ...state, settings: payload.settings } : null;
    }

    case 'S2C_RECONNECTED': {
      const payload = msg.payload as {
        sessionId: string;
        playerId: string;
        playerName: string;
        players: Player[];
        phase: GameState['phase'];
        role?: Role;
        traitorIds?: string[];
        currentRound: number;
        messages: ChatMessage[];
        votes: Vote[];
        murderVotes: Vote[];
        hostId: string;
        winner?: 'TRAITORS' | 'FAITHFUL';
        banishedPlayerId?: string;
        banishedPlayerName?: string;
        banishedPlayerRole?: Role;
        lastMurderedPlayerId?: string;
        lastMurderedPlayerName?: string;
        timer?: TimerState;
        tiedPlayerIds?: string[];
        tiedPlayerNames?: string[];
        voteCount?: { received: number; needed: number };
        murderVoteProgress?: { received: number; needed: number };
        aliveTraitorCount?: number;
        revealIndex?: number;
        revealOrder?: string[];
        currentTally?: VoteTally[];
        revealedVotes?: Vote[];
        remainingTraitors?: number;
        remainingFaithful?: number;
        tiebreakerResults?: { playerId: string; playerName: string; hasShield: boolean }[];
        randomlySelectedPlayerId?: string;
        randomlySelectedPlayerName?: string;
        randomlySelectedPlayerRole?: Role;
        totalVotes?: number;
        settings: GameSettings;
        history: RoundRecord[];
        whispers?: Whisper[];
        evidenceVotes?: import('../types').EvidenceVote[];
        evidenceVoteProgress?: { received: number; needed: number };
        evidenceWindowEndsAt?: number;
        evidenceUsed?: boolean;
        falseEvidence?: import('../types').FalseEvidence;
        confessionPhase?: ConfessionPhase;
        confessionRevealed?: ConfessionReveal[];
        confessionWindowEndsAt?: number;
        confessionSubmittedCount?: number;
        confessionTotalCount?: number;
        confessionMySubmitted?: boolean;
      };

      let currentReveal = undefined;
      const revealedCount = payload.revealedVotes?.length || 0;
      const totalVoteCount = payload.totalVotes || payload.votes.length;
      if (payload.revealedVotes && revealedCount > 0 && revealedCount < totalVoteCount) {
        const lastVote = payload.revealedVotes[revealedCount - 1];
        if (lastVote) {
          const voter = payload.players.find((p) => p.id === lastVote.voterId);
          const target = payload.players.find((p) => p.id === lastVote.targetId);
          currentReveal = {
            vote: lastVote,
            voterName: voter?.name || 'Unknown',
            targetName: target?.name || 'Unknown',
          };
        }
      }

      return {
        sessionId: payload.sessionId,
        phase: payload.phase,
        players: payload.players,
        myPlayerId: payload.playerId,
        myRole: payload.role,
        traitorIds: payload.traitorIds,
        currentRound: payload.currentRound,
        messages: payload.messages,
        votes: payload.votes,
        winner: payload.winner,
        banishedPlayer: payload.banishedPlayerId && payload.banishedPlayerName && payload.banishedPlayerRole
          ? { id: payload.banishedPlayerId, name: payload.banishedPlayerName, role: payload.banishedPlayerRole }
          : undefined,
        murderedPlayer: payload.lastMurderedPlayerId && payload.lastMurderedPlayerName
          ? { id: payload.lastMurderedPlayerId, name: payload.lastMurderedPlayerName }
          : undefined,
        timer: payload.timer,
        tiedPlayerIds: payload.tiedPlayerIds,
        tiedPlayerNames: payload.tiedPlayerNames,
        voteCount: payload.voteCount,
        murderVoteProgress: payload.murderVoteProgress,
        aliveTraitorCount: payload.aliveTraitorCount,
        revealIndex: payload.revealIndex,
        revealOrder: payload.revealOrder,
        currentTally: payload.currentTally,
        revealedVotes: payload.revealedVotes,
        totalVotes: payload.totalVotes || payload.votes.length,
        remainingTraitors: payload.remainingTraitors,
        remainingFaithful: payload.remainingFaithful,
        tiebreakerResults: payload.tiebreakerResults,
        randomlySelectedPlayer: payload.randomlySelectedPlayerId && payload.randomlySelectedPlayerName && payload.randomlySelectedPlayerRole
          ? { id: payload.randomlySelectedPlayerId, name: payload.randomlySelectedPlayerName, role: payload.randomlySelectedPlayerRole }
          : undefined,
        currentReveal,
        settings: payload.settings,
        history: payload.history ?? [],
        whispers: payload.whispers ?? [],
        ...(payload.evidenceVotes !== undefined ? { evidenceVotes: payload.evidenceVotes } : {}),
        ...(payload.evidenceVoteProgress !== undefined ? { evidenceVoteProgress: payload.evidenceVoteProgress } : {}),
        ...(payload.evidenceWindowEndsAt !== undefined ? { evidenceWindowEndsAt: payload.evidenceWindowEndsAt } : {}),
        ...(payload.evidenceUsed !== undefined ? { evidenceUsed: payload.evidenceUsed } : {}),
        ...(payload.falseEvidence !== undefined ? { falseEvidence: payload.falseEvidence } : {}),
        ...(payload.confessionPhase !== undefined ? { confessionPhase: payload.confessionPhase } : {}),
        ...(payload.confessionRevealed !== undefined ? { confessionRevealed: payload.confessionRevealed, confessionRound: payload.currentRound } : {}),
        ...(payload.confessionWindowEndsAt !== undefined ? { confessionWindowEndsAt: payload.confessionWindowEndsAt } : {}),
        ...(payload.confessionSubmittedCount !== undefined ? { confessionSubmittedCount: payload.confessionSubmittedCount } : {}),
        ...(payload.confessionTotalCount !== undefined ? { confessionTotalCount: payload.confessionTotalCount } : {}),
        ...(payload.confessionMySubmitted !== undefined ? { mySubmittedConfession: payload.confessionMySubmitted } : {}),
        ...((payload as { tokenPhase?: SuspicionTokenPhase }).tokenPhase !== undefined
          ? { tokenPhase: (payload as { tokenPhase?: SuspicionTokenPhase }).tokenPhase }
          : {}),
        ...((payload as { tokenWindowEndsAt?: number }).tokenWindowEndsAt !== undefined
          ? { tokenWindowEndsAt: (payload as { tokenWindowEndsAt?: number }).tokenWindowEndsAt }
          : {}),
        ...((payload as { tokenRevealEndsAt?: number }).tokenRevealEndsAt !== undefined
          ? { tokenRevealEndsAt: (payload as { tokenRevealEndsAt?: number }).tokenRevealEndsAt }
          : {}),
        ...((payload as { tokenSubmittedCount?: number }).tokenSubmittedCount !== undefined
          ? { tokenSubmittedCount: (payload as { tokenSubmittedCount?: number }).tokenSubmittedCount }
          : {}),
        ...((payload as { tokenTotalCount?: number }).tokenTotalCount !== undefined
          ? { tokenTotalCount: (payload as { tokenTotalCount?: number }).tokenTotalCount }
          : {}),
        ...((payload as { myTokenTargetId?: string }).myTokenTargetId !== undefined
          ? { myTokenTargetId: (payload as { myTokenTargetId?: string }).myTokenTargetId }
          : {}),
        ...((payload as { suspicionTokensCurrent?: SuspicionToken[] }).suspicionTokensCurrent !== undefined
          ? { suspicionTokensCurrent: (payload as { suspicionTokensCurrent?: SuspicionToken[] }).suspicionTokensCurrent }
          : {}),
        ...((payload as { suspicionTokensByRound?: Record<number, SuspicionToken[]> }).suspicionTokensByRound !== undefined
          ? { suspicionTokensByRound: (payload as { suspicionTokensByRound?: Record<number, SuspicionToken[]> }).suspicionTokensByRound }
          : {}),
      };
    }

    case 'S2C_TOKEN_PHASE_STARTED': {
      const payload = msg.payload as { endsAt: number; duration: number; aliveCount: number; round: number };
      if (!state) return null;
      return {
        ...state,
        tokenPhase: 'PLACEMENT',
        tokenWindowEndsAt: payload.endsAt,
        tokenRevealEndsAt: undefined,
        tokenSubmittedCount: 0,
        tokenTotalCount: payload.aliveCount,
        myTokenTargetId: undefined,
        suspicionTokensCurrent: [],
        tokenError: undefined,
      };
    }

    case 'S2C_TOKEN_PLACED': {
      const payload = msg.payload as { received: number; needed: number };
      if (!state) return null;
      return {
        ...state,
        tokenSubmittedCount: payload.received,
        tokenTotalCount: payload.needed,
      };
    }

    case 'S2C_TOKEN_PLACED_PRIVATE': {
      const payload = msg.payload as { targetId: string };
      if (!state) return null;
      return { ...state, myTokenTargetId: payload.targetId, tokenError: undefined };
    }

    case 'S2C_TOKENS_REVEALED': {
      const payload = msg.payload as { tokens: SuspicionToken[]; round: number; revealEndsAt: number };
      if (!state) return null;
      const round = payload.round;
      const archive = { ...(state.suspicionTokensByRound ?? {}), [round]: payload.tokens };
      return {
        ...state,
        tokenPhase: 'REVEAL',
        tokenWindowEndsAt: undefined,
        tokenRevealEndsAt: payload.revealEndsAt,
        suspicionTokensCurrent: payload.tokens,
        suspicionTokensByRound: archive,
      };
    }

    case 'S2C_TOKEN_ERROR': {
      const payload = msg.payload as { code: SuspicionTokenErrorCode; message: string };
      if (!state) return null;
      return { ...state, tokenError: payload };
    }

    case 'CLIENT_CLEAR_TOKEN_ERROR': {
      if (!state) return null;
      const { tokenError: _drop, ...rest } = state;
      void _drop;
      return rest;
    }

    case 'S2C_PLAYER_DISCONNECTED': {
      const payload = msg.payload as { playerId: string; players: Player[] };
      return state ? { ...state, players: payload.players } : null;
    }

    case 'S2C_PLAYER_RECONNECTED': {
      const payload = msg.payload as { playerId: string; players: Player[] };
      return state ? { ...state, players: payload.players } : null;
    }

    case 'S2C_PLAYER_JOINED': {
      const payload = msg.payload as { players: Player[] };
      return state ? { ...state, players: payload.players } : null;
    }

    case 'S2C_GAME_STARTED': {
      const payload = msg.payload as { phase: string };
      return state ? { ...state, phase: payload.phase as GameState['phase'] } : null;
    }

    case 'S2C_ROLES_ASSIGNED': {
      const payload = msg.payload as { phase: string };
      return state ? { ...state, phase: payload.phase as GameState['phase'] } : null;
    }

    case 'S2C_ROLE_REVEAL': {
      const payload = msg.payload as { role: Role; phase: string; traitorIds?: string[] };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        myRole: payload.role,
        traitorIds: payload.traitorIds,
      } : null;
    }

    case 'S2C_ROUNDTABLE_STARTED': {
      const payload = msg.payload as { phase: string; currentRound?: number };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        currentRound: payload.currentRound ?? state.currentRound,
        votes: [],
        voteCount: undefined,
        revealIndex: undefined,
        revealOrder: undefined,
        revealedVotes: [],
        currentTally: undefined,
        totalVotes: undefined,
        currentReveal: undefined,
        banishedPlayer: undefined,
        tiedPlayerIds: undefined,
        tiedPlayerNames: undefined,
        // Reset booth state for the new round; the BOOTH overlay will be
        // (re)opened by the imminent S2C_CONFESSION_PHASE_STARTED.
        confessionPhase: undefined,
        confessionRevealed: undefined,
        confessionWindowEndsAt: undefined,
        confessionSubmittedCount: undefined,
        confessionTotalCount: undefined,
        mySubmittedConfession: false,
        confessionRound: undefined,
        // Reset the Suspicion Token sub-phase for the new round. The
        // host will reopen it later via C2S_START_VOTING.
        tokenPhase: undefined,
        tokenWindowEndsAt: undefined,
        tokenRevealEndsAt: undefined,
        tokenSubmittedCount: undefined,
        tokenTotalCount: undefined,
        myTokenTargetId: undefined,
        suspicionTokensCurrent: undefined,
        tokenError: undefined,
      } : null;
    }

    case 'S2C_CONFESSION_PHASE_STARTED': {
      const payload = msg.payload as { endsAt: number; duration: number; aliveCount: number };
      if (!state) return null;
      return {
        ...state,
        confessionPhase: 'BOOTH',
        confessionWindowEndsAt: payload.endsAt,
        confessionSubmittedCount: 0,
        confessionTotalCount: payload.aliveCount,
        confessionRevealed: undefined,
        mySubmittedConfession: false,
      };
    }

    case 'S2C_CONFESSION_SUBMITTED': {
      const payload = msg.payload as { received: number; needed: number };
      if (!state) return null;
      return {
        ...state,
        confessionSubmittedCount: payload.received,
        confessionTotalCount: payload.needed,
      };
    }

    case 'S2C_CONFESSIONS_REVEALED': {
      const payload = msg.payload as { reveals: ConfessionReveal[]; round: number };
      if (!state) return null;
      return {
        ...state,
        confessionPhase: 'DISCUSSION',
        confessionRevealed: payload.reveals,
        confessionRound: payload.round,
        confessionWindowEndsAt: undefined,
      };
    }

    case 'CLIENT_MY_CONFESSION_SUBMITTED': {
      if (!state) return null;
      return { ...state, mySubmittedConfession: true };
    }

    case 'S2C_VOTING_STARTED': {
      const payload = msg.payload as { phase: string };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        votes: [],
        voteCount: undefined,
        revealIndex: undefined,
        revealOrder: undefined,
        revealedVotes: [],
        currentTally: undefined,
        totalVotes: undefined,
        currentReveal: undefined,
        // strip the live token sub-phase scaffolding once
        // voting begins. The current round's tokens stay archived in
        // `suspicionTokensByRound`.
        tokenPhase: undefined,
        tokenWindowEndsAt: undefined,
        tokenRevealEndsAt: undefined,
        tokenSubmittedCount: undefined,
        tokenTotalCount: undefined,
        myTokenTargetId: undefined,
        tokenError: undefined,
      } : null;
    }

    case 'S2C_REVOTE_STARTED': {
      const payload = msg.payload as { tiedPlayerIds: string[]; phase: string };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        tiedPlayerIds: payload.tiedPlayerIds,
        votes: [],
        voteCount: undefined,
        revealIndex: undefined,
        revealOrder: undefined,
        revealedVotes: [],
        currentTally: undefined,
        totalVotes: undefined,
        currentReveal: undefined,
      } : null;
    }

    case 'S2C_VOTE_SUBMITTED': {
      return state;
    }

    case 'S2C_VOTE_COUNT_UPDATE': {
      const payload = msg.payload as { received: number; needed: number };
      return state ? { ...state, voteCount: payload } : null;
    }

    case 'S2C_VOTES_REVEALED': {
      const payload = msg.payload as { votes: Vote[]; phase: string };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        votes: payload.votes,
      } : null;
    }

    case 'S2C_VOTE_REVEAL_STARTED': {
      const payload = msg.payload as { phase: string; revealOrder: string[]; totalVotes: number };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        revealOrder: payload.revealOrder,
        revealIndex: 0,
        revealedVotes: [],
        currentTally: [],
        currentReveal: undefined,
        totalVotes: payload.totalVotes,
      } : null;
    }

    case 'S2C_VOTE_REVEAL_STEP': {
      const payload = msg.payload as {
        revealIndex: number;
        vote: Vote;
        voterName: string;
        targetName: string;
        currentTally: VoteTally[];
      };
      if (!state) return null;
      const revealedVotes = [...(state.revealedVotes || []), payload.vote];
      return {
        ...state,
        revealIndex: payload.revealIndex + 1,
        revealedVotes,
        currentTally: payload.currentTally,
        currentReveal: {
          vote: payload.vote,
          voterName: payload.voterName,
          targetName: payload.targetName,
        },
      };
    }

    case 'S2C_VOTE_REVEAL_COMPLETE': {
      const payload = msg.payload as {
        allVotes: Vote[];
        finalTally: VoteTally[];
        totalVotes: number;
        revealIndex: number;
        phase: string;
      };
      return state ? {
        ...state,
        votes: payload.allVotes,
        currentTally: payload.finalTally,
        revealedVotes: payload.allVotes,
        revealIndex: payload.totalVotes,
        totalVotes: payload.totalVotes,
        phase: payload.phase as GameState['phase'],
        currentReveal: undefined,
      } : null;
    }

    case 'S2C_TIE_DETECTED': {
      const payload = msg.payload as { tiedPlayerIds: string[]; tiedPlayerNames: string[]; phase: string };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        tiedPlayerIds: payload.tiedPlayerIds,
        tiedPlayerNames: payload.tiedPlayerNames,
        voteCount: undefined,
      } : null;
    }

    case 'S2C_PLAYER_BANISHED': {
      const payload = msg.payload as { banishedPlayerId: string; banishedPlayerName: string; banishedPlayerRole: Role; phase: string };
      if (!state) return null;
      return {
        ...state,
        phase: payload.phase as GameState['phase'],
        banishedPlayer: {
          id: payload.banishedPlayerId,
          name: payload.banishedPlayerName,
          role: payload.banishedPlayerRole,
        },
        players: state.players.map((p) =>
          p.id === payload.banishedPlayerId ? { ...p, isAlive: false } : p
        ),
        tiedPlayerIds: undefined,
        tiedPlayerNames: undefined,
        randomlySelectedPlayer: undefined,
      };
    }

    case 'S2C_TIEBREAKER_RESOLVED': {
      const payload = msg.payload as {
        selectedPlayerId: string;
        selectedPlayerName: string;
        selectedPlayerRole: Role;
        tiedPlayerIds: string[];
        tiedPlayerNames: string[];
        phase: string;
      };
      if (!state) return null;
      return {
        ...state,
        phase: payload.phase as GameState['phase'],
        randomlySelectedPlayer: {
          id: payload.selectedPlayerId,
          name: payload.selectedPlayerName,
          role: payload.selectedPlayerRole,
        },
        banishedPlayer: {
          id: payload.selectedPlayerId,
          name: payload.selectedPlayerName,
          role: payload.selectedPlayerRole,
        },
        tiedPlayerIds: payload.tiedPlayerIds,
        tiedPlayerNames: payload.tiedPlayerNames,
        players: state.players.map((p) =>
          p.id === payload.selectedPlayerId ? { ...p, isAlive: false } : p
        ),
      };
    }

    case 'S2C_NIGHT_STARTED': {
      const payload = msg.payload as { phase: string; currentRound: number; aliveTraitorCount: number };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        currentRound: payload.currentRound,
        aliveTraitorCount: payload.aliveTraitorCount,
        murderVoteProgress: undefined,
        murderVoterIds: [],
        justRecruited: undefined,
        recruitedPlayer: undefined,
        nightRecruitmentSubmittedBy: undefined,
        nightRecruitmentTargetId: undefined,
        nightRecruitmentTargetName: undefined,
        // Wave 4 — the previous night's Medic confirmation and any silent-block
        // banner are stale once a new night begins. The Sheriff investigation
        // history (sheriffReports) is preserved across the whole game.
        medicProtectedTarget: undefined,
        medicBlocked: undefined,
      } : null;
    }

    case 'S2C_SHERIFF_RESULT': {
      const payload = msg.payload as unknown as SheriffReport;
      if (!state) return null;
      // Append to the running history, de-duped by (round, targetId) so a
      // re-broadcast on reconnect does not double-count.
      const prior = state.sheriffReports ?? [];
      const dupe = prior.some(
        (r) => r.round === payload.round && r.targetId === payload.targetId
      );
      const sheriffReports = dupe ? prior : [...prior, payload];
      return { ...state, sheriffReports };
    }

    case 'S2C_MEDIC_PROTECTED': {
      const payload = msg.payload as { targetId: string; targetName: string };
      if (!state) return null;
      // Mirror server-side bookkeeping so the UI can disable the same target next night.
      return {
        ...state,
        medicProtectedTarget: { id: payload.targetId, name: payload.targetName },
        players: state.players.map((p) =>
          p.id === state.myPlayerId
            ? { ...p, medicLastProtectedTargetId: payload.targetId }
            : p
        ),
      };
    }

    case 'S2C_SEER_RESULT': {
      const payload = msg.payload as { targetId: string; targetName: string; actualRole: Role };
      if (!state) return null;
      return {
        ...state,
        seerResult: payload,
        players: state.players.map((p) =>
          p.id === state.myPlayerId ? { ...p, seerGiftUsed: true } : p
        ),
      };
    }

    case 'S2C_SEER_ACTIVATED': {
      // Sent only to alive Traitors. The payload intentionally hides identities.
      return state ? { ...state, seerActivatedAlert: true } : null;
    }

    case 'S2C_MURDER_SUBMITTED': {
      const payload = msg.payload as { voterId: string; votesReceived: number; votesNeeded: number };
      return state ? {
        ...state,
        murderVoteProgress: { received: payload.votesReceived, needed: payload.votesNeeded },
        murderVoterIds: [...(state.murderVoterIds ?? []), payload.voterId].filter((v, i, a) => a.indexOf(v) === i),
      } : null;
    }

    case 'S2C_MURDER_RESOLVED': {
      const payload = msg.payload as {
        murderedPlayerId: string;
        murderedPlayerName: string;
        phase: string;
        recruitedPlayerId?: string;
        recruitedPlayerName?: string;
        recruitmentOccurred?: boolean;
      };
      if (!state) return null;
      return {
        ...state,
        phase: payload.phase as GameState['phase'],
        murderedPlayer: { id: payload.murderedPlayerId, name: payload.murderedPlayerName },
        players: state.players.map((p) =>
          p.id === payload.murderedPlayerId ? { ...p, isAlive: false } : p
        ),
        recruitedPlayer: payload.recruitedPlayerId && payload.recruitedPlayerName
          ? { id: payload.recruitedPlayerId, name: payload.recruitedPlayerName }
          : payload.recruitmentOccurred
          ? { id: '__occurred__', name: '' }
          : undefined,
      };
    }

    case 'S2C_MORNING_STARTED': {
      const payload = msg.payload as {
        phase: string;
        lastMurderedPlayerId?: string;
        lastMurderedPlayerName?: string;
        murderBlocked?: boolean;
        shieldedPlayerId?: string;
        shieldedPlayerName?: string;
        medicBlocked?: boolean;
        recruitedPlayerId?: string;
        recruitedPlayerName?: string;
        recruitmentOccurred?: boolean;
      };
      // Distinguish the two block flavours: Shield publicly outs the
      // protected identity, while Medic's block must NOT — only the
      // generic "target survived" banner is shown.
      const shieldBlock =
        payload.murderBlocked === true && payload.shieldedPlayerId !== undefined
          ? { shieldedPlayerId: payload.shieldedPlayerId, shieldedPlayerName: payload.shieldedPlayerName! }
          : undefined;
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        murderedPlayer: payload.lastMurderedPlayerId
          ? { id: payload.lastMurderedPlayerId, name: payload.lastMurderedPlayerName || '' }
          : undefined,
        murderBlocked: shieldBlock,
        medicBlocked: payload.medicBlocked === true,
        recruitedPlayer: payload.recruitedPlayerId && payload.recruitedPlayerName
          ? { id: payload.recruitedPlayerId, name: payload.recruitedPlayerName }
          : payload.recruitmentOccurred
          ? { id: '__occurred__', name: '' }
          : undefined,
      } : null;
    }

    case 'S2C_CONTINUE_GAME': {
      const payload = msg.payload as { phase: string; currentRound: number };
      if (!state) return null;
      // Preserve the shield-blocked banner when the server transitions us
      // into BANISH_REVEAL after a successful shield reveal; otherwise clear
      // it (every other CONTINUE means a fresh round / phase).
      const keepShieldBlock =
        state.shieldBlockedBanishment && payload.phase === 'BANISH_REVEAL';
      return {
        ...state,
        phase: payload.phase as GameState['phase'],
        currentRound: payload.currentRound,
        banishedPlayer: undefined,
        murderedPlayer: undefined,
        murderBlocked: undefined,
        medicBlocked: undefined,
        votes: undefined,
        ...(keepShieldBlock
          ? {}
          : { shieldBlockedBanishment: false, shieldBlockedBanishmentName: undefined }),
      };
    }

    case 'S2C_CHALLENGE_STARTED': {
      const payload = msg.payload as {
        phase: string;
        challengeType: 'TIME_ESTIMATE' | 'MISSING_PLAYER' | 'WORD_SCRAMBLE';
        startTime: number;
        targetTime?: number;
        shownPlayerIds?: string[];
        scrambledWord?: string;
        endTime?: number;
        duration?: number;
        eligibleCount?: number;
      };
      if (!state) return null;
      const next: GameState = {
        ...state,
        phase: payload.phase as GameState['phase'],
        challenge: {
          type: payload.challengeType,
          startTime: payload.startTime,
          targetTime: payload.targetTime,
          shownPlayerIds: payload.shownPlayerIds,
          scrambledWord: payload.scrambledWord,
          completed: false,
          answeredCount: 0,
          eligibleCount: payload.eligibleCount,
        },
      };
      if (payload.endTime !== undefined && payload.duration !== undefined) {
        next.timer = { endTime: payload.endTime, duration: payload.duration, phase: 'CHALLENGE' };
      }
      return next;
    }

    case 'S2C_CHALLENGE_ANSWER_RECEIVED': {
      const payload = msg.payload as { playerId: string; received: number; needed: number };
      if (!state || !state.challenge) return state;
      return {
        ...state,
        challenge: {
          ...state.challenge,
          answeredCount: payload.received,
          eligibleCount: payload.needed,
        },
      };
    }

    case 'S2C_CHALLENGE_PHASE_UPDATE': {
      const payload = msg.payload as { hiddenPlayerId?: string };
      if (!state || !state.challenge) return state;
      return {
        ...state,
        challenge: {
          ...state.challenge,
          hiddenPlayerId: payload.hiddenPlayerId,
        },
      };
    }

    case 'S2C_CHALLENGE_RESULT': {
      const payload = msg.payload as {
        phase: string;
        winnerId?: string;
        winnerName?: string;
        correctAnswer?: string | number;
        shieldAwarded?: boolean;
      };
      if (!state) return null;
      let updatedPlayers = state.players;
      // Only update local hasShield when *we* are the winner. The server
      // only sends `shieldAwarded` to the winner, but guard on identity
      // as well so we never reflect another player's shield in our state.
      if (
        payload.winnerId &&
        payload.shieldAwarded === true &&
        payload.winnerId === state.myPlayerId
      ) {
        updatedPlayers = state.players.map((p) =>
          p.id === payload.winnerId ? { ...p, hasShield: true } : p
        );
      }
      return {
        ...state,
        phase: payload.phase as GameState['phase'],
        players: updatedPlayers,
        challenge: state.challenge ? {
          ...state.challenge,
          winnerId: payload.winnerId,
          winnerName: payload.winnerName,
          correctAnswer: payload.correctAnswer,
          shieldAwarded: payload.shieldAwarded,
          completed: true,
        } : undefined,
      };
    }

    case 'S2C_SHIELD_REVEALED': {
      const payload = msg.payload as { playerId: string; playerName: string; banishmentBlocked?: boolean };
      if (!state) return null;
      return {
        ...state,
        // When the shield blocks a banishment the server also consumes hasShield;
        // we mirror that on the client so the UI doesn't keep offering "Reveal Shield".
        players: state.players.map((p) =>
          p.id === payload.playerId
            ? { ...p, shieldRevealed: true, hasShield: payload.banishmentBlocked ? false : p.hasShield }
            : p
        ),
        ...(payload.banishmentBlocked
          ? { shieldBlockedBanishment: true, shieldBlockedBanishmentName: payload.playerName }
          : {}),
      };
    }

    case 'S2C_AVATAR_UPDATED': {
      const payload = msg.payload as { players: Player[] };
      return state ? { ...state, players: payload.players } : null;
    }

    case 'S2C_GAME_END': {
      const payload = msg.payload as { winner?: 'TRAITORS' | 'FAITHFUL'; phase: string; remainingTraitors: number; remainingFaithful: number; history: RoundRecord[]; reason?: 'HOST_ENDED'; whispers?: Whisper[]; falseEvidence?: import('../types').FalseEvidence };
      return state ? {
        ...state,
        phase: payload.phase as GameState['phase'],
        winner: payload.winner,
        endReason: payload.reason,
        remainingTraitors: payload.remainingTraitors,
        remainingFaithful: payload.remainingFaithful,
        history: payload.history ?? [],
        // post-game replay reveals every whisper's content.
        whispers: payload.whispers ?? state.whispers ?? [],
        // Wave 4 / 3 — surfaced to everyone for the post-game reveal.
        falseEvidence: payload.falseEvidence ?? state.falseEvidence,
      } : null;
    }

    case 'S2C_WHISPER_SENT': {
      // Append meta-only entry, deduped by id (recipient may have already
      // received the content-bearing S2C_WHISPER_RECEIVED first).
      const payload = msg.payload as unknown as Omit<Whisper, 'content'>;
      if (!state) return null;
      const existing = state.whispers ?? [];
      if (existing.some((w) => w.id === payload.id)) return state;
      return { ...state, whispers: [...existing, payload] };
    }

    case 'S2C_WHISPER_RECEIVED': {
      // Upgrade meta entry to the full content-bearing version (or append).
      const payload = msg.payload as unknown as Whisper;
      if (!state) return null;
      const existing = state.whispers ?? [];
      const idx = existing.findIndex((w) => w.id === payload.id);
      const next = idx >= 0
        ? existing.map((w, i) => (i === idx ? payload : w))
        : [...existing, payload];
      return { ...state, whispers: next, lastWhisperReceivedId: payload.id };
    }

    case 'S2C_WHISPER_ERROR': {
      const payload = msg.payload as { code: WhisperErrorCode; message: string };
      if (!state) return null;
      return { ...state, whisperError: payload };
    }

    case 'CLIENT_CLEAR_WHISPER_ERROR': {
      if (!state) return null;
      const { whisperError: _drop, ...rest } = state;
      void _drop;
      return rest as GameState;
    }

    case 'CLIENT_MARK_WHISPER_READ': {
      const payload = msg.payload as { id: string };
      if (!state) return null;
      const prior = state.whispersRead ?? [];
      if (prior.includes(payload.id)) return state;
      return { ...state, whispersRead: [...prior, payload.id] };
    }

    case 'CLIENT_MARK_ALL_WHISPERS_READ': {
      if (!state) return null;
      const ids = (state.whispers ?? [])
        .filter((w) => w.recipientId === state.myPlayerId && !!w.content)
        .map((w) => w.id);
      const merged = Array.from(new Set([...(state.whispersRead ?? []), ...ids]));
      return { ...state, whispersRead: merged };
    }

    case 'S2C_HOST_TRANSFERRED': {
      const payload = msg.payload as { newHostId: string; newHostName: string; players: Player[] };
      return state ? { ...state, players: payload.players } : null;
    }

    case 'S2C_CHAT_MESSAGE': {
      const payload = msg.payload as unknown as ChatMessage;
      if (!state) return null;
      const existingMessages = state.messages || [];
      if (existingMessages.some((m) => m.id === payload.id)) {
        return state;
      }
      return {
        ...state,
        messages: [...existingMessages, payload],
      };
    }

    case 'S2C_TIMER_UPDATE': {
      const payload = msg.payload as { endTime: number; duration: number; phase: string };
      return state ? {
        ...state,
        timer: {
          endTime: payload.endTime,
          duration: payload.duration,
          phase: payload.phase as TimerState['phase'],
        },
      } : null;
    }

    case 'S2C_RECRUITMENT_SUBMITTED': {
      const payload = msg.payload as {
        recruiterId: string;
        recruiterName: string;
        targetId: string;
        targetName: string;
      };
      if (!state) return null;
      return {
        ...state,
        players: state.players.map((p) =>
          p.id === payload.recruiterId ? { ...p, recruitmentUsed: true } : p
        ),
        nightRecruitmentSubmittedBy: payload.recruiterId,
        nightRecruitmentTargetId: payload.targetId,
        nightRecruitmentTargetName: payload.targetName,
      };
    }

    case 'S2C_YOU_WERE_RECRUITED': {
      const payload = msg.payload as { traitorIds: string[] };
      if (!state) return null;
      return {
        ...state,
        myRole: 'TRAITOR' as Role,
        traitorIds: payload.traitorIds,
        players: state.players.map((p) =>
          p.id === state.myPlayerId ? { ...p, role: 'TRAITOR' as Role, recruitmentUsed: true } : p
        ),
        justRecruited: true,
      };
    }

    case 'S2C_PLAYER_RECRUITED': {
      const payload = msg.payload as { newTraitorId: string; newTraitorName: string; updatedTraitorIds: string[] };
      if (!state) return null;
      return {
        ...state,
        traitorIds: payload.updatedTraitorIds,
        players: state.players.map((p) =>
          p.id === payload.newTraitorId ? { ...p, role: 'TRAITOR' as Role, recruitmentUsed: true } : p
        ),
      };
    }

    case 'S2C_EVIDENCE_VOTE_CAST': {
      const payload = msg.payload as { votes: import('../types').EvidenceVote[]; received: number; needed: number; windowEndsAt?: number };
      if (!state) return null;
      const { evidenceLastFailure: _lf, ...restState } = state;
      void _lf;
      return {
        ...(restState as GameState),
        evidenceVotes: payload.votes,
        evidenceVoteProgress: { received: payload.received, needed: payload.needed },
        ...(payload.windowEndsAt !== undefined ? { evidenceWindowEndsAt: payload.windowEndsAt } : {}),
      };
    }

    case 'S2C_EVIDENCE_PLANTED': {
      const payload = msg.payload as { evidence: import('../types').FalseEvidence };
      if (!state) return null;
      const { evidenceVotes: _v, evidenceVoteProgress: _p, evidenceWindowEndsAt: _w, evidenceLastFailure: _f, ...rest } = state;
      void _v; void _p; void _w; void _f;
      return {
        ...(rest as GameState),
        falseEvidence: payload.evidence,
        evidenceUsed: true,
      };
    }

    case 'S2C_EVIDENCE_FAILED': {
      const payload = msg.payload as { reason: 'SKIPPED' | 'NO_AGREEMENT' | 'TIMEOUT' };
      if (!state) return null;
      const { evidenceVotes: _v, evidenceVoteProgress: _p, evidenceWindowEndsAt: _w, ...rest } = state;
      void _v; void _p; void _w;
      return {
        ...(rest as GameState),
        evidenceLastFailure: payload.reason,
      };
    }

    default:
      return state;
  }
}
