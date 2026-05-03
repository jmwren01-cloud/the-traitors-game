import { useEffect, useRef, useState } from 'react';
import type {
  Player, RoundRecord, C2SEvent, Role, Whisper, FalseEvidence,
  PlayerStatsPayload, LeaderboardEntryPayload, GlobalStatsPayload
} from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import { getOrCreateDeviceToken } from '../utils/identity';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';
import { ProfileDrawer } from './ProfileDrawer';
import { RevealGraph } from './SuspicionTokens';
import styles from './GameEnd.module.css';

interface GameEndProps {
  winner?: 'TRAITORS' | 'FAITHFUL';
  endReason?: 'HOST_ENDED';
  players: Player[];
  myRole?: string;
  history?: RoundRecord[];
  /** every whisper from the game, content fully revealed. */
  whispers?: Whisper[];
  /** Wave 4 / 3 — False Evidence revealed for everyone post-game. */
  falseEvidence?: FalseEvidence;

  myPlayerId?: string;
  playerStats?: PlayerStatsPayload | null;
  leaderboard?: { metric: string; entries: LeaderboardEntryPayload[] } | null;
  globalStats?: GlobalStatsPayload | null;
  onSend?: (event: C2SEvent) => void;
}

/**
 * Cinematic 5-stage post-game summary.
 *
 * Stage 0 (0–1.5s): black fade-in + "Game Over"
 * Stage 1 (1.5–4s): winner banner reveal (drum-roll feel)
 * Stage 2 (4–6s):   personal "You Won/Lost" verdict
 * Stage 3 (6–9s):   roles revealed for both teams
 * Stage 4 (9s+):    timeline + per-player stats + actions
 *
 * Host (or anyone) can press "Skip cinematic" to jump to stage 4 immediately.
 */

const STAGE_TIMINGS_MS = [0, 1500, 4000, 6000, 9000];

function RolePill({ role }: { role: Role }) {
  // Team-membership pill: special roles collapse to "Faithful".
  const isTraitor = role === 'TRAITOR';
  return (
    <span className={isTraitor ? styles.pillTraitor : styles.pillFaithful}>
      {isTraitor ? 'Traitor' : 'Faithful'}
    </span>
  );
}

// Literal role label for the Seer reveal: the Seer learns the TRUE role,
// not just the team, so Sheriff/Medic/Seer/Faithful/Traitor all render
// distinctly.
const SEER_ROLE_LABEL: Record<Role, string> = {
  TRAITOR: 'Traitor',
  FAITHFUL: 'Faithful',
  SHERIFF: 'Sheriff',
  MEDIC: 'Medic',
  SEER: 'Seer',
};
function SeerRolePill({ role }: { role: Role }) {
  const isTraitor = role === 'TRAITOR';
  return (
    <span className={isTraitor ? styles.pillTraitor : styles.pillFaithful}>
      {SEER_ROLE_LABEL[role]}
    </span>
  );
}

function PlayerChip({ player, name }: { player?: Player; name?: string }) {
  const displayName = name ?? player?.name ?? 'Unknown';
  const colorHex = getColorHex(player?.color);
  const emoji = getAvatarEmoji(player?.avatar);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
      <span
        aria-hidden
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, borderRadius: '50%',
          background: colorHex, color: '#000', fontSize: 12, lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {emoji}
      </span>
      <strong style={{ color: colorHex }}>{displayName}</strong>
    </span>
  );
}

