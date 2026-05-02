# The Traitors - Multiplayer Social Deduction Game

## Overview
A web-based multiplayer social deduction game inspired by the TV show "The Traitors". Players are secretly assigned as either Traitors or Faithful. Traitors work together to eliminate players each night, while Faithful try to identify and banish the Traitors during roundtable voting.

## Project Structure
```
Betrayal Game/
├── src/                    # Backend (Node.js + Express + WebSocket)
│   ├── index.ts           # Entry point: HTTP server, static files, WSS setup (~75 lines)
│   ├── ws/
│   │   ├── context.ts     # Shared Maps (games, playerConnections, sessionTokens, etc.)
│   │   ├── utils.ts       # broadcastToSession, sendError, recruitment broadcast helpers
│   │   ├── voteReveal.ts  # startVoteRevealSequence with interval-based reveal logic
│   │   └── router.ts      # handleConnection: all C2S event handlers + close handler
│   └── game/
│       ├── types.ts       # TypeScript types (GameState, Player, etc.)
│       └── manager.ts     # Game logic (voting, murder, win conditions)
├── client/                 # Frontend (React + TypeScript)
│   ├── src/
│   │   ├── App.tsx        # Main component with phase routing
│   │   ├── types.ts       # Client-side TypeScript types
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts  # WebSocket connection hook
│   │   └── components/
│   │       ├── Lobby.tsx       # Game lobby and join screen
│   │       ├── RoleReveal.tsx  # Secret role assignment screen
│   │       ├── Voting.tsx      # Roundtable and voting phases
│   │       ├── NightPhase.tsx  # Night phase (traitor murder)
│   │       ├── GameEnd.tsx     # Win/lose screen
│   │       ├── ChatBox.tsx     # In-game chat (traitor-only during night)
│   │       └── Timer.tsx       # Visual countdown timer
│   └── dist/              # Built frontend assets
└── package.json           # Dependencies
```

## Game Flow
1. **LOBBY** - Players join with session code, host starts when 6+ players
2. **ROLE_ASSIGN** → **ROLE_REVEAL** - 20% are Traitors, rest are Faithful
3. **ROUNDTABLE** - Discussion phase with 120s timer
4. **VOTING** - Each player votes to banish someone (60s timer)
5. **VOTE_REVEAL** → **BANISH_REVEAL** - Show votes, reveal banished player's role
6. **CHECK_WIN** - Check if game ended
7. **NIGHT** - Traitors vote on murder target (90s timer), chat is traitor-only
8. **MORNING** - Reveal murdered player
9. Loop back to ROUNDTABLE until win condition

## Win Conditions
- **Traitors Win**: Equal or more Traitors than Faithful remain alive
- **Faithful Win**: All Traitors are eliminated

## Key Features (Phase 1 Complete)
- Mobile-responsive UI with 54-60px touch targets
- WebSocket-based real-time multiplayer
- Live chat with traitor-only mode during night phase
- Visual countdown timers (host-controlled progression)
- Tie vote handling (random selection)
- Automatic host transfer on disconnect
- Empty game cleanup

## Design Philosophy
Host controls phase transitions (matching TV show format) while visual timers provide pacing guidance for players.

## Running the Game
Start workflow: `cd "Betrayal Game" && npm run dev`
- Backend runs on port 3001
- Frontend served from port 5000
- WebSocket connects to backend via proxy

## Recent Changes
- 2026-01-16: Added Timer component, ChatBox with traitor-only mode
- 2026-01-16: Implemented edge case handlers (tie votes, host transfer, empty cleanup)
- 2026-01-16: Mobile responsive CSS with proper viewport handling
- 2026-01-16: Auto-reveal votes when all votes received, live vote counter
- 2026-01-16: Tie-breaking revote system (TIE_DETECTED → REVOTE phases)
- 2026-01-16: Round 1 discussion-only mode (no banishment, traitors still murder)
- 2026-01-16: Random tiebreaker selection when revote still ties (TIEBREAKER_REVEAL phase)
- 2026-01-16: Duplicate name prevention when joining games
- 2026-01-16: Fixed Round 1 currentRound tracking for proper discussion-only mode
- 2026-01-16: Added "Fellow Traitors" section during night phase with red glowing avatars
- 2026-01-16: Auto-advance murder resolution when all traitors vote (no manual button needed)
- 2026-01-16: Dead player visualization at roundtable with cross marks and strikethrough names
- 2026-01-16: Dual chat system - General (everyone) + Traitors-only (alive traitors only)
- 2026-01-16: Tabbed chat UI with unread badges, per-channel scroll position, red theme for traitor mode
- 2026-01-16: Dead traitors lose access to traitor chat channel
- 2026-01-16: Sequential vote reveal system with 4-second intervals between reveals
- 2026-01-16: Optional vote reasoning (max 120 chars) displayed during dramatic reveal
- 2026-01-16: Live tally leaderboard with animated progress bars and pulsing highlights for top candidates
- 2026-01-16: Vote locking after all votes received, double-submission prevention, phase guards
- 2026-01-16: Server-authoritative reveal timing with client state sync (totalVotes, revealIndex)
- 2026-01-16: Auto-vote safety mechanism for players who don't vote in time
  - Round 1: Random selection from valid targets
  - Round 2+: Repeats player's last manual vote if target still valid, otherwise random
  - Host can force resolve voting with pending auto-votes
  - Auto-votes shown with orange dashed border and "Auto" badge during reveal
