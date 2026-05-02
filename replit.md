# The Traitors - Multiplayer Social Deduction Game

## Overview
This project is a web-based multiplayer social deduction game inspired by "The Traitors" TV show. The core objective is for players, secretly assigned as Traitors or Faithful, to achieve their respective win conditions: Traitors eliminate Faithful, and Faithful identify and banish Traitors. The game emphasizes real-time interaction, strategic decision-making, and social deception within a web-browser environment. The vision is to create an engaging and accessible digital adaptation of the popular social deduction format, allowing groups of friends to play together online with host-controlled pacing.

## User Preferences
- I prefer clear, concise, and direct instructions.
- I expect the agent to prioritize high-level architectural consistency.
- Before making significant architectural changes or adding new external dependencies, please ask for confirmation.
- I prefer an iterative development approach, with regular checkpoints and opportunities for feedback.
- Ensure all new features are mobile-responsive by default.
- When implementing new features, consider how they integrate with the existing game flow and win conditions.
- Do not make changes to files related to `changelogs`, `update logs`, or `date-wise entries`.

## System Architecture
The game is built as a real-time web application with a clear separation between frontend and backend.

**UI/UX Decisions:**
- Mobile-responsive design with touch targets of 54-60px to ensure usability on mobile devices.
- Visual countdown timers to guide pacing.
- Clear indicators for player status (e.g., dead players, host, disconnected).
- Tabbed chat UI with separate channels for general and traitor-only communication, including unread badges.
- Sound effects generated via Web Audio API for key game events, with a global mute/unmute toggle.
- PWA support with manifest.json for installability and improved mobile experience, including iOS Safari fixes and haptic feedback integration.

**Technical Implementations:**
- **Backend:** Node.js with Express and WebSocket for real-time communication.
    - `index.ts`: Entry point handling HTTP server, static files, and WebSocket Secure (WSS) setup.
    - `ws/router.ts`: Manages WebSocket connections and message routing.
    - `db/store.ts`: Handles SQLite persistence for game states and player tokens.
    - `game/manager.ts`: Contains the core game logic, including voting, murder mechanics, win condition checks, and phase transitions.
- **Frontend:** React with TypeScript.
    - `App.tsx`: Main component managing phase-based routing.
    - `hooks/useWebSocket.ts`: Custom hook for managing WebSocket connection and state.
    - Dedicated components for each game phase (Lobby, RoleReveal, Voting, NightPhase, GameEnd, Spectator).
- **Game Flow:**
    1.  **LOBBY**: Players join, host starts game.
    2.  **ROLE_ASSIGN** → **ROLE_REVEAL**: Roles (Traitors/Faithful) assigned.
    3.  **ROUNDTABLE** → **VOTING** → **VOTE_REVEAL** → **BANISH_REVEAL**: Discussion, voting, and banishment.
    4.  **CHECK_WIN**: Game end condition check.
    5.  **NIGHT**: Traitors vote on murder target, traitor-only chat.
    6.  **MORNING**: Murder revealed.
    7.  Loop back to ROUNDTABLE.
- **Win Conditions:** Traitors win if their number equals or exceeds Faithful; Faithful win if all Traitors are eliminated.
- **Key Features:**
    - WebSocket-based real-time multiplayer.
    - Live chat with traitor-only mode.
    - Host-controlled phase progression with client-side timers.
    - Automated host transfer on disconnect.
    - Reconnection system with session tokens, localStorage persistence, and full state sync.
    - Game replay and results summary ("How It Happened" timeline) post-game.
    - Spectator mode for eliminated players with role-specific visibility.
    - Traitor recruitment ability during the night phase (one-time per traitor, one per night).
    - Shield challenge system with mini-games, allowing players to block murder attempts.
    - Configurable game settings (timers, traitor count, min players, challenges enabled) controlled by the host.

## External Dependencies
- **Node.js**: Backend runtime environment.
- **Express.js**: Web framework for the backend.
- **WebSocket (ws library)**: For real-time bidirectional communication.
- **React**: Frontend UI library.
- **TypeScript**: For type-safe JavaScript development across both frontend and backend.
- **SQLite**: Database for persisting game states, tokens, and other game data.