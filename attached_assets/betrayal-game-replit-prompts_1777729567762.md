# Betrayal Game — Replit Agent Engineering Prompts

---

## PROMPT 1: Extract WebSocket Router

You are working on a multiplayer social deduction game called **Betrayal Game**. The tech stack is Node.js + TypeScript on the backend with a React 19 + Vite frontend. The server runs on port 5000 and uses raw WebSockets (the `ws` library) for all real-time communication. There is no database — all game state lives in memory.

### Current state of the codebase

The server entry point is `src/index.ts`. It currently handles everything in one file (~1200 lines):
- HTTP file serving for the built client
- WebSocket connection management
- All C2S (client-to-server) event handling — around 20+ event types
- Session token tracking and reconnection logic
- Vote reveal sequence orchestration
- The `broadcastToSession` and `sendError` utility functions

A file `src/ws/router.ts` already exists in the project but is not yet fully used. The game logic is cleanly separated in `src/game/manager.ts` and `src/game/store.ts`. The shared types live in `src/game/types.ts`.

### What needs to be done

Refactor `src/index.ts` so that:

1. **`src/index.ts`** retains only:
   - HTTP server creation and static file serving
   - WebSocket server (`wss`) instantiation
   - The four in-memory Maps: `games`, `playerConnections`, `sessionTokens`, `disconnectedPlayers`
   - The `cleanupExpiredDisconnections` interval
   - The `wss.on('connection', ...)` handler, which should now delegate to the router

2. **`src/ws/router.ts`** becomes the single place where all `ws.on('message', ...)` logic lives. It should:
   - Export a function — e.g. `handleMessage(ws, data, context)` — that receives the raw message, the WebSocket instance, and a context object containing references to the shared Maps and any server-side utilities it needs
   - Handle every C2S event type that currently exists in `index.ts`, preserving all existing logic exactly
   - Import `broadcastToSession` and `sendError` as utilities (move them to a `src/ws/utils.ts` file)
   - Import `startVoteRevealSequence` (move to `src/ws/voteReveal.ts`)

3. **Do not change any game logic** in `src/game/manager.ts` or `src/game/store.ts`. This is purely a structural refactor.

4. **Do not change any event type names or payload shapes.** The frontend must continue to work without any changes.

5. After refactoring, verify the server still starts correctly and run the existing e2e test at `test/e2e-game-test.ts` to confirm nothing is broken.

### Constraints
- TypeScript strict mode must remain satisfied — no `any` types introduced
- All existing Maps (`games`, `playerConnections`, `sessionTokens`, `disconnectedPlayers`) must remain accessible to the router — pass them via context object, do not make them module-level globals in the router file
- The `activeRevealSequences` Map should move with `startVoteRevealSequence` into `src/ws/voteReveal.ts`
- Preserve all existing console.log statements

### Definition of done
- `src/index.ts` is under 100 lines
- `src/ws/router.ts` contains all event handling logic
- `src/ws/utils.ts` contains `broadcastToSession` and `sendError`
- `src/ws/voteReveal.ts` contains `startVoteRevealSequence`
- The game runs end-to-end with no regressions
- TypeScript compiles cleanly with no errors

---

## PROMPT 2: Add SQLite Persistence

You are working on a multiplayer social deduction game called **Betrayal Game**. The tech stack is Node.js + TypeScript on the backend with a React 19 + Vite frontend. The server runs on port 5000 and uses raw WebSockets (the `ws` library) for all real-time communication.

### Current state

All game state currently lives in a single in-memory Map: `const games = new Map<string, GameState>()`. If the server restarts, all active games are lost. Session tokens for reconnection are also in-memory and do not survive a restart.

The `GameState` type is defined in `src/game/types.ts`. It includes: players, phase, votes, murderVotes, messages, settings, timers, history, and various phase-specific fields.

### What needs to be done

Add **SQLite persistence** using `better-sqlite3` so that:

1. Active game state is persisted to disk and survives server restarts
2. Session tokens are persisted so players can reconnect after a server restart
3. Completed or abandoned games are cleaned up automatically

#### Implementation requirements

**Install:** `better-sqlite3` and `@types/better-sqlite3`

**Database file location:** `./data/betrayal.db` (create the `data/` directory; add it to `.gitignore` but not the schema)

**Schema — two tables only:**