- 2026-01-16: Configurable game settings system
  - Host-only settings panel in lobby with toggle visibility
  - Adjustable timer durations (30-300s roundtable, 30-120s voting, 30-180s night)
  - Traitor assignment mode: auto (1 per 5 players) or fixed count (1-4 traitors)
  - Minimum players to start (5-10)
  - Round 1 discussion-only toggle
  - Settings synced via WebSocket to all players
  - Non-host players see settings preview

## Shield Challenge System (Completed 2026-01-16)
- Three mini-game types rotate randomly each morning (when enabled):
  - **Time Estimate**: Tap when you think N seconds have passed (4-8s target)
  - **Missing Player**: Memorize 6 players for 3 seconds, identify who disappeared
  - **Word Scramble**: Unscramble a 4-5 letter word (typo-tolerant: Levenshtein ≤1)
- Challenge phase flow: MORNING → CHALLENGE → CHALLENGE_RESULT → ROUNDTABLE
- Shield mechanics:
  - Max 1 shield per player at a time
  - Blocks murder attempt and is consumed
  - Players can reveal shields (or bluff during roundtable)
  - Winners have 1-round cooldown before winning again
  - Traitors can earn shields too
- Host toggle in settings: `challengesEnabled` (default: on)
- Visual indicators: 🛡️ icons on player avatars, shield block animation on morning reveal
- Key files: Challenge.tsx, Challenge.module.css, manager.ts (createChallenge, submitChallengeAnswer, resolveChallenge)

## Bug Fixes (2026-01-17)
- Fixed night phase auto-resolution: resolveMurder() now correctly handles MurderResult return type with shield blocking
- Added try/catch and phase guard to prevent crashes during murder resolution race conditions
- Restored game code copy button with clipboard API fallback for insecure contexts
- Murder target filtering now uses traitorIds (from server) with role fallback, preventing traitor-on-traitor selections in UI

## Bug Fixes (2026-01-27)
- Fixed voting state not resetting between rounds: S2C_VOTING_STARTED, S2C_ROUNDTABLE_STARTED, and S2C_REVOTE_STARTED handlers now reset all reveal state (revealIndex, revealOrder, revealedVotes, currentTally, totalVotes, currentReveal)
- Added safeguard in Voting.tsx: revealComplete now requires actual revealedVotes to prevent stale state from previous rounds

## Game Replay & Results Summary (Completed 2026-05-02)
- After a game ends, the Game Over screen shows a "How It Happened" round-by-round timeline
- Each round card shows: complete vote breakdown (voter → target, role pills, auto-vote badge, optional vote reason), who was banished (with role revealed), and the night outcome (murder, shield block, or peaceful)
- Server captures `RoundRecord[]` in `game.history` throughout the game:
  - `banishPlayer()` snapshots `revealedVotes` to `lastRoundVotes` at the moment of banishment
  - `resolveMurder()` stores `lastShieldedPlayerId` when a murder is blocked
  - `continueToDayPhase()` builds and appends a RoundRecord after each night resolves
  - `checkWinCondition()` also appends a RoundRecord when banishment directly ends the game
- `history` is passed to clients via `S2C_GAME_END` and `S2C_RECONNECTED` payloads
- Key files: `src/game/types.ts` (VoteEntry, RoundRecord types), `src/game/manager.ts`, `src/index.ts`, `client/src/types.ts`, `client/src/hooks/useWebSocket.ts`, `client/src/components/GameEnd.tsx`, `client/src/components/GameEnd.module.css`

