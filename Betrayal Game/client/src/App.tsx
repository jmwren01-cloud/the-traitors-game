import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { Lobby } from './components/Lobby';
import { RoleReveal } from './components/RoleReveal';
import { Voting } from './components/Voting';
import { NightPhase } from './components/NightPhase';
import { GameEnd } from './components/GameEnd';
import { ChatBox } from './components/ChatBox';
import { Timer } from './components/Timer';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Challenge } from './components/Challenge';
import { Spectator } from './components/Spectator';
import { HostDashboard } from './components/HostDashboard';
import { HUD } from './components/HUD';
import hudStyles from './components/HUD.module.css';
import { useSoundContext } from './contexts/SoundContext';
import './App.css';

function App() {
  const {
    connected, gameState, error, send, reconnecting,
    identity, identifyError, identify,
    playerStats, leaderboard, globalStats,
  } = useWebSocket();
  const { setEnabled } = useSoundContext();
  const [soundOn, setSoundOn] = useState(true);

  const toggleSound = () => {
    const newValue = !soundOn;
    setSoundOn(newValue);
    setEnabled(newValue);
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
  const showChat = gameState && phase !== 'LOBBY' && phase !== 'ROLE_ASSIGN';
  const isChatDisabled = phase === 'ROLE_REVEAL';
  const myPlayer = gameState?.players?.find((p) => p.id === gameState?.myPlayerId);
  const isAlive = myPlayer?.isAlive ?? true;

  const hostDashboard = gameState && phase !== 'LOBBY' ? (
    <HostDashboard
      players={gameState.players || []}
      myPlayerId={gameState.myPlayerId}
      phase={phase}
      votes={gameState.votes}
      revealedVotes={gameState.revealedVotes}
      currentTally={gameState.currentTally}
      voteCount={gameState.voteCount}
      murderVoteProgress={gameState.murderVoteProgress}
      murderVoterIds={gameState.murderVoterIds}
      traitorIds={gameState.traitorIds}
      currentRound={gameState.currentRound}
      tiedPlayerIds={gameState.tiedPlayerIds}
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
          players={gameState?.players || []}
          myRole={gameState?.myRole}
          history={gameState?.history}
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
        {hostDashboard}
        {timer}
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
        {hostDashboard}
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
          traitorIds={gameState?.traitorIds}
          myPlayerRecruitmentUsed={myPlayer?.recruitmentUsed}
          justRecruited={gameState?.justRecruited}
          recruitedPlayer={gameState?.recruitedPlayer}
          nightRecruitmentSubmittedBy={gameState?.nightRecruitmentSubmittedBy}
          onSend={send}
        />
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
        {hostDashboard}
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
          onSend={send}
        />
        {chatBox}
      </>
    );
  }

  if (phase === 'ROLE_ASSIGN' || phase === 'ROLE_REVEAL') {
    return (
      <>
        <ConnectionStatus connected={connected} reconnecting={reconnecting} />
        {soundToggle}
        {hostDashboard}
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
        {hostDashboard}
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
