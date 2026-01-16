import WebSocket from 'ws';

const SERVER_URL = 'ws://localhost:5000';
const NUM_PLAYERS = 15;

interface PlayerClient {
  id: number;
  name: string;
  ws: WebSocket;
  playerId?: string;
  role?: 'TRAITOR' | 'FAITHFUL';
  isHost: boolean;
  isAlive: boolean;
  hasShield: boolean;
  sessionToken?: string;
}

interface GameEvent {
  type: string;
  payload: any;
}

const players: PlayerClient[] = [];
let sessionId: string | null = null;
let currentPhase = 'LOBBY';
let currentRound = 0;
let gameEnded = false;
let traitorIds: string[] = [];
let alivePlayers: string[] = [];

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function createPlayer(id: number, isHost: boolean): Promise<PlayerClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const player: PlayerClient = {
      id,
      name: `Player${id}`,
      ws,
      isHost,
      isAlive: true,
      hasShield: false
    };

    ws.on('open', () => {
      log(`Player ${id} connected`);
      resolve(player);
    });

    ws.on('error', (err) => {
      log(`Player ${id} error: ${err.message}`);
      reject(err);
    });

    ws.on('message', (data) => {
      try {
        const event: GameEvent = JSON.parse(data.toString());
        handleEvent(player, event);
      } catch (e) {
        log(`Player ${id} parse error: ${e}`);
      }
    });

    ws.on('close', () => {
      log(`Player ${id} disconnected`);
    });
  });
}

function send(player: PlayerClient, event: GameEvent) {
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(event));
  }
}

