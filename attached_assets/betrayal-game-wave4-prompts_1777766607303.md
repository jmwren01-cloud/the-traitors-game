# Betrayal Game — Wave 4: The Paranoia Engine
## Replit Agent Engineering Prompts

These five systems work together to create compounding asymmetric information. They must be built in order — each system references data structures and events introduced by the previous one.

**Prerequisites:** Wave 1 (WS Router, SQLite), Wave 2 (Player Profiles, Stats Engine), Wave 3 (HUD, Host Panel) must all be complete.

**Design principle for every prompt in this wave:** Information must be unreliable, not just hidden. Players should finish every round less certain than they started.

---

## PROMPT 1: Special Roles — Sheriff, Medic, Seer

You are working on **Betrayal Game** (Node.js + TypeScript backend, React 19 + Vite frontend, CSS Modules, SQLite persistence). The game currently supports two roles: `TRAITOR` and `FAITHFUL`. This prompt introduces three special roles that give specific players private, privileged — but potentially unreliable — information.

### Design intent

Special roles create information asymmetry within the Faithful team itself. The Sheriff thinks they know something. The Seer thinks they saw something. The Medic thinks they saved someone. None of them can be sure their information is accurate — and the Traitors know this, which means they can exploit it.

### The three special roles

**SHERIFF**
Assigned to one Faithful player at game start (only in games with 7+ players).
Each morning, the Sheriff receives a private "investigation result" about one randomly selected alive player: `SUSPICIOUS` or `CLEAR`.
The result is **75% accurate** — there is a 25% chance it is wrong (a Traitor shows as `CLEAR`, or a Faithful shows as `SUSPICIOUS`). The Sheriff does not know this probability — they only see the result.
The Sheriff may claim their role publicly at any time during Roundtable, but cannot prove it. Anyone can claim to be the Sheriff.

