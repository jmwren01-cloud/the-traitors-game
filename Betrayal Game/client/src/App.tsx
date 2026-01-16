import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { Lobby } from './components/Lobby';
import { RoleReveal } from './components/RoleReveal';
import { Voting } from './components/Voting';
import { NightPhase } from './components/NightPhase';
import { GameEnd } from './components/GameEnd';
import { ChatBox } from './components/ChatBox';
import { Timer } from './components/Timer';
import { useSoundContext } from './contexts/SoundContext';
import './App.css';

function App() {
  const { connected, gameState, error, send } = useWebSocket();
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

  if (!connected) {
    return (
      <div className="loading-screen">
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

  const chatBox = showChat ? (
    <ChatBox
      messages={gameState?.messages || []}
      myPlayerId={gameState?.myPlayerId}
      myRole={gameState?.myRole}
      isAlive={isAlive}
      onSend={send}
      disabled={isChatDisabled}
    />
  ) : null;

  const timer = gameState?.timer && gameState.timer.phase === phase ? (
    <Timer endTime={gameState.timer.endTime} />
  ) : null;

  if (phase === 'GAME_END') {
    return (
      <>
        {soundToggle}
        <GameEnd
          winner={gameState?.winner}
          players={gameState?.players || []}
          myRole={gameState?.myRole}
        />
        {chatBox}
      </>
    );
  }

  if (phase === 'NIGHT' || phase === 'MORNING') {
    return (
      <>
        {soundToggle}
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
          traitorIds={gameState?.traitorIds}
          onSend={send}
        />
        {chatBox}
      </>
    );
  }

  if (phase === 'ROUNDTABLE' || phase === 'VOTING' || phase === 'VOTE_REVEAL' || phase === 'TIE_DETECTED' || phase === 'REVOTE' || phase === 'TIEBREAKER_REVEAL' || phase === 'BANISH_REVEAL' || phase === 'CHECK_WIN') {
    return (
      <>
        {soundToggle}
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
          onSend={send}
        />
        {chatBox}
      </>
    );
  }

  if (phase === 'ROLE_ASSIGN' || phase === 'ROLE_REVEAL') {
    return (
      <>
        {soundToggle}
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

  return (
    <>
      {soundToggle}
      <Lobby
        sessionId={gameState?.sessionId}
        players={gameState?.players || []}
        myPlayerId={gameState?.myPlayerId}
        onSend={send}
      />
    </>
  );
}

export default App;
