import { useState, useEffect, useRef } from 'react';
import type { GamePhase } from './types';
import { useWebSocket } from './hooks/useWebSocket';
import { Lobby } from './components/Lobby';
import { RoleReveal } from './components/RoleReveal';
import { Voting } from './components/Voting';
import { ConfessionBooth } from './components/ConfessionBooth';
import { SuspicionTokens } from './components/SuspicionTokens';
import { NightPhase } from './components/NightPhase';
import { GameEnd } from './components/GameEnd';
import { ChatBox } from './components/ChatBox';
import { Timer } from './components/Timer';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Challenge } from './components/Challenge';
import { Spectator } from './components/Spectator';
import { HostPanel } from './components/HostPanel';
import { PhaseIntroCard } from './components/PhaseIntroCard';
import { HUD } from './components/HUD';
import { SpecialRoleHud } from './components/SpecialRoleHud';
import hudStyles from './components/HUD.module.css';
import { useSoundContext } from './contexts/SoundContext';
import './App.css';

function App() {
  const {
    connected, gameState, error, send, dispatchLocal, reconnecting,
    identity, identifyError, identify,
    playerStats, leaderboard, globalStats,
  } = useWebSocket();
  const { setEnabled } = useSoundContext();
  // Initialise from the persisted `betrayal_muted` localStorage key so the
  // user's mute choice survives a refresh. The sound system handles the
  // same key internally; we mirror it here only for the toggle's icon state.
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('betrayal_muted') !== '1';
    } catch {
      return true;
    }
  });

  // Sync the synth's enabled flag with the React state on mount and on toggle.
  useEffect(() => {
    setEnabled(soundOn);
  }, [soundOn, setEnabled]);

  const toggleSound = () => {
    setSoundOn((prev) => !prev);
  };

  const soundToggle = (
    <button 
      className={`sound-toggle ${soundOn ? 'sound-on' : 'sound-off'}`}
      onClick={toggleSound}
      aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
    >
      {soundOn ? '🔊' : '🔇'}
    </button>
  );

  if (!connected && !reconnecting) {
    return (
      <div className="loading-screen">
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        <div className="spinner"></div>
        <p>Connecting to server...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-toast">
        <p>{error}</p>
      </div>
    );
  }

  const phase = gameState?.phase || 'LOBBY';
  // Confession Booth overlay visibility. The overlay shows
  // for the entire BOOTH window and stays up after reveal until the local
  // player presses "Begin Discussion". `boothDismissed` resets every time
  // a fresh booth opens so the overlay always re-appears next round.
  const [boothDismissed, setBoothDismissed] = useState(false);
  const confessionPhase = gameState?.confessionPhase;
  useEffect(() => {
    if (confessionPhase === 'BOOTH') setBoothDismissed(false);
  }, [confessionPhase, gameState?.currentRound]);
  const boothActive =
    phase === 'ROUNDTABLE' &&
    (confessionPhase === 'BOOTH' ||
      (confessionPhase === 'DISCUSSION' && !!gameState?.confessionRevealed && !boothDismissed));
  // Suspicion Tokens overlay — PLACEMENT (45s) + REVEAL (5s). Booth
  // takes priority if both are ever active.
  const tokenPhaseLocal = gameState?.tokenPhase;
  const tokenOverlayActive =
    phase === 'ROUNDTABLE' && tokenPhaseLocal !== undefined && !boothActive;
  const showChat =
    gameState && phase !== 'LOBBY' && phase !== 'ROLE_ASSIGN' && !boothActive && !tokenOverlayActive;
  const isChatDisabled = phase === 'ROLE_REVEAL';
  const specialRoleHud = gameState ? (
    <SpecialRoleHud
      phase={phase}
      myPlayerId={gameState.myPlayerId}
      myRole={gameState.myRole}
      players={gameState.players}
      traitorIds={gameState.traitorIds}
      sheriffReports={gameState.sheriffReports}
      medicProtectedTarget={gameState.medicProtectedTarget}
      seerResult={gameState.seerResult}
      seerActivatedAlert={gameState.seerActivatedAlert}
      onSend={send}
    />
  ) : null;
  const myPlayer = gameState?.players?.find((p) => p.id === gameState?.myPlayerId);
  const isAlive = myPlayer?.isAlive ?? true;

  // First-occurrence-per-session phase intro cards. Tracked in a ref so the
  // card never re-fires on re-renders or when the same phase recurs later
  // in the game. We also gate firing on observing an actual phase TRANSITION
  // (not the initial render) so that a reconnect mid-VOTING/NIGHT does not
  // pop a tutorial card the player has already lived through.
  const seenPhaseIntrosRef = useRef<Set<string>>(new Set());
  const prevPhaseRef = useRef<GamePhase | null>(null);
  const [introCardPhase, setIntroCardPhase] = useState<GamePhase | null>(null);
  useEffect(() => {
    if (!gameState) return;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    // Skip the very first observation (initial mount or first gameState arrival)
    // and any non-transition re-renders so reconnects do not re-trigger cards.
    if (prev === null || prev === phase) return;
    const introPhases: GamePhase[] = ['VOTING', 'NIGHT', 'REVOTE', 'CHALLENGE', 'MORNING'];
    if (introPhases.includes(phase) && !seenPhaseIntrosRef.current.has(phase)) {
      seenPhaseIntrosRef.current.add(phase);
      setIntroCardPhase(phase);
    }
  }, [phase, gameState]);
  const phaseIntroCard = introCardPhase ? (
    <PhaseIntroCard phase={introCardPhase} onDismiss={() => setIntroCardPhase(null)} />
  ) : null;

  const minPlayers = gameState?.settings?.minPlayers ?? 5;
  const canStartGame = phase === 'LOBBY' && (gameState?.players?.length ?? 0) >= minPlayers;
  const hostPanel = gameState ? (
    <HostPanel
      players={gameState.players || []}
      myPlayerId={gameState.myPlayerId}
      phase={phase}
      votes={gameState.votes}
      revealedVotes={gameState.revealedVotes}
      voteCount={gameState.voteCount}
      murderVoteProgress={gameState.murderVoteProgress}
      murderVoterIds={gameState.murderVoterIds}
      traitorIds={gameState.traitorIds}
      currentRound={gameState.currentRound}
      tiedPlayerIds={gameState.tiedPlayerIds}
      timer={gameState.timer}
      canStartGame={canStartGame}
      minPlayers={minPlayers}
      round1DiscussionOnly={gameState.settings?.round1DiscussionOnly ?? false}
      onSend={send}
    />
  ) : null;

  const chatBox = showChat ? (
    <ChatBox
      messages={gameState?.messages || []}
      myPlayerId={gameState?.myPlayerId}
      myRole={gameState?.myRole}
      isAlive={isAlive}
      onSend={send}
      disabled={isChatDisabled}
      players={gameState?.players || []}
      confessions={gameState?.confessionRevealed ?? []}
      {...(gameState?.confessionRound !== undefined ? { confessionRound: gameState.confessionRound } : {})}
    />
  ) : null;

  const timer = gameState?.timer && gameState.timer.phase === phase ? (
    <Timer endTime={gameState.timer.endTime} />
  ) : null;

  // Persistent top HUD + action prompt. Only rendered for in-game phases —
  // hidden in LOBBY, ROLE_ASSIGN, ROLE_REVEAL and GAME_END so those screens
  // keep their full-bleed layouts.
  const hud = gameState ? (
    <>
      <HUD
        phase={phase}
        myPlayerId={gameState.myPlayerId}
        myRole={gameState.myRole}
        players={gameState.players || []}
        traitorIds={gameState.traitorIds}
        currentRound={gameState.currentRound}
        voteCount={gameState.voteCount}
        votes={gameState.votes}
        banishedName={gameState.banishedPlayer?.name}
      />
      <div className={hudStyles.spacer} aria-hidden />
    </>
  ) : null;

  if (phase === 'GAME_END') {
    return (
      <>
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        {soundToggle}
        <GameEnd
          winner={gameState?.winner}
          endReason={gameState?.endReason}
          players={gameState?.players || []}
          myRole={gameState?.myRole}
          history={gameState?.history}
          whispers={gameState?.whispers}
          falseEvidence={gameState?.falseEvidence}
          myPlayerId={gameState?.myPlayerId}
          playerStats={playerStats}
          leaderboard={leaderboard}
          globalStats={globalStats}
          onSend={send}
        />
        {chatBox}
      </>
    );
  }

  // Dead player spectator mode — shown for all active game phases except GAME_END
  const spectatorPhases = ['ROUNDTABLE','VOTING','VOTE_REVEAL','TIE_DETECTED','REVOTE','TIEBREAKER_REVEAL','BANISH_REVEAL','CHECK_WIN','NIGHT','MORNING','CHALLENGE','CHALLENGE_RESULT'];
  if (!isAlive && spectatorPhases.includes(phase)) {
    return (
      <>
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        {soundToggle}
        {hud}
        {hostPanel}
        {phaseIntroCard}
        {timer}
        {tokenOverlayActive && tokenPhaseLocal && (
          <SuspicionTokens
            phase={tokenPhaseLocal}
            players={gameState?.players ?? []}
            {...(gameState?.myPlayerId !== undefined ? { myPlayerId: gameState.myPlayerId } : {})}
            isAlive={false}
            {...(gameState?.tokenWindowEndsAt !== undefined ? { windowEndsAt: gameState.tokenWindowEndsAt } : {})}
            {...(gameState?.tokenRevealEndsAt !== undefined ? { revealEndsAt: gameState.tokenRevealEndsAt } : {})}
            {...(gameState?.tokenSubmittedCount !== undefined ? { submittedCount: gameState.tokenSubmittedCount } : {})}
            {...(gameState?.tokenTotalCount !== undefined ? { totalCount: gameState.tokenTotalCount } : {})}
            {...(gameState?.suspicionTokensCurrent !== undefined ? { tokens: gameState.suspicionTokensCurrent } : {})}
            {...(gameState?.suspicionTokensByRound !== undefined ? { pastRounds: gameState.suspicionTokensByRound } : {})}
            onSend={send}
            onClearError={() => dispatchLocal({ type: 'CLIENT_CLEAR_TOKEN_ERROR' })}
          />
        )}
        <Spectator
          players={gameState?.players || []}
          myPlayerId={gameState?.myPlayerId}
          phase={phase}
          currentRound={gameState?.currentRound}
          banishedPlayer={gameState?.banishedPlayer}
          murderedPlayer={gameState?.murderedPlayer}
          murderBlocked={gameState?.murderBlocked}
          voteCount={gameState?.voteCount}
          revealedVotes={gameState?.revealedVotes}
          currentTally={gameState?.currentTally}
          totalVotes={gameState?.totalVotes}
          currentReveal={gameState?.currentReveal}
          tiedPlayerNames={gameState?.tiedPlayerNames}
          randomlySelectedPlayer={gameState?.randomlySelectedPlayer}
          shieldBlockedBanishment={gameState?.shieldBlockedBanishment}
          shieldBlockedBanishmentName={gameState?.shieldBlockedBanishmentName}
        />
        {chatBox}
      </>
    );
  }

  if (phase === 'NIGHT' || phase === 'MORNING') {
    return (
      <>
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        {soundToggle}
        {hud}
        {hostPanel}
        {phaseIntroCard}
        {timer}
        <NightPhase
          players={gameState?.players || []}
          myPlayerId={gameState?.myPlayerId}
          myRole={gameState?.myRole}
          phase={phase}
          currentRound={gameState?.currentRound}
          aliveTraitorCount={gameState?.aliveTraitorCount}
          murderVoteProgress={gameState?.murderVoteProgress}
          murderedPlayer={gameState?.murderedPlayer}
          murderBlocked={gameState?.murderBlocked}
          medicBlocked={gameState?.medicBlocked}
          traitorIds={gameState?.traitorIds}
          myPlayerRecruitmentUsed={myPlayer?.recruitmentUsed}
          justRecruited={gameState?.justRecruited}
          recruitedPlayer={gameState?.recruitedPlayer}
          nightRecruitmentSubmittedBy={gameState?.nightRecruitmentSubmittedBy}
          nightRecruitmentTargetName={gameState?.nightRecruitmentTargetName}
          evidenceUsed={gameState?.evidenceUsed}
          falseEvidence={gameState?.falseEvidence}
          evidenceVotes={gameState?.evidenceVotes}
          evidenceVoteProgress={gameState?.evidenceVoteProgress}
          evidenceWindowEndsAt={gameState?.evidenceWindowEndsAt}
          evidenceLastFailure={gameState?.evidenceLastFailure}
          onSend={send}
        />
        {specialRoleHud}
        {chatBox}
      </>
    );
  }

  if (phase === 'ROUNDTABLE' || phase === 'VOTING' || phase === 'VOTE_REVEAL' || phase === 'TIE_DETECTED' || phase === 'REVOTE' || phase === 'TIEBREAKER_REVEAL' || phase === 'BANISH_REVEAL' || phase === 'CHECK_WIN') {
    return (
      <>
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        {soundToggle}
        {hud}
        {hostPanel}
        {phaseIntroCard}
        {timer}
        <Voting
          players={gameState?.players || []}
          myPlayerId={gameState?.myPlayerId}
          phase={phase}
          votes={gameState?.votes}
          banishedPlayer={gameState?.banishedPlayer}
          currentRound={gameState?.currentRound}
          voteCount={gameState?.voteCount}
          tiedPlayerIds={gameState?.tiedPlayerIds}
          tiedPlayerNames={gameState?.tiedPlayerNames}
          randomlySelectedPlayer={gameState?.randomlySelectedPlayer}
          revealIndex={gameState?.revealIndex}
          revealOrder={gameState?.revealOrder}
          currentTally={gameState?.currentTally}
          revealedVotes={gameState?.revealedVotes}
          totalVotes={gameState?.totalVotes}
          currentReveal={gameState?.currentReveal}
          shieldBlockedBanishment={gameState?.shieldBlockedBanishment}
          shieldBlockedBanishmentName={gameState?.shieldBlockedBanishmentName}
          whispers={gameState?.whispers}
          lastWhisperReceivedId={gameState?.lastWhisperReceivedId}
          whispersRead={gameState?.whispersRead}
          whisperError={gameState?.whisperError}
          onLocalAction={dispatchLocal}
          onSend={send}
        />
        {specialRoleHud}
        {chatBox}
        {tokenOverlayActive && tokenPhaseLocal && (
          <SuspicionTokens
            phase={tokenPhaseLocal}
            players={gameState?.players ?? []}
            {...(gameState?.myPlayerId !== undefined ? { myPlayerId: gameState.myPlayerId } : {})}
            isAlive={isAlive}
            {...(gameState?.tokenWindowEndsAt !== undefined ? { windowEndsAt: gameState.tokenWindowEndsAt } : {})}
            {...(gameState?.tokenRevealEndsAt !== undefined ? { revealEndsAt: gameState.tokenRevealEndsAt } : {})}
            {...(gameState?.tokenSubmittedCount !== undefined ? { submittedCount: gameState.tokenSubmittedCount } : {})}
            {...(gameState?.tokenTotalCount !== undefined ? { totalCount: gameState.tokenTotalCount } : {})}
            {...(gameState?.myTokenTargetId !== undefined ? { myTokenTargetId: gameState.myTokenTargetId } : {})}
            {...(gameState?.suspicionTokensCurrent !== undefined ? { tokens: gameState.suspicionTokensCurrent } : {})}
            {...(gameState?.suspicionTokensByRound !== undefined ? { pastRounds: gameState.suspicionTokensByRound } : {})}
            {...(gameState?.tokenError !== undefined ? { tokenError: gameState.tokenError } : {})}
            onSend={send}
            onClearError={() => dispatchLocal({ type: 'CLIENT_CLEAR_TOKEN_ERROR' })}
          />
        )}
        {boothActive && (
          <ConfessionBooth
            phase={confessionPhase ?? 'BOOTH'}
            reveals={gameState?.confessionRevealed}
            endsAt={gameState?.confessionWindowEndsAt}
            submittedCount={gameState?.confessionSubmittedCount}
            totalCount={gameState?.confessionTotalCount}
            isAlive={isAlive}
            hasSubmitted={gameState?.mySubmittedConfession ?? false}
            onSubmit={send}
            onBeginDiscussion={() => setBoothDismissed(true)}
            onLocalSubmitted={() =>
              dispatchLocal({ type: 'CLIENT_MY_CONFESSION_SUBMITTED' })
            }
          />
        )}
      </>
    );
  }

  if (phase === 'ROLE_ASSIGN' || phase === 'ROLE_REVEAL') {
    return (
      <>
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        {soundToggle}
        {hostPanel}
        <RoleReveal
          myRole={gameState?.myRole}
          traitorIds={gameState?.traitorIds}
          players={gameState?.players || []}
          myPlayerId={gameState?.myPlayerId}
          phase={phase}
          onSend={send}
        />
        {chatBox}
      </>
    );
  }

  if (phase === 'CHALLENGE' || phase === 'CHALLENGE_RESULT') {
    return (
      <>
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        {soundToggle}
        {hud}
        {hostPanel}
        {phaseIntroCard}
        <Challenge
          challenge={gameState?.challenge}
          players={gameState?.players || []}
          myPlayerId={gameState?.myPlayerId}
          phase={phase}
          timer={gameState?.timer}
          onSend={send}
        />
        {chatBox}
      </>
    );
  }

  return (
    <>
      <ConnectionStatus connected={connected} reconnecting={reconnecting} />
      {soundToggle}
      {hostPanel}
      <Lobby
        sessionId={gameState?.sessionId}
        players={gameState?.players || []}
        myPlayerId={gameState?.myPlayerId}
        settings={gameState?.settings}
        onSend={send}
        identity={identity}
        identifyError={identifyError}
        identify={identify}
      />
    </>
  );
}

export default App;