function handleEvent(player: PlayerClient, event: GameEvent) {
  const { type, payload } = event;

  switch (type) {
    case 'S2C_GAME_CREATED':
      sessionId = payload.sessionId;
      player.playerId = payload.playerId;
      player.sessionToken = payload.sessionToken;
      log(`Game created: ${sessionId}, Host: Player ${player.id}`);
      break;

    case 'S2C_JOINED':
      player.playerId = payload.playerId;
      player.sessionToken = payload.sessionToken;
      log(`Player ${player.id} joined as ${player.playerId}`);
      break;

    case 'S2C_PLAYER_JOINED':
      log(`Player joined: ${payload.playerName} (total: ${payload.totalPlayers})`);
      break;

    case 'S2C_ROLE_ASSIGNED':
      player.role = payload.role;
      if (payload.role === 'TRAITOR') {
        traitorIds = payload.traitorIds || [];
      }
      log(`Player ${player.id} (${player.name}) assigned role: ${payload.role}`);
      break;

    case 'S2C_GAME_STARTED':
      currentPhase = payload.phase;
      log(`Game started, phase: ${currentPhase}`);
      if (player.isHost) {
        setTimeout(() => {
          log(`Host assigning roles...`);
          send(player, { type: 'C2S_ASSIGN_ROLES', payload: {} });
        }, 300);
      }
      break;

    case 'S2C_ROLES_ASSIGNED':
      currentPhase = payload.phase || 'ROLE_REVEAL';
      log(`Roles assigned, phase: ${currentPhase}`);
      if (player.isHost) {
        setTimeout(() => {
          log(`Host starting ROUNDTABLE`);
          send(player, { type: 'C2S_START_ROUNDTABLE', payload: {} });
        }, 1000);
      }
      break;

    case 'S2C_ROLE_REVEAL':
      player.role = payload.role;
      if (payload.traitorIds) {
        traitorIds = payload.traitorIds;
      }
      log(`Player ${player.id} role revealed: ${payload.role}`);
      break;

    case 'S2C_PHASE_CHANGE':
      currentPhase = payload.phase;
      if (payload.currentRound) currentRound = payload.currentRound;
      log(`Phase changed to: ${currentPhase} (Round ${currentRound})`);
      handlePhaseChange(player, payload);
      break;

    case 'S2C_ROUNDTABLE_STARTED':
      currentPhase = 'ROUNDTABLE';
      if (payload.currentRound) currentRound = payload.currentRound;
      log(`ROUNDTABLE started (Round ${currentRound})`);
      handlePhaseChange(player, { phase: 'ROUNDTABLE' });
      break;

    case 'S2C_VOTING_STARTED':
      currentPhase = 'VOTING';
      log(`VOTING phase started`);
      break;

    case 'S2C_NIGHT_STARTED':
      currentPhase = 'NIGHT';
      log(`NIGHT phase started`);
      break;

    case 'S2C_VOTE_SUBMITTED':
      log(`Vote submitted by ${payload.voterId}${payload.isAutoVote ? ' (AUTO)' : ''}`);
      break;

    case 'S2C_VOTE_COUNT_UPDATE':
      log(`Vote count: ${payload.received}/${payload.needed}`);
      break;

    case 'S2C_VOTE_REVEAL_STARTED':
      currentPhase = 'VOTE_REVEAL';
      log(`Vote reveal started, total votes: ${payload.totalVotes}`);
      break;

    case 'S2C_VOTE_RECEIVED':
      log(`Vote received: ${payload.voterName} -> ${payload.targetName}`);
      break;

    case 'S2C_VOTE_REVEAL':
      log(`Vote reveal #${payload.revealIndex}: ${payload.voterName} voted for ${payload.targetName}${payload.isAutoVote ? ' (AUTO)' : ''}`);
      break;

    case 'S2C_BANISH_RESULT':
      currentPhase = 'BANISH_REVEAL';
      log(`BANISHED: ${payload.banishedPlayerName} was ${payload.banishedPlayerRole}`);
      markPlayerDead(payload.banishedPlayerId);
      handlePhaseChange(player, { phase: 'BANISH_REVEAL' });
      break;

    case 'S2C_ROUND1_NO_BANISHMENT':
      currentPhase = 'CHECK_WIN';
      log(`Round 1 - no banishment (discussion only)`);
      handlePhaseChange(player, { phase: 'CHECK_WIN' });
      break;

    case 'S2C_MURDER_RESOLVED':
      log(`MURDERED: ${payload.murderedPlayerName}`);
      markPlayerDead(payload.murderedPlayerId);
      break;

    case 'S2C_MORNING_STARTED':
      if (payload.murderBlocked) {
        log(`SHIELD BLOCKED: ${payload.shieldedPlayerName} was protected!`);
      } else if (payload.lastMurderedPlayerId) {
        log(`Morning: ${payload.lastMurderedPlayerName} was murdered`);
        markPlayerDead(payload.lastMurderedPlayerId);
      } else {
        log(`Morning: No one was murdered`);
      }
      break;

    case 'S2C_TIE_DETECTED':
      log(`TIE DETECTED between: ${payload.tiedPlayerNames?.join(', ')}`);
      break;

    case 'S2C_TIEBREAKER_RESULT':
      log(`TIEBREAKER: ${payload.selectedPlayerName} randomly selected`);
      break;

    case 'S2C_CHALLENGE_STARTED':
      log(`CHALLENGE: ${payload.challengeType} started`);
      handleChallenge(player, payload);
      break;

    case 'S2C_CHALLENGE_RESULT':
      if (payload.winnerName) {
        log(`CHALLENGE WON by ${payload.winnerName} - Shield awarded: ${payload.shieldAwarded}`);
        const winner = players.find(p => p.playerId === payload.winnerId);
        if (winner && payload.shieldAwarded) winner.hasShield = true;
      } else {
        log(`CHALLENGE: No winner`);
      }
      break;

    case 'S2C_GAME_END':
      gameEnded = true;
      log(`\n========== GAME OVER ==========`);
      log(`Winner: ${payload.winner}`);
      log(`Remaining Traitors: ${payload.remainingTraitors}`);
      log(`Remaining Faithful: ${payload.remainingFaithful}`);
      log(`================================\n`);
      break;

    case 'S2C_CONTINUE_GAME':
      currentPhase = payload.phase;
      currentRound = payload.currentRound;
      log(`Continue to: ${currentPhase} (Round ${currentRound})`);
      break;

    case 'S2C_ERROR':
      log(`ERROR for Player ${player.id}: ${payload.message}`);
      break;
  }
}