**MEDIC**
Assigned to one Faithful player at game start (only in games with 8+ players).
Each night, before the murder vote is resolved, the Medic secretly chooses one player to protect. If the Traitors murder that player, the murder is blocked (similar to the existing Shield mechanic, but covert — the Medic's identity is not revealed).
The Medic cannot protect the same player two nights in a row.
The Medic cannot protect themselves.
If the murder is blocked, the morning announcement is: "The Traitors struck, but their target survived." No name is given — not the target's name, not the Medic's. Both sides are left to infer what happened.

**SEER**
Assigned to one Faithful player at game start (only in games with 9+ players).
Once per game (not per round), the Seer may activate their ability during Roundtable by sending `C2S_ACTIVATE_SEER`. They privately receive the true role of one randomly selected alive player — always accurate, no false positives.
However: the Traitors are notified (privately, Traitor chat only) that "The Seer has activated." They do not learn who the Seer investigated or what they found — but they know the Seer now has dangerous information and should be prioritised for murder.

### Server-side implementation

#### Updated role types in `src/game/types.ts`:

```typescript
type Role = 'TRAITOR' | 'FAITHFUL' | 'SHERIFF' | 'MEDIC' | 'SEER'

// Add to Player type:
specialRoleUsed?: boolean        // Seer: has the one-time ability been used?
sheriffInvestigations: SheriffResult[]  // history of investigation results
medicLastProtected?: string      // player ID protected last night (cannot repeat)

type SheriffResult = {
  round: number
  targetId: string
  targetName: string
  result: 'SUSPICIOUS' | 'CLEAR'
  // Note: server stores the TRUE result separately (never sent to client)
  // The displayed result may be inverted 25% of the time
}
```

#### Role assignment in `src/game/manager.ts`

Extend `assignRoles` to assign special roles after Traitor assignment:

```typescript
// After assigning Traitors, from remaining Faithful players:
// 7+ players: assign SHERIFF to one random Faithful
// 8+ players: additionally assign MEDIC to one random Faithful  
// 9+ players: additionally assign SEER to one random Faithful
// All other Faithful remain role: 'FAITHFUL'
// Traitors are never assigned special roles
```

Add to `src/game/manager.ts`:

```typescript
export function generateSheriffResult(gameState: GameState, sheriffId: string): {
  game: GameState
  targetId: string
  targetName: string
  result: 'SUSPICIOUS' | 'CLEAR'
}
// Selects a random alive non-Sheriff player
// Determines true role (TRAITOR = SUSPICIOUS, others = CLEAR)
// Applies 25% inversion: Math.random() < 0.25 ? invert(result) : result
// Appends to sheriff player's sheriffInvestigations array
// Returns the (possibly false) result for broadcasting to Sheriff only

export function activateMedicProtection(gameState: GameState, medicId: string, targetId: string): GameState
// Validates: medicId has role MEDIC, targetId !== medicId, targetId !== medicLastProtected
// Sets a transient field: gameState.medicProtectedId = targetId
// This field is checked in resolveMurder and then cleared

export function activateSeer(gameState: GameState, seerId: string): {
  game: GameState
  targetId: string
  targetName: string
  trueRole: Role
}
// Validates: seerId has role SEER, specialRoleUsed !== true
// Selects random alive non-Seer player
// Returns their TRUE role — no inversion
// Sets specialRoleUsed: true on the Seer
// Sets a flag: gameState.seerActivatedThisRound = true (used to notify Traitors)
```

Modify `resolveMurder` to check `gameState.medicProtectedId` before resolving — if the murder target matches the protected player, block the murder (same behaviour as shield block but without revealing who was protected). Clear `medicProtectedId` after resolution regardless.

#### New WebSocket events

```typescript
// Client → Server
{ type: 'C2S_MEDIC_PROTECT', payload: { targetId: string } }
{ type: 'C2S_ACTIVATE_SEER', payload: Record<string, never> }

// Server → Client (private — sent only to specific player, not broadcast)
{ type: 'S2C_SHERIFF_RESULT', payload: {
    round: number
    targetId: string
    targetName: string
    result: 'SUSPICIOUS' | 'CLEAR'
    note: string  // "Trust your instincts. This information may not be complete."
  }
}
{ type: 'S2C_SEER_RESULT', payload: {
    targetId: string
    targetName: string
    trueRole: Role
  }
}
{ type: 'S2C_SEER_ACTIVATED', payload: { note: string } }
// Sent only to alive Traitors: "The Seer has activated. They now know a truth."

{ type: 'S2C_MEDIC_PROTECT_CONFIRMED', payload: { targetId: string; targetName: string } }
// Sent only to Medic

{ type: 'S2C_SPECIAL_ROLE_ASSIGNED', payload: { role: Role } }
// Sent only to the assigned player during role reveal
// Included in the existing S2C_ROLE_REVEAL payload — add a specialRole field
```

#### Timing

- Sheriff result: generated automatically at the start of each Morning phase, sent privately to the Sheriff before `S2C_MORNING_STARTED` is broadcast
- Medic protection: `C2S_MEDIC_PROTECT` is available during Night phase only, before murder resolution. Add a Medic section to the Night phase flow.
- Seer activation: available during Roundtable phase only, once per game

#### Game settings

Add to `GameSettings`:
```typescript
enableSpecialRoles: boolean  // default: true
```

Host can disable special roles in lobby settings. When disabled, all players get `FAITHFUL` or `TRAITOR` only.

### Client-side implementation

#### Role reveal modifications (`RoleReveal.tsx`)

When a player has a special role, show an extended briefing after the standard role reveal:

**SHERIFF briefing:** "You are the Sheriff. Each morning, you will receive a private investigation result about one player. Use this information wisely — but remember, even Sheriffs can be misled."

**MEDIC briefing:** "You are the Medic. Each night, you may secretly protect one player from murder. Your identity is never revealed — even if your protection saves someone."

**SEER briefing:** "You are the Seer. Once this game, you may activate your gift during discussion to learn one player's true role. But the moment you do — the Traitors will know you've seen something."

#### Sheriff result display

When `S2C_SHERIFF_RESULT` arrives, show a private notification card (overlay, visible only to the Sheriff, dismissed on tap):
- Dark background, gold border
- "Your investigation — Round [N]"
- "[Player name]: SUSPICIOUS" (red) or "[Player name]: CLEAR" (green)
- Below in small text: *"Trust your instincts. This information may not be complete."*
- The result is also accessible via a "My Investigations" tab in the Sheriff's HUD profile area (shows all results from all rounds)

#### Medic night UI

During Night phase, Medic players see an additional section above the main waiting screen:
- "Choose a player to protect tonight"
- List of alive players except themselves and last night's protected player
- Confirm button — sends `C2S_MEDIC_PROTECT`
- If they don't choose within 30 seconds, no one is protected (show a countdown)
- After confirming: "Protection confirmed. They don't know you're watching."

#### Seer roundtable UI

During Roundtable phase, Seer players see a subtle "Activate your gift" button in their HUD (below their role badge). Tapping shows a confirmation: "This is a one-time ability. Once used, the Traitors will know. Are you sure?" Confirm sends `C2S_ACTIVATE_SEER`. When `S2C_SEER_RESULT` arrives, show a private overlay with the result. After activation, the button is replaced with "Gift used — Round [N]."

### Constraints
- Sheriff false positive rate (25%) must be server-side only — never expose the true result to the client
- Medic identity must never be broadcast — not on block, not on confirmation
- Special roles must degrade gracefully when `enableSpecialRoles: false`
- All private events must be sent to individual WebSocket connections, never via `broadcastToSession`
- Traitors must not be assigned special roles under any circumstances
- TypeScript strict mode must be satisfied

### Definition of done
- Special roles assigned correctly based on player count thresholds
- Sheriff receives a private (possibly wrong) result each morning
- Medic protection silently blocks murders without revealing identity
- Seer activation notifies Traitors without revealing who was investigated
- All three role briefings render in RoleReveal
- `enableSpecialRoles: false` results in standard two-role game
- TypeScript compiles cleanly

---

## PROMPT 2: The Whisper System

You are working on **Betrayal Game** (Node.js + TypeScript backend, React 19 + Vite frontend, CSS Modules). Special roles are now implemented (Wave 4 Prompt 1).

### Design intent

Whispers are private one-to-one messages sent during the Roundtable phase. They create paranoia not through their content, but through their *visibility*. Everyone can see that a whisper was sent — "Josh whispered to Emma" — but only the recipient reads the message. The rest of the table is left to wonder: what did they say? Why those two? Are they allies — or is one of them setting up the other?

This is the mechanic that makes the social graph visible without making it legible.

### Rules

- Each player may send **one whisper per Roundtable phase** (not per game — resets each round)
- Whispers are available only during `ROUNDTABLE` phase
- A player cannot whisper to themselves
- Dead players cannot send or receive whispers
- The whisper notification ("X whispered to Y") is **broadcast to all players**
- The whisper content is sent **only to the recipient**
- Traitors may whisper to Faithful players and vice versa — there is no restriction
- Whispers are stored in game history for the post-game replay

### Server-side implementation

#### New types in `src/game/types.ts`:

```typescript
type Whisper = {
  id: string           // UUID
  round: number
  senderId: string
  senderName: string
  recipientId: string
  recipientName: string
  content: string      // max 200 chars
  sentAt: number       // Unix ms
}

// Add to GameState:
whispers: Whisper[]
whispersUsedThisRound: string[]  // player IDs who have used their whisper this round
```

Initialise both as empty arrays in `createGame`. Reset `whispersUsedThisRound` to `[]` at the start of each Roundtable phase (in `startRoundtable` or equivalent in `manager.ts`).

#### New functions in `src/game/manager.ts`:

```typescript
export function sendWhisper(
  gameState: GameState,
  senderId: string,
  recipientId: string,
  content: string
): { game: GameState; whisper: Whisper }
// Validates:
//   - phase is ROUNDTABLE
//   - sender is alive
//   - recipient is alive and not the sender
//   - sender has not already used their whisper this round (whispersUsedThisRound)
//   - content is 1–200 chars after trim
// Creates Whisper object, appends to gameState.whispers
// Adds senderId to whispersUsedThisRound
// Returns updated state and the whisper object

export function getWhispersForRound(gameState: GameState, round: number): Whisper[]
// Returns all whispers from a given round (used in replay)
```

#### New WebSocket events:

```typescript
// Client → Server
{ type: 'C2S_SEND_WHISPER', payload: { recipientId: string; content: string } }

// Server → Client
{ type: 'S2C_WHISPER_SENT', payload: {
    senderId: string
    senderName: string
    recipientId: string
    recipientName: string
    round: number
  }
}
// Broadcast to ALL players — everyone sees who whispered to whom, not what was said

{ type: 'S2C_WHISPER_RECEIVED', payload: {
    senderId: string
    senderName: string
    content: string
    round: number
  }
}
// Sent ONLY to the recipient

{ type: 'S2C_WHISPER_ERROR', payload: { message: string } }
// Sent only to sender if validation fails
// Messages: "You have already whispered this round", "That player is not available", etc.
```

Handle `C2S_SEND_WHISPER` in the WS router. After calling `sendWhisper`:
1. Broadcast `S2C_WHISPER_SENT` to all players
2. Send `S2C_WHISPER_RECEIVED` to the recipient's WebSocket connection only
3. Save updated game state

### Client-side implementation

#### Whisper UI in the Roundtable phase

During Roundtable, add a "Whisper" button to the player list (the roster panel in the HUD, or inline on the Roundtable component — wherever players are listed). Each alive player card shows a whisper icon button. Tapping opens a whisper compose modal:

- "Whisper to [Name]" header
- Textarea: max 200 chars, character counter shown
- "Send Whisper" button
- Cancel button
- Note below: "Everyone will see that you whispered. Only [Name] will read your message."

After sending:
- The compose modal closes
- The whisper icon on that player's card is replaced with "Whispered ✓"
- All other whisper buttons are disabled for this round (one whisper per round)
- Show a subtle confirmation: "Your whisper was delivered."

#### Whisper feed — visible to all players

Add a "Whispers" section to the Roundtable phase UI (below or alongside the chat, clearly labelled). This feed shows all whisper notifications from the current round in chronological order:

```
🤫 Josh whispered to Emma  (2 mins ago)
🤫 Alex whispered to Sam   (1 min ago)
```

No content — just sender and recipient. This feed is the social pressure mechanism. Players stare at it. They wonder. They ask questions about it in discussion.

The feed persists through the Voting phase too (read-only during voting) so players can reference it when casting their vote.

#### Whisper received notification

When `S2C_WHISPER_RECEIVED` arrives, show a private slide-in notification from the bottom of the screen:
- Dark background, purple accent (`#6b21a8`)
- "🤫 [Name] whispered to you"
- The message content in full
- Tap to dismiss
- The notification is also accessible via a "Whispers" inbox icon in the HUD (top bar) — a badge count shows unread whispers. Tapping opens a drawer showing all whispers received this game, in chronological order.

#### Whisper history in post-game replay

In the Game Replay component, each round's timeline should include whisper events: "Josh whispered to Emma" shown as a timeline entry. The content of whispers is revealed in the post-game replay — once the game is over, all whisper contents are included in `S2C_GAME_END`'s history payload. This is the "reveal" moment — players discover what was said in secret.

To support this: ensure `Whisper` objects (including `content`) are included in `gameState.history` events when recorded, and included in the `S2C_GAME_END` history payload.

### Constraints
- Whisper content must never appear in any broadcast — only in `S2C_WHISPER_RECEIVED` (during game) and `S2C_GAME_END` history (post-game)
- One whisper per player per round is enforced server-side — client UI is a convenience, not the guard
- Dead players' whisper buttons must not appear
- Whisper compose modal must prevent submission of empty or whitespace-only messages
- TypeScript strict mode must be satisfied

### Definition of done
- Players can send one whisper per Roundtable phase
- All players see "X whispered to Y" in the whisper feed
- Only the recipient receives the content
- Whisper inbox in HUD shows received whispers with badge count
- Post-game replay reveals all whisper contents
- Attempting to whisper twice returns a clear error
- TypeScript compiles cleanly

---

## PROMPT 3: False Evidence

You are working on **Betrayal Game** (Node.js + TypeScript backend, React 19 + Vite frontend, CSS Modules). Special roles (Wave 4/1) and Whispers (Wave 4/2) are implemented.

### Design intent

False Evidence gives Traitors an active tool to manufacture suspicion. Once per game, the Traitor team can collectively plant a piece of evidence that frames a Faithful player — making them appear suspicious to the Sheriff, or creating a public "anonymous tip" that other players must evaluate.

The paranoia this creates is systemic: once players know False Evidence exists as a mechanic, *all* evidence becomes suspect. The Sheriff doubts their own investigations. Players question anonymous tips. The Medic wonders if they're being played. Even the Seer's certainty is undermined — "but what if there's a mechanic I don't understand?"

### Rules

- Traitors may plant False Evidence **once per game**, during any Night phase
- All alive Traitors must agree (unanimous vote) before evidence is planted
- Evidence targets a specific Faithful player
- There are three types of evidence (Traitors choose one):
  - **FRAME** — corrupts the Sheriff's next investigation result for this target to always return `SUSPICIOUS`, regardless of the true 75/25 calculation
  - **WHISPER_FABRICATION** — creates a fake whisper notification: "X whispered to Y" where X is the framed Faithful and Y is a Traitor (or another Faithful). It appears in the whisper feed at the start of the next Roundtable, attributed to the previous round. No content is sent to anyone — there is no recipient — but the notification looks identical to a real whisper.
  - **ANONYMOUS_TIP** — plants an anonymous message in the Confession Booth (Wave 4 Prompt 4) for the next round, containing text crafted by the Traitors, attributed to "Anonymous"

- Evidence is consumed when planted — Traitors cannot plant a second piece
- The existence of the False Evidence mechanic is disclosed in the How to Play onboarding (update that screen) — players know it exists, but not when or if it's been used in their current game

### Server-side implementation

#### New types in `src/game/types.ts`:

```typescript
type EvidenceType = 'FRAME' | 'WHISPER_FABRICATION' | 'ANONYMOUS_TIP'

type FalseEvidence = {
  id: string
  plantedInRound: number
  plantedAt: number          // Unix ms
  type: EvidenceType
  targetId: string           // the framed player
  targetName: string
  craftedText?: string       // only for ANONYMOUS_TIP — the fabricated message (max 150 chars)
  activated: boolean         // false until it fires
}

type EvidenceVote = {
  traitorId: string
  agreedTargetId: string
  agreedType: EvidenceType
  craftedText?: string
}

// Add to GameState:
falseEvidence: FalseEvidence | null
evidenceVotes: EvidenceVote[]
evidenceUsed: boolean         // true once planted, prevents second use
```

#### New functions in `src/game/manager.ts`:

```typescript
export function castEvidenceVote(
  gameState: GameState,
  traitorId: string,
  targetId: string,
  type: EvidenceType,
  craftedText?: string
): GameState
// Validates: phase is NIGHT, traitorId is alive Traitor, evidenceUsed is false
// Upserts vote for this traitor

export function resolveEvidenceVotes(gameState: GameState): {
  game: GameState
  planted: boolean
  evidence: FalseEvidence | null
}
// Called when all alive Traitors have cast evidence votes
// Checks unanimity: all votes must agree on same targetId AND same type
// If unanimous: creates FalseEvidence, sets evidenceUsed: true, activated: false
// If not unanimous: clears evidenceVotes, returns planted: false
// Traitors are informed of the result either way

export function activateFalseEvidence(gameState: GameState): {
  game: GameState
  fabricatedWhisper?: { senderId: string; senderName: string; recipientId: string; recipientName: string }
  anonymousTip?: string
}
// Called at the start of the next Roundtable phase
// FRAME type: sets a flag on the target player: forceSuspicious: true
//   — checked in generateSheriffResult to override the 75/25 calculation
// WHISPER_FABRICATION type: returns a fabricated whisper notification object
//   — router broadcasts S2C_WHISPER_SENT with this data (no recipient content sent)
// ANONYMOUS_TIP type: returns the crafted text to be injected into the Confession Booth
// Sets evidence.activated: true
```

#### New WebSocket events:

```typescript
// Client → Server (Traitor only, during Night phase)
{ type: 'C2S_CAST_EVIDENCE_VOTE', payload: {
    targetId: string
    type: EvidenceType
    craftedText?: string    // required if type is ANONYMOUS_TIP, max 150 chars
  }
}

// Server → Client (Traitors only)
{ type: 'S2C_EVIDENCE_VOTE_CAST', payload: {
    votesReceived: number
    votesNeeded: number     // number of alive Traitors
  }
}
{ type: 'S2C_EVIDENCE_PLANTED', payload: {
    type: EvidenceType
    targetName: string      // shown to Traitors only
    note: string            // "Evidence will activate next Roundtable."
  }
}
{ type: 'S2C_EVIDENCE_FAILED', payload: {
    reason: 'NOT_UNANIMOUS'
    note: string            // "The Traitors did not agree. No evidence planted."
  }
}
```

#### Night phase integration

After murder votes are resolved (and after recruitment if applicable), show Traitors the evidence planting UI if `evidenceUsed` is false. This is optional — Traitors can skip it by unanimous "Skip" vote or host force-skip. Add a 60-second timer for this step.

#### Roundtable phase integration

At the start of each Roundtable, call `activateFalseEvidence` if evidence exists and `activated` is false. Handle the returned fabrication before broadcasting `S2C_ROUNDTABLE_STARTED`.

### Client-side implementation

#### Evidence UI in Night phase (Traitors only)

After murder resolution, Traitors see a new section in `NightPhase.tsx`:

"Plant False Evidence?" with three option cards:
- **Frame [choose player]** — "Corrupt the Sheriff's next investigation result"
- **Fabricate a Whisper** — "Make it look like [choose player] whispered to someone"
- **Plant an Anonymous Tip** — "Craft a message that appears in tomorrow's Confession Booth"

For each type, Traitors select a target from a list of alive Faithful players. For Anonymous Tip, a textarea appears (max 150 chars). Each Traitor votes. Progress shown: "[X]/[Y] Traitors agree."

If votes are not unanimous, show: "The Traitors disagreed. No evidence planted." and clear the section.

If unanimous, show: "Evidence planted. It will activate tomorrow." with a subtle confirmation animation.

"Skip" option available — if all Traitors skip, the section dismisses.

#### Fabricated whisper in the feed

When a `S2C_WHISPER_SENT` event arrives at the start of Roundtable (activated by False Evidence), it renders identically to a real whisper notification in the whisper feed. There is no visual distinction. Players must figure it out through social deduction.

#### Post-game reveal

In the post-game replay, False Evidence is revealed: "Round [N]: The Traitors planted [type] evidence targeting [Name]." This is the moment players understand what happened — and feel the full weight of having been manipulated.

### Constraints
- False Evidence activation must be server-side — never trust the client for evidence timing
- `FRAME` type must integrate with the existing Sheriff result generation without exposing the override to the Sheriff
- Fabricated whisper must be indistinguishable from a real whisper on the client
- Evidence crafted text (`ANONYMOUS_TIP`) must be sanitised: strip HTML, max 150 chars, no profanity filter needed
- TypeScript strict mode must be satisfied

### Definition of done
- Traitors can vote unanimously to plant evidence during Night phase
- Non-unanimous votes result in no evidence planted and clear feedback to Traitors
- FRAME type overrides Sheriff result correctly
- WHISPER_FABRICATION creates an indistinguishable fake whisper in the feed
- ANONYMOUS_TIP text appears in the next Confession Booth round
- Post-game replay reveals the evidence and its target
- TypeScript compiles cleanly

---

## PROMPT 4: The Confession Booth

You are working on **Betrayal Game** (Node.js + TypeScript backend, React 19 + Vite frontend, CSS Modules). Special roles, Whispers, and False Evidence are implemented (Wave 4 Prompts 1–3).

### Design intent

The Confession Booth is a mandatory anonymous statement phase that runs at the start of every Roundtable, before open discussion begins. Every alive player submits one short statement — it can be true, false, a deflection, an accusation, or anything else. All statements are revealed simultaneously and attributed only to "Anonymous."

The paranoia this creates is linguistic. Players must write something — silence isn't an option — and then spend the discussion trying to match statements to voices. The Traitors use it to deflect. The Sheriff uses it to signal without revealing themselves. The Seer uses it to drop hints. Everyone is a suspect. Every statement is a clue. None of it can be verified.

### Rules

- Every alive player submits exactly one statement per round, during a 60-second window at the start of Roundtable
- Statements are 10–120 characters, plain text
- Players who don't submit within 60 seconds receive a randomly selected default statement (see list below)
- All statements are revealed simultaneously when the timer expires or all players have submitted
- Statements are shown in a randomised order — not the order they were submitted, not alphabetical
- No attribution — all statements show as "Anonymous"
- Players can submit their statement and then still participate in the whisper system and chat — the Confession Booth doesn't block the rest of the Roundtable

**Default statements (randomly selected for non-submitters):**
- "I have no reason to lie."
- "I've been watching carefully."
- "Trust is earned, not given."
- "Something doesn't add up."
- "I know more than I'm saying."
- "I'm just trying to survive."

The False Evidence `ANONYMOUS_TIP` from Prompt 3 injects an additional statement — it appears as one extra anonymous entry in the pool, indistinguishable from player-submitted ones.

### Server-side implementation

#### New types in `src/game/types.ts`:

```typescript
type ConfessionEntry = {
  id: string               // UUID
  round: number
  playerId: string         // never revealed to clients during the game
  content: string
  isDefault: boolean       // true if auto-generated due to timeout
  isFabricated: boolean    // true if injected by False Evidence
  submittedAt: number      // Unix ms
}

type ConfessionReveal = {
  id: string
  content: string
  isDefault: boolean
  // No playerId — never included in broadcast
}

// Add to GameState:
confessionEntries: ConfessionEntry[]       // server-side only — includes playerIds
confessionSubmittedIds: string[]           // player IDs who have submitted this round
confessionRevealed: boolean                // true once statements are broadcast
```

#### New functions in `src/game/manager.ts`:

```typescript
export function submitConfession(
  gameState: GameState,
  playerId: string,
  content: string
): GameState
// Validates: playerId is alive, has not already submitted this round, content 10–120 chars
// Creates ConfessionEntry, appends to confessionEntries, adds playerId to confessionSubmittedIds

export function resolveConfessions(gameState: GameState): {
  game: GameState
  reveals: ConfessionReveal[]
}
// Auto-generates default statements for alive players who haven't submitted
// Injects fabricated Anonymous Tip if FalseEvidence.type === 'ANONYMOUS_TIP' and activated this round
// Shuffles all entries (Fisher-Yates) — randomised order
// Strips playerIds for broadcast — returns ConfessionReveal[] (no attribution)
// Sets confessionRevealed: true

export function getConfessionsWithAttribution(gameState: GameState, round: number): ConfessionEntry[]
// Returns full entries including playerIds — used ONLY for post-game replay
```

#### New WebSocket events:

```typescript
// Client → Server
{ type: 'C2S_SUBMIT_CONFESSION', payload: { content: string } }

// Server → Client
{ type: 'S2C_CONFESSION_PHASE_STARTED', payload: {
    round: number
    timeoutSeconds: 60
    alivePlayers: number
  }
}
{ type: 'S2C_CONFESSION_SUBMITTED', payload: {
    submittedCount: number
    totalNeeded: number
    // No player ID — just progress count
  }
}
// Broadcast to all — shows "X/Y players have confessed" without attribution

{ type: 'S2C_CONFESSIONS_REVEALED', payload: {
    round: number
    confessions: ConfessionReveal[]   // shuffled, no attribution
  }
}
```

#### Roundtable phase flow modification

Modify the Roundtable phase to have two sub-phases:
1. **Confession window** (60 seconds) — players submit statements, progress shown, timer visible
2. **Discussion** — confessions revealed, open chat available, whispers available

The transition from confession to discussion happens automatically when the timer expires or all alive players have submitted. Call `resolveConfessions` at this point, broadcast `S2C_CONFESSIONS_REVEALED`, then begin the normal Roundtable discussion window.

The existing Roundtable timer should now represent the *discussion* time — start it after confessions are revealed, not at the start of Roundtable.

### Client-side implementation

#### Confession Booth UI

Create `client/src/components/ConfessionBooth.tsx` and `ConfessionBooth.module.css`.

This component renders as a full-screen overlay at the start of each Roundtable, before the main discussion UI appears.

**During submission window:**
- Dark atmospheric background — candlelit feel: `#0a0806` background, `#c9a84c` accent glow
- "The Confession Booth — Round [N]" header
- Subtitle: "Speak your truth. Or don't. No one will know."
- Large textarea: placeholder "Say something…", max 120 chars, character counter
- "Confess" submit button (44px min height)
- Timer bar (60 seconds, draining left to right)
- Below: "[X] of [Y] players have spoken" — updates in real-time as `S2C_CONFESSION_SUBMITTED` arrives
- After submitting: textarea and button are replaced with "Your confession has been recorded." The player can see the progress counter but cannot change their statement.

**Confession reveal:**
When `S2C_CONFESSIONS_REVEALED` arrives, animate the overlay to show the confessions:
- Each confession card slides in from the bottom with a 200ms stagger
- Cards are styled identically — dark card, `#f0e6d3` text, "Anonymous" in small gold text above the statement
- After all cards are shown (or 3 seconds, whichever is later), a "Begin Discussion" button appears
- Tapping dismisses the overlay and reveals the main Roundtable UI underneath

**Confession panel during discussion:**
After dismissal, the confessions remain accessible via a "Confessions" tab in the Roundtable UI (alongside Chat). Players can re-read them during discussion. The panel shows all confessions for the current round in the same anonymous, randomised order.

#### Integration with False Evidence Anonymous Tip

The fabricated entry from Prompt 3 appears identically to a player submission. No distinction in the UI.

#### Post-game replay attribution

In the Game Replay screen, confessions are now revealed with attribution: "Round [N] Confessions" section shows each statement with the submitting player's name. This is the most satisfying post-game moment — players discover who said what. Players who received a default statement are marked "(didn't confess)."

