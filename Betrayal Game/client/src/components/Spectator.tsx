import type { Player, Vote, VoteTally, Role } from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import styles from './Spectator.module.css';

interface SpectatorProps {
  players: Player[];
  myPlayerId?: string;
  phase: string;
  currentRound?: number;
  banishedPlayer?: { id: string; name: string; role: Role };
  murderedPlayer?: { id: string; name: string };
  murderBlocked?: { shieldedPlayerId: string; shieldedPlayerName: string };
  voteCount?: { received: number; needed: number };
  revealedVotes?: Vote[];
  currentTally?: VoteTally[];
  totalVotes?: number;
  currentReveal?: {
    vote: Vote;
    voterName: string;
    targetName: string;
  };
  tiedPlayerNames?: string[];
  randomlySelectedPlayer?: { id: string; name: string; role: Role };
}

const PHASE_LABELS: Partial<Record<string, string>> = {
  ROUNDTABLE: 'Roundtable Discussion',
  VOTING: 'Voting in Progress',
  VOTE_REVEAL: 'Votes Being Revealed',
  TIE_DETECTED: 'It\'s a Tie!',
  REVOTE: 'Revote in Progress',
  TIEBREAKER_REVEAL: 'Tiebreaker',
  BANISH_REVEAL: 'Player Banished',
  CHECK_WIN: 'Checking Results...',
  NIGHT: 'Night Falls',
  MORNING: 'Morning Arrives',
  CHALLENGE: 'Shield Challenge',
  CHALLENGE_RESULT: 'Challenge Result',
};