function RoundCard({ record, index, whispers, players }: { record: RoundRecord; index: number; whispers?: Whisper[]; players: Player[] }) {
  const hasVotes = record.votes.length > 0;
  const roundWhispers = (whispers ?? []).filter((w) => w.round === record.round);
  const playerById = (id: string | undefined): Player | undefined =>
    id ? players.find((p) => p.id === id) : undefined;
  const playerByName = (name: string | undefined): Player | undefined =>
    name ? players.find((p) => p.name === name) : undefined;
  const playerNameById = (id: string | undefined): string =>
    playerById(id)?.name ?? 'Unknown';

  return (
    <div className={styles.roundCard} style={{ animationDelay: `${0.1 + index * 0.12}s` }}>
      <div className={styles.roundLabel}>Round {record.round}</div>

      {/* Rows render in chronological round order: confessions, seer,
          tokens, vote+banish, medic, murder/shield, recruit, sheriff,
          whispers. */}
      {record.confessions && record.confessions.length > 0 && (
        <div style={{
          marginTop: 12, padding: 10,
          border: '1px solid rgba(212,165,80,0.4)', borderRadius: 8,
          background: 'rgba(80,30,10,0.18)',
        }}>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6, letterSpacing: 0.4, color: '#f7d896' }}>
            🕯️ CONFESSIONS
          </div>
          {record.confessions.map((c) => {
            if (c.isAnonymousTip) {
              return (
                <div key={c.id} style={{ fontSize: 13, padding: '4px 0', color: '#ffb380' }}>
                  <strong>Anonymous Tip</strong>
                  <span style={{ opacity: 0.85, marginLeft: 6, fontStyle: 'italic' }}>— "{c.text}"</span>
                </div>
              );
            }
            const author = playerById(c.playerId);
            return (
              <div key={c.id} style={{ fontSize: 13, padding: '4px 0' }}>
                <PlayerChip player={author} name={playerNameById(c.playerId)} />
                {c.isDefault && (
                  <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7, fontStyle: 'italic' }}>
                    (didn't confess)
                  </span>
                )}
                <span style={{ opacity: 0.85, marginLeft: 6, fontStyle: 'italic' }}>— "{c.text}"</span>
              </div>
            );
          })}
        </div>
      )}

      {record.seerReveal && (
        <div className={styles.outcomeRow}>
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>🔮</span>
            <span className={styles.outcomeText}>
              <PlayerChip player={playerById(record.seerReveal.seerId)} name={record.seerReveal.seerName} />
              {"'s gift revealed "}
              <PlayerChip player={playerById(record.seerReveal.targetId)} name={record.seerReveal.targetName} />
              {' as '}<SeerRolePill role={record.seerReveal.actualRole} />
            </span>
          </div>
        </div>
      )}

      {record.suspicionTokens && record.suspicionTokens.length > 0 && (
        <div style={{
          marginTop: 12, padding: 10,
          border: '1px solid rgba(180, 120, 255, 0.4)', borderRadius: 8,
          background: 'rgba(36, 20, 64, 0.35)',
        }}>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6, letterSpacing: 0.4, color: '#d9b6ff' }}>
            🎯 SUSPICION TOKENS
          </div>
          <RevealGraph
            players={players.filter((p) => record.suspicionTokens!.some(
              (t) => t.placerId === p.id || t.targetId === p.id,
            ))}
            tokens={record.suspicionTokens}
          />
        </div>
      )}

      {hasVotes ? (
        <div className={styles.voteSection}>
          <div className={styles.voteSectionTitle}>Roundtable vote</div>
          <div className={styles.voteTable}>
            {record.votes.map((v, i) => (
              <div key={i} className={`${styles.voteRow} ${v.isAutoVote ? styles.autoVoteRow : ''}`}>
                <div className={styles.voteVoter}>
                  <PlayerChip player={playerByName(v.voterName)} name={v.voterName} />
                  <RolePill role={v.voterRole} />
                  {v.isAutoVote && <span className={styles.autoBadge}>Auto</span>}
                </div>
                <span className={styles.voteArrow}>&#8594;</span>
                <div className={styles.voteTarget}>
                  <PlayerChip player={playerByName(v.targetName)} name={v.targetName} />
                  <RolePill role={v.targetRole} />
                </div>
                {v.reasonText && (
                  <div className={styles.voteReason}>&ldquo;{v.reasonText}&rdquo;</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.noVoteNote}>Discussion only — no banishment vote</div>
      )}

      <div className={styles.outcomeRow}>
        {record.banishedName ? (
          <div className={styles.banishOutcome}>
            <span className={styles.outcomeIcon}>🪄</span>
            <span className={styles.outcomeText}>
              <PlayerChip player={playerByName(record.banishedName)} name={record.banishedName} /> was banished
              {record.banishedRole && (<> &mdash; <RolePill role={record.banishedRole} /></>)}
            </span>
          </div>
        ) : (
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>💬</span>
            <span>No one was banished this round</span>
          </div>
        )}
      </div>

      {record.medicProtection && (
        <div className={styles.outcomeRow}>
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>{record.medicProtection.saved ? '💉' : '🩺'}</span>
            <span className={styles.outcomeText}>
              <PlayerChip player={playerById(record.medicProtection.medicId)} name={record.medicProtection.medicName} />
              {record.medicProtection.saved ? ' saved ' : ' protected '}
              <PlayerChip player={playerById(record.medicProtection.targetId)} name={record.medicProtection.targetName} />
              {record.medicProtection.saved && ' from the Traitors'}
            </span>
          </div>
        </div>
      )}

      <div className={styles.outcomeRow}>
        {record.murderBlocked && record.shieldedName ? (
          <div className={styles.shieldOutcome}>
            <span className={styles.outcomeIcon}>🛡️</span>
            <span className={styles.outcomeText}>
              Murder attempt blocked &mdash; <PlayerChip player={playerByName(record.shieldedName)} name={record.shieldedName} />
              {record.shieldedRole && (<> <RolePill role={record.shieldedRole} /></>)} used their shield
            </span>
          </div>
        ) : record.murderBlocked && record.medicProtection?.saved ? (
          null
        ) : record.murderedName ? (
          <div className={styles.murderOutcome}>
            <span className={styles.outcomeIcon}>🔪</span>
            <span className={styles.outcomeText}>
              <PlayerChip player={playerByName(record.murderedName)} name={record.murderedName} />
              {record.murderedRole && (<> <RolePill role={record.murderedRole} /></>)} was murdered in the night
            </span>
          </div>
        ) : (
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>🌙</span>
            <span>No murder this night</span>
          </div>
        )}
      </div>

      {record.recruitedName && (
        <div className={styles.outcomeRow}>
          <div className={styles.recruitedOutcome}>
            <span className={styles.outcomeIcon}>🤝</span>
            <span className={styles.outcomeText}>
              <PlayerChip player={playerByName(record.recruitedName)} name={record.recruitedName} /> was recruited and joined the Traitors
            </span>
          </div>
        </div>
      )}

      {record.sheriffInvestigations && record.sheriffInvestigations.length > 0 && (
        <div className={styles.outcomeRow}>
          <div className={styles.outcomeNeutral} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            {record.sheriffInvestigations.map((inv, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className={styles.outcomeIcon}>🔎</span>
                <span className={styles.outcomeText}>
                  <PlayerChip player={playerById(inv.sheriffId)} name={inv.sheriffName} />
                  {' investigated '}
                  <PlayerChip player={playerById(inv.targetId)} name={inv.targetName} />
                  {' and learned they are '}<RolePill role={inv.reportedRole} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* whisper feed for this round. */}
      {roundWhispers.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, background: 'rgba(108,74,182,0.08)' }}>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6, letterSpacing: 0.4 }}>WHISPERS</div>
          {roundWhispers.map((w) => (
            <div key={w.id} style={{ fontSize: 13, padding: '4px 0' }}>
              🤫 <PlayerChip player={playerById(w.senderId)} name={w.senderName} /> &rarr;{' '}
              <PlayerChip player={playerById(w.recipientId)} name={w.recipientName} />
              {w.content && <span style={{ opacity: 0.85, marginLeft: 6 }}>— "{w.content}"</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GameEnd({
  winner, endReason, players, myRole, history, whispers, falseEvidence,
  myPlayerId: _myPlayerId, playerStats, leaderboard, globalStats, onSend,
}: GameEndProps) {
  const hostEnded = endReason === 'HOST_ENDED' || !winner;
  const traitors = players.filter((p) => p.role === 'TRAITOR');
  const faithful = players.filter((p) => p.role === 'FAITHFUL');
  const { play } = useSoundContext();
  const soundPlayedRef = useRef(false);
  const [stage, setStage] = useState(0);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);

  // Drive cinematic stages on mount.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < STAGE_TIMINGS_MS.length; i++) {
      timers.push(setTimeout(() => setStage((s) => Math.max(s, i)), STAGE_TIMINGS_MS[i]));
    }
    return () => { timers.forEach(clearTimeout); };
  }, []);

  // Win sound at stage 1 (winner reveal).
  useEffect(() => {
    if (stage >= 1 && winner && !soundPlayedRef.current) {
      soundPlayedRef.current = true;
      play(winner === 'TRAITORS' ? 'traitorWin' : 'faithfulWin');
      vibrate('success');
    }
  }, [stage, winner, play]);

  // Once the cinematic ends (stage 4), fetch this player's stats so we can show them.
  useEffect(() => {
    if (stage >= 4 && onSend) {
      void getOrCreateDeviceToken();
      onSend({ type: 'C2S_GET_PLAYER_STATS', payload: {} });
    }
  }, [stage, onSend]);

  const skip = () => setStage(4);

  const isWinner =
    (winner === 'TRAITORS' && myRole === 'TRAITOR') ||
    (winner === 'FAITHFUL' && myRole === 'FAITHFUL');

  return (
    <div className={`${styles.container} ${winner === 'TRAITORS' ? styles.traitorWin : winner === 'FAITHFUL' ? styles.faithfulWin : ''}`}>
      {/* Cinematic skip control — visible until stage 4 */}
      {stage < 4 && (
        <button className={styles.skipBtn} onClick={skip} aria-label="Skip cinematic">
          Skip ▸
        </button>
      )}

      {/* Stage 0+ — title */}
      <h1 key="title" className={`${styles.title} ${styles.stageEnter}`}>Game Over</h1>

      {/* Stage 1+ — winner banner */}
      {stage >= 1 && (
        <div key="banner" className={`${styles.winnerBanner} ${styles.stageEnter}`}>
          <h2>
            {hostEnded
              ? 'Game Ended Early'
              : winner === 'TRAITORS' ? 'The Traitors Win!' : 'The Faithful Win!'}
          </h2>
          <p className={styles.winnerSubtitle}>
            {hostEnded
              ? 'The host called the game early. No winner was recorded.'
              : winner === 'TRAITORS'
              ? 'Deception prevails. The Traitors have outwitted the castle.'
              : 'Justice prevails. The Traitors have been exposed.'}
          </p>
        </div>
      )}

      {/* Stage 2+ — personal verdict (skipped when game was ended early) */}
      {stage >= 2 && !hostEnded && (
        <div key="verdict" className={`${isWinner ? styles.victoryMessage : styles.defeatMessage} ${styles.stageEnter}`}>
          <p>{isWinner ? '🏆 Congratulations — you survived the deception.' : '💀 Better luck next time…'}</p>
        </div>
      )}

      {/* Stage 3+ — role reveal */}
      {stage >= 3 && (
        <div key="roles" className={`${styles.rolesReveal} ${styles.stageEnter}`}>
          <div className={styles.teamSection}>
            <h3 className={styles.traitorHeader}>Traitors</h3>
            <div className={styles.playerList}>
              {traitors.map((p) => (
                <div key={p.id} className={`${styles.playerCard} ${styles.traitorCard}`}>
                  <div className={styles.avatar} style={{ background: getColorHex(p.color), color: '#000' }}>{getAvatarEmoji(p.avatar)}</div>
                  <span>{p.name}</span>
                  {!p.isAlive && <span className={styles.eliminated}>Eliminated</span>}
                </div>
              ))}
            </div>
          </div>

          <div className={styles.teamSection}>
            <h3 className={styles.faithfulHeader}>Faithful</h3>
            <div className={styles.playerList}>
              {faithful.map((p) => (
                <div key={p.id} className={`${styles.playerCard} ${styles.faithfulCard}`}>
                  <div className={styles.avatar} style={{ background: getColorHex(p.color), color: '#000' }}>{getAvatarEmoji(p.avatar)}</div>
                  <span>{p.name}</span>
                  {!p.isAlive && <span className={styles.eliminated}>Eliminated</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stage 4+ — stats summary + timeline + actions */}
      {stage >= 4 && (
        <>
          {playerStats && playerStats.gamesPlayed > 0 && (
            <div className={`${styles.statsPanel} ${styles.stageEnter}`}>
              <h3 className={styles.timelineTitle}>Your Lifetime Stats</h3>
              <div className={styles.statsRow}>
                <Stat label="Games" value={playerStats.gamesPlayed} />
                <Stat label="Win Rate" value={`${(playerStats.winRate * 100).toFixed(0)}%`} />
                <Stat label="Traitor W-L" value={`${playerStats.winsAsTraitor}–${playerStats.lossesAsTraitor}`} />
                <Stat label="Faithful W-L" value={`${playerStats.winsAsFaithful}–${playerStats.lossesAsFaithful}`} />
                <Stat label="Survived" value={playerStats.totalSurvived} />
              </div>
            </div>
          )}

          {falseEvidence && (
            <div className={`${styles.timeline} ${styles.stageEnter}`} style={{ marginTop: 16 }}>
              <h3 className={styles.timelineTitle}>📜 False Evidence Revealed</h3>
              <div style={{ padding: 12, border: '1px solid rgba(212,165,255,0.4)', borderRadius: 10, background: 'rgba(108,74,182,0.12)' }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>
                  Round {falseEvidence.activatedAtRound ?? falseEvidence.plantedAtRound} —{' '}
                  <strong>
                    {falseEvidence.type === 'FRAME' && 'Frame (Sheriff misled)'}
                    {falseEvidence.type === 'WHISPER_FABRICATION' && 'Fabricated Whisper'}
                    {falseEvidence.type === 'ANONYMOUS_TIP' && 'Anonymous Tip'}
                  </strong>
                </div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>
                  Framed: <strong>{falseEvidence.targetName}</strong>
                </div>
                {falseEvidence.content && (
                  <div style={{ fontSize: 13, marginTop: 6, fontStyle: 'italic', opacity: 0.85 }}>
                    "{falseEvidence.content}"
                  </div>
                )}
              </div>
            </div>
          )}

          {history && history.length > 0 && (
            <SuspicionStatsCard history={history} players={players} />
          )}

          {history && history.length > 0 && (
            <div className={`${styles.timeline} ${styles.stageEnter}`}>
              <h3 className={styles.timelineTitle}>How It Happened</h3>
              <div className={styles.timelineList}>
                {history.map((record, i) => (
                  <RoundCard key={record.round} record={record} index={i} whispers={whispers} players={players} />
                ))}
              </div>
            </div>
          )}

          <div className={`${styles.actionRow} ${styles.stageEnter}`}>
            {onSend && (
              <button className={styles.statsBtn} onClick={() => setShowProfileDrawer(true)}>
                View Profile & Hall of Fame
              </button>
            )}
            <button className={styles.playAgainBtn} onClick={() => window.location.reload()}>
              Play Again
            </button>
          </div>
        </>
      )}

      {showProfileDrawer && onSend && (
        <ProfileDrawer
          onClose={() => setShowProfileDrawer(false)}
          onSend={onSend}
          initialStats={playerStats ?? null}
          initialLeaderboard={leaderboard ?? null}
          initialGlobal={globalStats ?? null}
        />
      )}
    </div>
  );
}

function SuspicionStatsCard({ history, players }: { history: RoundRecord[]; players: Player[] }) {
  const allTokens = history.flatMap((r) => r.suspicionTokens ?? []);
  if (allTokens.length === 0) return null;

  const playerById = (id: string | undefined): Player | undefined =>
    id ? players.find((p) => p.id === id) : undefined;
  const isTraitor = (id: string): boolean => playerById(id)?.role === 'TRAITOR';

  const incoming = new Map<string, number>();
  const outgoingByPlacer = new Map<string, { total: number; auto: number; correct: number; manual: number }>();

  for (const t of allTokens) {
    incoming.set(t.targetId, (incoming.get(t.targetId) ?? 0) + 1);
    const cur = outgoingByPlacer.get(t.placerId) ?? { total: 0, auto: 0, correct: 0, manual: 0 };
    cur.total += 1;
    if (t.isAuto) cur.auto += 1;
    else {
      cur.manual += 1;
      if (isTraitor(t.targetId)) cur.correct += 1;
    }
    outgoingByPlacer.set(t.placerId, cur);
  }

  let mostSuspected: { id: string; n: number } | null = null;
  for (const [id, n] of incoming) {
    if (!mostSuspected || n > mostSuspected.n) mostSuspected = { id, n };
  }

  let bestAccuser: { id: string; pct: number; correct: number; manual: number } | null = null;
  for (const [id, s] of outgoingByPlacer) {
    if (s.manual === 0) continue;
    const pct = s.correct / s.manual;
    if (!bestAccuser || pct > bestAccuser.pct || (pct === bestAccuser.pct && s.correct > bestAccuser.correct)) {
      bestAccuser = { id, pct, correct: s.correct, manual: s.manual };
    }
  }

  const perPlacerRows = [...outgoingByPlacer.entries()]
    .map(([id, s]) => ({ id, ...s, autoPct: s.total === 0 ? 0 : s.auto / s.total }))
    .sort((a, b) => b.total - a.total);

  return (
    <div
      className={styles.stageEnter}
      style={{
        margin: '16px auto', padding: '14px 16px', maxWidth: 720,
        border: '1px solid rgba(180,120,255,0.4)', borderRadius: 10,
        background: 'rgba(36,20,64,0.35)',
      }}
    >
      <h3 style={{ margin: '0 0 10px', color: '#d9b6ff', fontSize: 16, letterSpacing: 0.4 }}>
        🎯 Suspicion Stats
      </h3>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10,
      }}>
        {mostSuspected && (
          <div style={{ padding: 10, background: 'rgba(0,0,0,0.25)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#b3a3c9', letterSpacing: 0.4, marginBottom: 4 }}>
              MOST SUSPECTED
            </div>
            <PlayerChip player={playerById(mostSuspected.id)} />
            <div style={{ fontSize: 12, color: '#f0e6ff', marginTop: 4 }}>
              {mostSuspected.n} token{mostSuspected.n === 1 ? '' : 's'} received
            </div>
          </div>
        )}

        {bestAccuser && (
          <div style={{ padding: 10, background: 'rgba(0,0,0,0.25)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#b3a3c9', letterSpacing: 0.4, marginBottom: 4 }}>
              SHARPEST EYE
            </div>
            <PlayerChip player={playerById(bestAccuser.id)} />
            <div style={{ fontSize: 12, color: '#f0e6ff', marginTop: 4 }}>
              {bestAccuser.correct}/{bestAccuser.manual} pointed at a Traitor
              {' '}({Math.round(bestAccuser.pct * 100)}%)
            </div>
          </div>
        )}
      </div>

      {perPlacerRows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#b3a3c9', letterSpacing: 0.4, marginBottom: 6 }}>
            PLACED VS AUTO-ASSIGNED
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
            {perPlacerRows.map((r) => (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span style={{ minWidth: 140 }}>
                  <PlayerChip player={playerById(r.id)} />
                </span>
                <span style={{ color: '#f0e6ff' }}>
                  {r.manual} placed
                </span>
                <span style={{ color: '#ffb84d', opacity: r.auto > 0 ? 1 : 0.4 }}>
                  · {r.auto} auto ({Math.round(r.autoPct * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.statBlock}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}
