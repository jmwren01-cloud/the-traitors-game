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

## Remaining Tasks
- Reconnection handling with session tokens
- Sound effects for game events
- Animation polish pass