function markPlayerDead(playerId: string) {
  const player = players.find(p => p.playerId === playerId);
  if (player) {
    player.isAlive = false;
    alivePlayers = alivePlayers.filter(id => id !== playerId);
    log(`Player ${player.id} (${player.name}) is now DEAD`);
  }
}

function handlePhaseChange(player: PlayerClient, payload: any) {
  if (!player.isHost) return;

  setTimeout(() => {
    if (gameEnded) return;

    switch (payload.phase) {
      case 'ROUNDTABLE':
        setTimeout(() => {
          log(`Host starting voting phase`);
          send(player, { type: 'C2S_START_VOTING', payload: {} });
        }, 1000);
        break;

      case 'BANISH_REVEAL':
      case 'CHECK_WIN':
        setTimeout(() => {
          log(`Host continuing to night`);
          send(player, { type: 'C2S_START_NIGHT', payload: {} });
        }, 500);
        break;

      case 'MORNING':
        setTimeout(() => {
          log(`Host continuing to day`);
          send(player, { type: 'C2S_CONTINUE_TO_DAY', payload: {} });
        }, 500);
        break;

      case 'CHALLENGE_RESULT':
        setTimeout(() => {
          log(`Host continuing from challenge`);
          send(player, { type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} });
        }, 500);
        break;
    }
  }, 100);
}

function handleChallenge(player: PlayerClient, payload: any) {
  if (!player.isAlive) return;

  setTimeout(() => {
    let answer: any;
    switch (payload.challengeType) {
      case 'TIME_ESTIMATE':
        const targetMs = (payload.targetTime || 5) * 1000;
        const variance = (Math.random() - 0.5) * 2000;
        answer = targetMs + variance;
        break;
      case 'WORD_SCRAMBLE':
        answer = 'guess';
        break;
      case 'MISSING_PLAYER':
        answer = 'guess';
        break;
    }
    log(`Player ${player.id} submitting challenge answer: ${answer}`);
    send(player, { type: 'C2S_SUBMIT_CHALLENGE_ANSWER', payload: { answer } });
  }, Math.random() * 2000 + 500);
}

async function runVotingPhase() {
  log(`\n--- VOTING PHASE ---`);
  const alivePlayersList = players.filter(p => p.isAlive && p.playerId);
  
  log(`Voting: ${alivePlayersList.length} alive players with valid IDs`);
  
  for (const voter of alivePlayersList) {
    const validTargets = alivePlayersList.filter(p => p.playerId !== voter.playerId);
    if (validTargets.length === 0) continue;
    
    const target = validTargets[Math.floor(Math.random() * validTargets.length)]!;
    
    setTimeout(() => {
      log(`Player ${voter.id} (${voter.playerId}) voting for Player ${target.id} (${target.playerId})`);
      send(voter, { 
        type: 'C2S_SUBMIT_VOTE', 
        payload: { targetId: target.playerId, reasonText: `Suspicious behavior` } 
      });
    }, voter.id * 100);
  }
}