To support this: `S2C_GAME_END` history must include the full `ConfessionEntry[]` (with `playerId`) for each round's confessions. Wire this in `recordWriter.ts` and the game end broadcast.

### Constraints
- Player attribution must never appear in any broadcast during an active game — strip all `playerId` fields before broadcasting
- The shuffling must be server-side (Fisher-Yates on the server) — never trust client-side ordering
- Default statement selection must be random per player per round — not the same default every time
- Timer must be enforced server-side — use `setTimeout` as with existing phase timers
- Confession Booth overlay must not prevent players from seeing incoming chat messages (they can be queued and shown once discussion begins)
- TypeScript strict mode must be satisfied

### Definition of done
- Confession Booth overlay renders at the start of every Roundtable
- All alive players can submit a statement within 60 seconds
- Non-submitters receive a random default statement
- Statements are revealed simultaneously in randomised order with no attribution
- False Evidence Anonymous Tip appears as an additional anonymous confession
- Post-game replay reveals full attribution for all confessions
- TypeScript compiles cleanly

---

## PROMPT 5: Suspicion Tokens & The Social Graph

You are working on **Betrayal Game** (Node.js + TypeScript backend, React 19 + Vite frontend, CSS Modules). Special roles, Whispers, False Evidence, and Confession Booth are all implemented (Wave 4 Prompts 1–4).