export function Spectator({
  players,
  myPlayerId,
  phase,
  currentRound,
  banishedPlayer,
  murderedPlayer,
  murderBlocked,
  voteCount,
  revealedVotes,
  currentTally,
  totalVotes,
  currentReveal,
  tiedPlayerNames,
  randomlySelectedPlayer,
}: SpectatorProps) {
  const alivePlayers = players.filter((p) => p.isAlive);
  const deadPlayers = players.filter((p) => !p.isAlive);
  const isNight = phase === 'NIGHT';
  const isMorning = phase === 'MORNING';

  const revealCount = revealedVotes?.length ?? 0;
  const total = totalVotes ?? 0;

  return (
    <div className={`${styles.container} ${isNight ? styles.nightMode : ''}`}>
      <div className={styles.ghostBanner}>
        <span className={styles.ghostIcon}>👻</span>
        <div>
          <div className={styles.ghostTitle}>You are a Ghost</div>
          <div className={styles.ghostSub}>Watch the game unfold from beyond...</div>
        </div>
      </div>

      <div className={`${styles.phaseCard} ${isNight ? styles.nightCard : ''}`}>
        {currentRound && (
          <div className={styles.roundLabel}>Round {currentRound}</div>
        )}
        <div className={styles.phaseLabel}>
          {isNight ? '🌙' : isMorning ? '🌅' : '⚖️'}{' '}
          {PHASE_LABELS[phase] ?? phase}
        </div>

        {isNight && (
          <p className={styles.nightFlavour}>
            The Traitors are meeting in secret...
          </p>
        )}

        {isMorning && murderedPlayer && (
          <div className={styles.morningReveal}>
            <div className={styles.morningIcon}>💀</div>
            <div className={styles.morningText}>
              <strong>{murderedPlayer.name}</strong> was murdered in the night.
            </div>
          </div>
        )}
        {isMorning && murderBlocked && (
          <div className={styles.morningReveal}>
            <div className={styles.morningIcon}>🛡️</div>
            <div className={styles.morningText}>
              The murder was blocked! <strong>{murderBlocked.shieldedPlayerName}</strong>'s shield protected them.
            </div>
          </div>
        )}
        {isMorning && !murderedPlayer && !murderBlocked && (
          <p className={styles.nightFlavour}>Nobody was harmed last night.</p>
        )}

        {phase === 'VOTING' && voteCount && (
          <div className={styles.voteProgress}>
            <div className={styles.voteProgressLabel}>
              {voteCount.received} / {voteCount.needed} votes cast
            </div>
            <div className={styles.voteProgressBar}>
              <div
                className={styles.voteProgressFill}
                style={{ width: `${(voteCount.received / voteCount.needed) * 100}%` }}
              />
            </div>
          </div>
        )}

        {phase === 'VOTE_REVEAL' && (
          <div className={styles.revealSection}>
            <div className={styles.revealCount}>{revealCount} / {total} votes revealed</div>
            {currentReveal && (
              <div className={styles.currentReveal}>
                <span className={styles.voterName}>{currentReveal.voterName}</span>
                <span className={styles.arrow}> → </span>
                <span className={styles.targetName}>{currentReveal.targetName}</span>
              </div>
            )}
            {currentTally && currentTally.length > 0 && (
              <div className={styles.tally}>
                {currentTally
                  .slice()
                  .sort((a, b) => b.voteCount - a.voteCount)
                  .map((t) => {
                    const p = players.find((pl) => pl.id === t.playerId);
                    return (
                      <div key={t.playerId} className={styles.tallyRow}>
                        <span className={styles.tallyAvatar} style={{ background: getColorHex(p?.color) }}>{getAvatarEmoji(p?.avatar)}</span>
                        <span className={styles.tallyName}>{t.playerName}</span>
                        <span className={styles.tallyCount}>{t.voteCount}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {phase === 'TIE_DETECTED' && tiedPlayerNames && (
          <div className={styles.tieInfo}>
            Tied: {tiedPlayerNames.join(' & ')}
          </div>
        )}

        {(phase === 'BANISH_REVEAL' || phase === 'TIEBREAKER_REVEAL') && (banishedPlayer ?? randomlySelectedPlayer) && (
          <div className={styles.banishReveal}>
            <div className={styles.banishIcon}>🔨</div>
            <div className={styles.banishName}>{(banishedPlayer ?? randomlySelectedPlayer)!.name}</div>
            <div className={`${styles.banishRole} ${(banishedPlayer ?? randomlySelectedPlayer)!.role === 'TRAITOR' ? styles.traitorRole : styles.faithfulRole}`}>
              {(banishedPlayer ?? randomlySelectedPlayer)!.role}
            </div>
          </div>
        )}
      </div>

      <div className={styles.playerSection}>
        <div className={styles.sectionTitle}>
          Alive <span className={styles.count}>({alivePlayers.length})</span>
        </div>
        <div className={styles.playerGrid}>
          {alivePlayers.map((p) => {
            const colorHex = getColorHex(p.color);
            const avatarEmoji = getAvatarEmoji(p.avatar);
            return (
              <div key={p.id} className={styles.playerChip} style={{ borderColor: colorHex }}>
                <span className={styles.playerAvatar} style={{ background: colorHex, color: '#000' }}>
                  {avatarEmoji}
                </span>
                <span className={styles.playerName}>
                  {p.name}
                  {p.id === myPlayerId && ' (you)'}
                </span>
                {p.hasShield && <span className={styles.shield}>🛡️</span>}
                {!p.isConnected && <span className={styles.away}>AWAY</span>}
              </div>
            );
          })}
        </div>

        {deadPlayers.length > 0 && (
          <>
            <div className={`${styles.sectionTitle} ${styles.deadTitle}`}>
              Eliminated <span className={styles.count}>({deadPlayers.length})</span>
            </div>
            <div className={styles.playerGrid}>
              {deadPlayers.map((p) => {
                const colorHex = getColorHex(p.color);
                const avatarEmoji = getAvatarEmoji(p.avatar);
                return (
                  <div key={p.id} className={`${styles.playerChip} ${styles.deadChip}`}>
                    <span className={`${styles.playerAvatar} ${styles.deadAvatar}`} style={{ background: colorHex, color: '#000', opacity: 0.5 }}>
                      {avatarEmoji}
                    </span>
                    <span className={`${styles.playerName} ${styles.deadName}`}>
                      {p.name}
                      {p.id === myPlayerId && ' (you)'}
                    </span>
                    {p.role && (
                      <span className={`${styles.roleTag} ${p.role === 'TRAITOR' ? styles.traitorTag : styles.faithfulTag}`}>
                        {p.role === 'TRAITOR' ? '🗡️' : '🤝'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
