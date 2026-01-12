import { useWebSocket } from './hooks/useWebSocket';
import { Lobby } from './components/Lobby';
import { RoleReveal } from './components/RoleReveal';
import { Voting } from './components/Voting';
import { NightPhase } from './components/NightPhase';
import { GameEnd } from './components/GameEnd';
import './App.css';

function App() {
  const { connected, gameState, error, send } = useWebSocket();

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

  if (phase === 'GAME_END') {
    return (
      <GameEnd
        winner={gameState?.winner}
        players={gameState?.players || []}
        myRole={gameState?.myRole}
      />
    );
  }

  if (phase === 'NIGHT' || phase === 'MORNING') {
    return (
      <NightPhase
        players={gameState?.players || []}
        myPlayerId={gameState?.myPlayerId}
        myRole={gameState?.myRole}
        phase={phase}
        currentRound={gameState?.currentRound}
        aliveTraitorCount={gameState?.aliveTraitorCount}
        murderVoteProgress={gameState?.murderVoteProgress}
        murderedPlayer={gameState?.murderedPlayer}
        onSend={send}
      />
    );
  }

  if (phase === 'ROUNDTABLE' || phase === 'VOTING' || phase === 'VOTE_REVEAL' || phase === 'BANISH_REVEAL' || phase === 'CHECK_WIN') {
    return (
      <Voting
        players={gameState?.players || []}
        myPlayerId={gameState?.myPlayerId}
        phase={phase}
        votes={gameState?.votes}
        banishedPlayer={gameState?.banishedPlayer}
        onSend={send}
      />
    );
  }

  if (phase === 'ROLE_ASSIGN' || phase === 'ROLE_REVEAL') {
    return (
      <RoleReveal
        myRole={gameState?.myRole}
        traitorIds={gameState?.traitorIds}
        players={gameState?.players || []}
        myPlayerId={gameState?.myPlayerId}
        phase={phase}
        onSend={send}
      />
    );
  }

  return (
    <Lobby
      sessionId={gameState?.sessionId}
      players={gameState?.players || []}
      myPlayerId={gameState?.myPlayerId}
      onSend={send}
    />
  );
}

export default App;