async function runNightPhase() {
  log(`\n--- NIGHT PHASE ---`);
  const aliveTraitors = players.filter(p => p.isAlive && p.role === 'TRAITOR');
  const aliveFaithful = players.filter(p => p.isAlive && p.role === 'FAITHFUL');
  
  if (aliveTraitors.length === 0 || aliveFaithful.length === 0) {
    log(`Skipping night phase - no valid targets or traitors`);
    return;
  }

  const target = aliveFaithful[Math.floor(Math.random() * aliveFaithful.length)]!;
  
  for (const traitor of aliveTraitors) {
    setTimeout(() => {
      log(`Traitor ${traitor.id} voting to murder Player ${target.id} (${target.name})`);
      send(traitor, { type: 'C2S_SUBMIT_MURDER', payload: { targetId: target.playerId } });
    }, Math.random() * 500);
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPhase(phase: string, timeout = 30000): Promise<boolean> {
  const start = Date.now();
  while (currentPhase !== phase && !gameEnded) {
    if (Date.now() - start > timeout) {
      log(`Timeout waiting for phase: ${phase} (current: ${currentPhase})`);
      return false;
    }
    await sleep(100);
  }
  return !gameEnded;
}

async function runGame() {
  log(`\n========================================`);
  log(`  END-TO-END GAME TEST - ${NUM_PLAYERS} PLAYERS`);
  log(`========================================\n`);

  try {
    log(`Creating host player...`);
    const host = await createPlayer(1, true);
    players.push(host);
    
    send(host, { type: 'C2S_CREATE_GAME', payload: { playerName: 'Player1' } });
    await sleep(500);

    log(`\nJoining ${NUM_PLAYERS - 1} more players...`);
    for (let i = 2; i <= NUM_PLAYERS; i++) {
      const player = await createPlayer(i, false);
      players.push(player);
      send(player, { type: 'C2S_JOIN_GAME', payload: { sessionId, playerName: `Player${i}` } });
      await sleep(100);
    }

    await sleep(1000);
    alivePlayers = players.map(p => p.playerId!);

    log(`\n--- Starting game with ${players.length} players ---`);
    send(host, { type: 'C2S_START_GAME', payload: {} });
    
    await waitForPhase('ROLE_REVEAL', 5000);
    await sleep(500);

    const traitors = players.filter(p => p.role === 'TRAITOR');
    const faithful = players.filter(p => p.role === 'FAITHFUL');
    log(`\nRole Distribution:`);
    log(`  Traitors (${traitors.length}): ${traitors.map(p => p.name).join(', ')}`);
    log(`  Faithful (${faithful.length}): ${faithful.map(p => p.name).join(', ')}`);
    log(`  Traitor Ratio: ${((traitors.length / players.length) * 100).toFixed(1)}%`);

    let roundCount = 0;
    const maxRounds = 10;

    while (!gameEnded && roundCount < maxRounds) {
      roundCount++;
      log(`\n========== ROUND ${roundCount} ==========`);

      if (await waitForPhase('ROUNDTABLE', 10000)) {
        await sleep(300);
      }

      if (await waitForPhase('VOTING', 5000)) {
        await runVotingPhase();
        await sleep(3000);
      }

      await sleep(2000);

      if (currentPhase === 'TIE_DETECTED' || currentPhase === 'REVOTE') {
        log(`Handling tie/revote...`);
        await sleep(1000);
        if (currentPhase === 'REVOTE') {
          await runVotingPhase();
          await sleep(3000);
        }
      }

      await sleep(2000);

      if (await waitForPhase('NIGHT', 10000)) {
        await runNightPhase();
        await sleep(2000);
      }

      await sleep(3000);

      if (currentPhase === 'CHALLENGE') {
        log(`Challenge phase active, waiting for results...`);
        await sleep(5000);
      }

      const aliveTraitors = players.filter(p => p.isAlive && p.role === 'TRAITOR').length;
      const aliveFaithful = players.filter(p => p.isAlive && p.role === 'FAITHFUL').length;
      log(`\nEnd of Round ${roundCount}: ${aliveTraitors} traitors, ${aliveFaithful} faithful alive`);

      if (gameEnded) break;
      await sleep(1000);
    }

    log(`\n========== TEST COMPLETE ==========`);
    log(`Rounds played: ${roundCount}`);
    log(`Game ended: ${gameEnded}`);
    
    const finalAlive = players.filter(p => p.isAlive);
    log(`Final survivors (${finalAlive.length}):`);
    finalAlive.forEach(p => log(`  - ${p.name} (${p.role})`));

    for (const player of players) {
      player.ws.close();
    }

    log(`\nAll connections closed. Test finished.`);
    process.exit(gameEnded ? 0 : 1);

  } catch (error) {
    log(`TEST ERROR: ${error}`);
    process.exit(1);
  }
}

runGame();
