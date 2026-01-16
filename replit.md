# The Traitors - Multiplayer Social Deduction Game

## Overview
A web-based multiplayer social deduction game inspired by the TV show "The Traitors". Players are secretly assigned as either Traitors or Faithful. Traitors work together to eliminate players each night, while Faithful try to identify and banish the Traitors during roundtable voting.

## Project Structure
```
Betrayal Game/
├── src/                    # Backend (Node.js + Express + WebSocket)
│   ├── index.ts           # WebSocket server and event handlers
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

## Remaining Tasks
- None - Phase 1 complete!

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