### Design intent

Suspicion Tokens make the social graph visible. At the end of each Roundtable phase, before voting begins, every alive player publicly places a Suspicion Token on one other player — the person they currently suspect most. These placements are shown to everyone as a live visual network: nodes (players) connected by directed arrows (suspicion).

The paranoia this creates is relational. Seeing that three people suspect you — even before a vote — changes how you act. Seeing that no one suspects the actual Traitor is maddening. Seeing two Traitors suspicion-token each other (a deliberate misdirection play) is an act of tactical deception that players will talk about for weeks.

Suspicion Tokens are distinct from votes: they don't banish anyone. They are social signals — public commitments that can be used as evidence ("you suspected Josh last round, but now you're voting for Emma — why?").

### Rules

- Each alive player places exactly one Suspicion Token per round, at the end of Roundtable (after confession and discussion, before voting starts)
- Players cannot token themselves
- Dead players do not place tokens
- Token placement is **simultaneous** — all players submit privately, then all are revealed at once (same mechanic as confession reveal)
- A 45-second timer — players who don't submit receive a randomly assigned token (to a random alive non-self player)
- Tokens are public and persistent throughout the game — the full history of who suspected whom each round is always visible
- Changing your token from round to round is allowed and notable — the change itself is information

### Server-side implementation