## Spectator Mode (Completed 2026-05-02)
- Dead players automatically enter spectator (ghost) mode instead of seeing the normal game screens
- Ghost banner with floating 👻 icon and "You are a Ghost / Watch the game unfold from beyond..." subtitle
- Phase card shows what's currently happening (discussion, voting, night, morning, etc.)
- Vote reveal: spectators watch the live tally and each reveal step in real time
- Morning: murdered player or shield-block announcement shown
- Banish reveal: banished player name + role shown (this is public information)
- Night phase: dark moody mode with "The Traitors are meeting in secret..." — no murder voting UI
- Player list: alive players shown normally, eliminated players shown with strikethrough and role icon (revealed after death)
- Traitor identities hidden throughout — dead players never see `traitorIds` for living players
- Chat: dead players keep general chat (read + write); traitor chat access already revoked by `isAlive` check
- Key files: Spectator.tsx, Spectator.module.css, App.tsx (spectator routing block)

## Traitor Recruitment Ability (Completed 2026-05-02)
- Each Traitor gets a one-time ability to secretly recruit a Faithful player during the NIGHT phase
- Recruitment panel appears in the traitor night UI below the murder voting section; shows alive Faithful players as targets
- Server: `submitRecruitment()` validates eligibility and sets `pendingRecruitmentTargetId`; resolved inside `resolveMurder()` which flips the player's role to TRAITOR
- Only one recruitment per game per traitor (`recruitmentUsed` flag on Player), only one recruitment per night (server enforces via `pendingRecruitmentTargetId`)
- WebSocket events: `C2S_SUBMIT_RECRUITMENT` → `S2C_RECRUITMENT_SUBMITTED` (to all traitors), `S2C_YOU_WERE_RECRUITED` (to the convert), `S2C_PLAYER_RECRUITED` (to existing traitors)
- Morning reveal: recruited player sees "You Have Been Recruited!" fullscreen overlay (dark red, pulsing); all others see a recruitment announcement with the player's name; traitors see "[name] has joined your ranks!"
- `S2C_MORNING_STARTED` now carries `recruitedPlayerId/recruitedPlayerName` for public morning announcement
- Game history: `RoundRecord.recruitedName` captured and shown in the post-game timeline with 🤝 icon
- Key files: `src/game/manager.ts` (submitRecruitment, resolveMurder, buildRoundRecord), `src/index.ts` (broadcastRecruitmentEvents, C2S_SUBMIT_RECRUITMENT handler), `client/src/hooks/gameStateReducer.ts` (3 new cases), `client/src/components/NightPhase.tsx` + `NightPhase.module.css`, `client/src/components/GameEnd.tsx` + `GameEnd.module.css`

## Remaining Tasks
- (none currently)

## Sound Effects (Completed 2026-01-16)
- Web Audio API oscillator-based sound generation (no external audio files)
- SoundContext for global sound management with mute/unmute toggle
- Floating sound button (🔊/🔇) in top-right corner
- Sound types: roleReveal, traitorReveal, faithfulReveal, voteSubmit, voteReveal, banishment, murder, timerWarning, timerEnd, traitorWin, faithfulWin, nightStart, morningStart, tieDetected, chat
- Triggers integrated into RoleReveal, Voting, NightPhase, and GameEnd components

## Reconnection System (Completed 2026-01-16)
- Server generates UUID session tokens on create/join
- Tokens stored client-side in localStorage
- 60-second grace period for disconnected players
- Full state sync on reconnection (role, votes, chat, timers, reveal state, tiebreaker data)
- "AWAY" badge displayed for disconnected players (opacity + dashed border)
- Grace period cleanup runs every 15 seconds
- Supports reconnection during any game phase including mid-vote-reveal

## Mobile PWA Optimization (Completed 2026-01-16)
- **PWA Support**: manifest.json with app icons, theme colors, standalone display mode
- **iOS Safari Fixes**: 100dvh viewport units, safe-area-inset padding, rubber-banding prevention
- **Connection Status**: Visual indicator showing connected/reconnecting state (green ring/yellow pulse)
- **Haptic Feedback**: Vibration API integration for role reveal, voting, murder, game end
- **Touch Targets**: Minimum 48px touch targets on all interactive elements
- **Keyboard Handling**: dvh units prevent iOS keyboard from covering chat input
- **Audio**: Web Audio API with user interaction requirement for autoplay compliance
- **Install Prompt**: "Add to Home Screen" meta tags for iOS/Android
- Key files: client/public/manifest.json, client/src/utils/haptics.ts, client/src/components/ConnectionStatus.tsx