```sql
CREATE TABLE IF NOT EXISTS games (
  session_id TEXT PRIMARY KEY,
  state      TEXT NOT NULL,        -- full GameState serialised as JSON
  updated_at INTEGER NOT NULL      -- Unix ms timestamp
);

CREATE TABLE IF NOT EXISTS session_tokens (
  token      TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

**Create `src/db/store.ts`** — a thin synchronous wrapper (better-sqlite3 is synchronous, which is correct here) that exports:
```typescript
export function saveGame(sessionId: string, state: GameState): void
export function loadGame(sessionId: string): GameState | null
export function deleteGame(sessionId: string): void
export function loadAllGames(): GameState[]          // called on server startup
export function saveToken(token: string, playerId: string, sessionId: string): void
export function loadToken(token: string): { playerId: string; sessionId: string } | null
export function deleteToken(token: string): void
export function cleanupOldGames(maxAgeMs: number): void  // delete games older than maxAgeMs
```

**Startup hydration:** On server start, call `loadAllGames()` and repopulate the in-memory `games` Map. Also load all session tokens into the in-memory `sessionTokens` Map. This means the server recovers its full state after a restart.

**Write-through caching:** The in-memory Maps remain the source of truth for runtime performance. Every time `games.set(sessionId, state)` is called anywhere in the codebase, also call `saveGame(sessionId, state)`. Every time `games.delete(sessionId)` is called, also call `deleteGame(sessionId)`. Apply the same pattern for session tokens. Do this by creating thin wrapper functions `setGame` and `deleteGame` that handle both the Map and the DB together — replace all raw `games.set` and `games.delete` calls with these wrappers.

**Cleanup:** Run `cleanupOldGames(24 * 60 * 60 * 1000)` on startup and every hour via `setInterval` to remove games that haven't been updated in 24 hours.

**Timer handling:** The `timer` field on `GameState` contains a live `endTime` (Unix ms). When rehydrating from the DB, if a game has an active timer whose `endTime` has already passed, set `timer` to `null`. Do not attempt to restart timers — the host will need to manually advance the phase. This is an acceptable trade-off.

### Constraints
- Do not use an ORM or query builder — raw `better-sqlite3` prepared statements only
- Do not change any game logic in `src/game/manager.ts` or `src/game/store.ts`
- Do not change any WebSocket event types or payload shapes
- TypeScript strict mode must remain satisfied
- The `data/` directory must be created if it does not exist (use `fs.mkdirSync` with `{ recursive: true }`)

### Definition of done
- Server starts cleanly and rehydrates state from DB
- A game created before a server restart is still joinable after restart (within 24 hours)
- Session token reconnection works across server restarts
- TypeScript compiles cleanly
- `src/db/store.ts` exists and is the only file that imports `better-sqlite3`

---

## PROMPT 3: Challenge Phase Polish

You are working on a multiplayer social deduction game called **Betrayal Game**. The tech stack is Node.js + TypeScript on the backend with a React 19 + Vite frontend (React 19, Vite, CSS Modules). The server runs on port 5000 and uses raw WebSockets.

### Current state of the challenge system

A `CHALLENGE` phase exists and is partially implemented. The server supports three challenge types: `MISSING_PLAYER`, `WORD_SCRAMBLE`, and `TIME_ESTIMATE`. The game flow is:

```
ROUNDTABLE → CHALLENGE → CHALLENGE_RESULT → ROUNDTABLE (next round)
```

A Shield mechanic exists: the challenge winner is awarded a shield (`hasShield: true` on their player object) which protects them from being banished or murdered for one round. The `C2S_REVEAL_SHIELD` event and `S2C_SHIELD_REVEALED` broadcast are wired up server-side.

The frontend component is `client/src/components/Challenge.tsx` with styles in `Challenge.module.css`.

### What needs to be done

Audit the complete challenge flow — server and client — and bring it to the same quality level as the Roundtable and Voting phases. Specifically:

#### 1. Server-side audit
- Review `src/game/manager.ts` for `startChallenge`, `submitChallengeAnswer`, and `resolveChallenge` functions
- Confirm that `MISSING_PLAYER` challenges correctly identify which player is absent from a given player list (the challenge question should reference real player names from `gameState.players`)
- Confirm that `WORD_SCRAMBLE` generates a deterministic scramble for a given seed so all clients receive the same question
- Confirm that `TIME_ESTIMATE` resolution compares all submitted answers and selects the closest to the correct value, handling ties by earliest submission timestamp
- If any of the above is broken or missing, fix it

#### 2. Client-side — `Challenge.tsx`
The component must handle all three challenge types with a unified layout. Required UI states:
- **Waiting to start:** "A challenge is about to begin…" holding screen
- **Active challenge:** Question displayed prominently, answer input appropriate to the challenge type:
  - `MISSING_PLAYER`: show player name buttons (tap to select), not a text input
  - `WORD_SCRAMBLE`: text input, submit on Enter or button press
  - `TIME_ESTIMATE`: number input (seconds or minutes — make the unit clear), submit on button press
- **Answered — waiting for others:** "Answer submitted. Waiting for other players…" with a live count of how many have answered (use `S2C_CHALLENGE_ANSWER_RECEIVED`)
- **Result screen** (`CHALLENGE_RESULT` phase): winner name displayed, whether a shield was awarded, and a "Continue" button (host only triggers `C2S_CONTINUE_TO_ROUNDTABLE`)

#### 3. Shield UX
- Players who hold a shield should see a visible shield indicator on their player card throughout the game (not just during the challenge phase)
- During the Voting phase, if a player with a shield is about to be banished, the shield reveal flow should be clear: the shield holder sees a "Reveal your shield?" prompt before the banishment resolves
- The `S2C_SHIELD_REVEALED` broadcast should display a toast/notification to all players: "[Name] revealed their shield and is protected!"

#### 4. Challenge timer
- Challenges should have a configurable time limit (add `challengeTimerSeconds` to `GameSettings`, default 60)
- The server should start a timer when a challenge begins and broadcast `S2C_TIMER_UPDATE` with `phase: 'CHALLENGE'`
- When the timer expires, the server should auto-resolve the challenge with whatever answers have been submitted (call `resolveChallenge` server-side, do not wait for `C2S_CONTINUE_TO_ROUNDTABLE`)
- The Challenge component should display the shared `Timer` component

### Constraints
- Use existing CSS Module patterns — do not introduce Tailwind or a new styling system
- Use existing WebSocket hook (`useWebSocket.ts`) — do not create a new socket connection
- Do not change the `broadcastToSession` or `sendError` utility signatures
- TypeScript strict mode must remain satisfied

### Definition of done
- All three challenge types work end-to-end in a real game with 4+ players
- Shield indicator visible on player cards throughout the game when a shield is held
- Challenge timer auto-resolves the phase when it expires
- `CHALLENGE_RESULT` screen clearly shows winner and shield status
- TypeScript compiles cleanly, no console errors in browser

---

## PROMPT 4: Vitest Unit Tests

You are working on a multiplayer social deduction game called **Betrayal Game**. The tech stack is Node.js + TypeScript on the backend with a React 19 + Vite frontend. There is an existing e2e test at `test/e2e-game-test.ts` but no unit test suite yet.

### What needs to be done

Set up **Vitest** and write a unit test suite covering the core game logic in `src/game/manager.ts`. Do not test WebSocket routing or HTTP serving — test the pure game state functions only.

#### Setup

Install: `vitest`, `@vitest/coverage-v8`

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

Add a `vitest.config.ts` at the project root:
```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts']
  }
})
```

Create test files in `test/unit/`.

#### Test coverage required

Write tests for every exported function in `src/game/manager.ts`. The minimum cases to cover for each:

**`createGame(playerName)`**
- Returns a valid `GameState` with correct initial phase (`LOBBY`)
- Host player is present in players array with `isHost: true`
- `sessionId` is a non-empty string
- Default settings are applied

**`addPlayer(gameState, playerName)`**
- New player is added to players array
- New player has `isAlive: true`, `isConnected: true`, `isHost: false`
- Throws or returns an error state if game is not in `LOBBY` phase
- Throws or returns an error state if player count exceeds `maxPlayers`

**`assignRoles(gameState)`**
- With 5 players: exactly 1 Traitor assigned
- With 8 players: exactly 2 Traitors assigned
- With 12 players: exactly 3 Traitors assigned
- With 16+ players: exactly 4 Traitors assigned
- All players have a role after assignment
- No player has an undefined role

**`castVote(gameState, voterId, targetId)`**
- Vote is recorded correctly
- A player cannot vote twice — second vote replaces or is rejected (test whichever behaviour is implemented)
- Dead players cannot vote
- A player cannot vote for themselves (if that rule is enforced — test the actual behaviour)

**`resolveVote(gameState)`**
- Player with the most votes is banished (`isAlive: false`)
- Tie handling: if `tiedPlayerIds` is populated, phase moves to `REVOTE` rather than banishing
- After banishment, `banishedPlayerId` is set on the returned state

**`castMurderVote(gameState, traitorId, targetId)` and `resolveMurder(gameState)`**
- Murder vote is recorded
- When all alive traitors have voted, the plurality target is marked `isAlive: false`
- `lastMurderedPlayerId` is set on the returned state

**`checkWinCondition(gameState)`**
- Returns `'TRAITORS'` when traitors equal or outnumber faithful
- Returns `'FAITHFUL'` when no traitors remain
- Returns `null` when game is still ongoing

**`transferHost(gameState, newHostId)`**
- Old host loses `isHost: true`
- New host gains `isHost: true`

#### Test helpers

Create `test/unit/helpers.ts` with a `buildGame(overrides?)` factory function that returns a valid `GameState` with 6 players (1 traitor, 5 faithful) in `ROUNDTABLE` phase. Tests should use this factory rather than calling `createGame` + `addPlayer` repeatedly, so each test starts from a known clean state.

### Constraints
- Tests must be pure — no WebSocket connections, no HTTP requests, no file system access
- Do not mock `src/game/manager.ts` — test the real functions
- Each `describe` block covers one function; each `it` covers one behaviour
- Tests must pass with `vitest run` in under 5 seconds total

### Definition of done
- `vitest run` exits with 0 and all tests green
- Coverage report shows >80% line coverage on `src/game/manager.ts`
- At least 30 individual test cases written across all functions
- TypeScript compiles cleanly with no errors