#### New types in `src/game/types.ts`:

```typescript
type SuspicionToken = {
  round: number
  placerId: string
  placerName: string
  targetId: string
  targetName: string
  placedAt: number       // Unix ms
  isDefault: boolean     // true if auto-placed due to timeout
}

type SuspicionGraph = {
  round: number
  tokens: SuspicionToken[]
}

// Add to GameState:
suspicionHistory: SuspicionGraph[]          // all rounds' token placements
pendingSuspicionTokens: Partial<SuspicionToken>[]  // during collection window
suspicionTokensSubmittedIds: string[]       // player IDs who have submitted this round
```

#### New functions in `src/game/manager.ts`:

```typescript
export function submitSuspicionToken(
  gameState: GameState,
  placerId: string,
  targetId: string
): GameState
// Validates: phase is ROUNDTABLE (token collection sub-phase), placerId is alive,
//   has not already submitted, targetId is alive and not placerId
// Appends to pendingSuspicionTokens, adds placerId to suspicionTokensSubmittedIds

export function resolveSuspicionTokens(gameState: GameState): {
  game: GameState
  graph: SuspicionGraph
}
// Auto-assigns random tokens for non-submitters
// Creates SuspicionGraph for this round
// Appends to suspicionHistory
// Clears pendingSuspicionTokens and suspicionTokensSubmittedIds
// Returns updated state and the new graph for broadcasting

export function getSuspicionSummary(gameState: GameState, playerId: string): {
  receivedThisRound: number        // tokens pointing at this player this round
  receivedTotal: number            // total tokens received across all rounds
  mostSuspectedBy: string[]        // player IDs who have consistently tokened this player
}
// Used for the HUD suspicion indicator
```

#### New WebSocket events:

```typescript
// Client → Server
{ type: 'C2S_SUBMIT_SUSPICION_TOKEN', payload: { targetId: string } }

// Server → Client
{ type: 'S2C_SUSPICION_PHASE_STARTED', payload: {
    round: number
    timeoutSeconds: 45
  }
}
{ type: 'S2C_SUSPICION_TOKEN_SUBMITTED', payload: {
    submittedCount: number
    totalNeeded: number
    // No attribution during collection
  }
}
{ type: 'S2C_SUSPICION_GRAPH_REVEALED', payload: {
    round: number
    graph: SuspicionGraph    // full attribution — this reveal is public
  }
}
{ type: 'S2C_SUSPICION_HISTORY', payload: {
    history: SuspicionGraph[]
  }
}
// Sent on reconnection to restore full history
```

#### Roundtable phase flow — final sequence

The complete Roundtable sub-phase flow is now:

1. **Confession window** (60s) — from Prompt 4
2. **Discussion** (configured timer, default 5 mins)
3. **Suspicion Token collection** (45s) — new from this prompt
4. **Token reveal** — simultaneous reveal, then transition to Voting

The host panel must reflect this new sequence. Voting cannot begin until tokens have been resolved.

### Client-side implementation

#### Suspicion Token collection UI

When `S2C_SUSPICION_PHASE_STARTED` arrives, show a full-screen overlay (similar to Confession Booth):

- Background: `#0a0a0f` (deep navy), accent `#8b1a1a` (suspicion red)
- "Who do you suspect?" header
- Subtitle: "Your suspicion is about to become public."
- Player grid: all alive players except self, displayed as cards (name + avatar colour)
- Tap to select — selected card gets a red border and a 🎯 token indicator
- "Place Token" button — enabled only when a player is selected
- Timer bar (45 seconds)
- "[X] of [Y] players have placed their token" — live progress, no attribution

After submitting: selected player card shows "Token placed ✓", button disabled, player waits for others.

#### Token reveal — the social graph visualisation

When `S2C_SUSPICION_GRAPH_REVEALED` arrives, animate the reveal:

Create `client/src/components/SuspicionGraph.tsx`. This renders as a force-directed graph using **pure CSS and SVG** — no D3, no external library.

Layout algorithm (simplified, not true force-directed — approximate positions):
- Arrange all alive player nodes in a circle
- Draw directed arrows (SVG `<line>` or `<path>` with arrowhead markers) from each placer to their target
- Nodes are coloured circles with player initials
- Arrow colours: if arrow points to a dead player (shouldn't happen this round, but handle it), grey; otherwise red
- Players with multiple arrows pointing at them get a pulsing red glow (`@keyframes` pulse)
- The current player's node has a gold border

Animate arrows drawing in one by one with a 150ms stagger — each arrow draws from placer to target using CSS `stroke-dasharray` / `stroke-dashoffset` animation.

After the full graph is shown (or 4 seconds), a "Proceed to Vote" button appears (host only — sends `C2S_START_VOTING`). All players see a "Waiting for host to start the vote" message.

#### Persistent suspicion indicators

After each round's graph is revealed, update the player cards throughout the game to show a small suspicion indicator:
- A red token count badge on each player card: "🎯 3" means 3 tokens received this round
- Hovering/tapping the badge shows: "Suspected by [Name], [Name], [Name] this round"
- In the HUD player roster panel, show each player's total token count across the game next to their name

#### Suspicion history panel

Add a "History" tab to the Roundtable UI (alongside Chat and Confessions). This tab shows a compact text summary of all past suspicion rounds:

```
Round 1: Josh → Emma, Emma → Alex, Alex → Josh, Sam → Josh…
Round 2: Josh → Sam, Emma → Josh (changed), Alex → Josh…
```

Changed suspicions (different target from last round) are highlighted in gold — they're the most interesting data points. Players use this to argue: "Emma, you suspected Josh last round and now you're suddenly suspecting Sam — what changed?"

### Constraints
- Token collection must be simultaneous reveal — no player sees others' tokens until `S2C_SUSPICION_GRAPH_REVEALED`
- The SVG graph must render correctly at 375px width (mobile) — limit to 8 nodes maximum in circular layout; for 9+ players, fall back to a compact list view
- Auto-assigned tokens (non-submitters) must be flagged as `isDefault: true` in `SuspicionGraph` and shown with a grey arrow in the visualisation
- Voting cannot begin until `resolveSuspicionTokens` has been called — enforce this server-side
- TypeScript strict mode must be satisfied

### Definition of done
- Suspicion token collection runs for 45 seconds at the end of each Roundtable
- Non-submitters receive a random auto-token
- SVG graph animates correctly at desktop and mobile (375px) viewport sizes
- Changed suspicions are highlighted in the history panel
- Token counts are visible on player cards throughout the game
- Voting cannot start until tokens are resolved
- Post-game replay includes full suspicion history with attribution
- TypeScript compiles cleanly, no console errors
