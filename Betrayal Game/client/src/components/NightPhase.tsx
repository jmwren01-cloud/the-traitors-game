import { useState, useEffect, useRef } from 'react';
import type { Player, C2SEvent, Role } from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import styles from './NightPhase.module.css';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';

interface NightPhaseProps {
  players: Player[];
  myPlayerId?: string;
  myRole?: Role;
  phase: string;
  currentRound?: number;
  aliveTraitorCount?: number;
  murderVoteProgress?: { received: number; needed: number };
  murderedPlayer?: { id: string; name: string };
  murderBlocked?: { shieldedPlayerId: string; shieldedPlayerName: string };
  traitorIds?: string[];
  myPlayerRecruitmentUsed?: boolean;
  justRecruited?: boolean;
  recruitedPlayer?: { id: string; name: string };
  onSend: (event: C2SEvent) => void;
}

export function NightPhase({
  players,
  myPlayerId,
  myRole,
  phase,
  currentRound,
  aliveTraitorCount,
  murderVoteProgress,
  murderedPlayer,
  murderBlocked,
  traitorIds,
  myPlayerRecruitmentUsed,
  justRecruited,
  recruitedPlayer,
  onSend,
}: NightPhaseProps) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedRecruitTarget, setSelectedRecruitTarget] = useState<string | null>(null);
  const [hasSubmittedRecruitment, setHasSubmittedRecruitment] = useState(false);
  const { play } = useSoundContext();
  const nightSoundPlayedRef = useRef(false);
  const morningSoundPlayedRef = useRef(false);
  const prevPhaseRef = useRef(phase);

  useEffect(() => {
    if (phase !== prevPhaseRef.current) {
      if (phase === 'NIGHT') {
        nightSoundPlayedRef.current = false;
      } else if (phase === 'MORNING') {
        morningSoundPlayedRef.current = false;
      }
      prevPhaseRef.current = phase;
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'NIGHT' && !nightSoundPlayedRef.current) {
      nightSoundPlayedRef.current = true;
      play('nightStart');
    }
  }, [phase, play]);

  useEffect(() => {
    if (phase === 'MORNING' && !morningSoundPlayedRef.current) {
      morningSoundPlayedRef.current = true;
      play('morningStart');
      if (murderedPlayer) {
        setTimeout(() => play('murder'), 500);
      }
    }
  }, [phase, murderedPlayer, play]);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const isTraitor = myRole === 'TRAITOR';
  const aliveFaithful = players.filter((p) => {
    if (!p.isAlive || p.id === myPlayerId) return false;
    if (traitorIds && traitorIds.length > 0) {
      return !traitorIds.includes(p.id);
    }
    return p.role !== 'TRAITOR';
  });
  const fellowTraitors = traitorIds 
    ? players.filter((p) => traitorIds.includes(p.id) && p.id !== myPlayerId && p.isAlive)
    : [];

  // Recruitment targets exclude the player's own murder vote target to avoid contradictory selection
  const recruitablePlayers = aliveFaithful.filter((p) => p.id !== selectedTarget);

  const handleSubmitMurder = () => {
    if (selectedTarget) {
      vibrate('heavy');
      // If the current recruit target is the same as the murder target, clear it
      if (selectedRecruitTarget === selectedTarget) setSelectedRecruitTarget(null);
      onSend({ type: 'C2S_SUBMIT_MURDER', payload: { targetId: selectedTarget } });
      setHasVoted(true);
    }
  };

  const handleSubmitRecruitment = () => {
    if (selectedRecruitTarget) {
      vibrate('medium');
      onSend({ type: 'C2S_SUBMIT_RECRUITMENT', payload: { targetId: selectedRecruitTarget } });
      setHasSubmittedRecruitment(true);
    }
  };

  if (phase === 'NIGHT') {
    if (isTraitor) {
      return (
        <div className={styles.container}>
          <div className={styles.nightOverlay}>
            <h1 className={styles.title}>Night Falls</h1>
            <p className={styles.subtitle}>Round {currentRound}</p>
            
            {fellowTraitors.length > 0 && (
              <div className={styles.fellowTraitorsSection}>
                <h3 className={styles.fellowTraitorsTitle}>Your Fellow Traitors</h3>
                <div className={styles.fellowTraitorsList}>
                  {fellowTraitors.map((traitor) => {
                    const colorHex = getColorHex(traitor.color);
                    const avatarEmoji = getAvatarEmoji(traitor.avatar);
                    return (
                      <div key={traitor.id} className={styles.traitorBadge} style={{ borderColor: colorHex }}>
                        <div className={styles.traitorAvatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                        <span className={styles.traitorName}>{traitor.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {aliveTraitorCount === 1 && (
              <p className={styles.loneTraitorInfo}>You are the only traitor remaining</p>
            )}

            <h2 className={styles.sectionTitle}>Choose Your Victim</h2>

            <div className={styles.targetGrid}>
              {aliveFaithful.map((player) => {
                const colorHex = getColorHex(player.color);
                const avatarEmoji = getAvatarEmoji(player.avatar);
                return (
                  <div
                    key={player.id}
                    className={`${styles.targetCard} ${selectedTarget === player.id ? styles.selected : ''} ${player.shieldRevealed ? styles.hasShield : ''}`}
                    style={{ borderColor: selectedTarget === player.id ? colorHex : undefined }}
                    onClick={() => !hasVoted && setSelectedTarget(player.id)}
                  >
                    <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>
                      {avatarEmoji}
                      {player.shieldRevealed && <span className={styles.shieldBadge}>🛡️</span>}
                    </div>
                    <span className={styles.name}>{player.name}</span>
                  </div>
                );
              })}
            </div>

            {murderVoteProgress && (
              <div className={styles.voteProgress}>
                <p>
                  Murder votes: {murderVoteProgress.received} / {murderVoteProgress.needed}
                </p>
              </div>
            )}

            {!hasVoted && (
              <button className={styles.murderBtn} onClick={handleSubmitMurder} disabled={!selectedTarget}>
                Vote to Murder
              </button>
            )}

            {hasVoted && <p className={styles.waiting}>Waiting for other traitors... Murder will auto-resolve when all votes are in.</p>}

            {!myPlayerRecruitmentUsed && (
              <div className={styles.recruitSection}>
                <h2 className={styles.sectionTitle}>🤝 Recruit a Faithful</h2>
                <p className={styles.recruitSubtitle}>One-time ability — Convert a Faithful player to your side</p>

                {hasSubmittedRecruitment ? (
                  <p className={styles.waiting}>Recruitment submitted. They will join you after this night...</p>
                ) : (
                  <>
                    <div className={styles.targetGrid}>
                      {recruitablePlayers.map((player) => {
                        const colorHex = getColorHex(player.color);
                        const avatarEmoji = getAvatarEmoji(player.avatar);
                        return (
                          <div
                            key={player.id}
                            className={`${styles.targetCard} ${styles.recruitTarget} ${selectedRecruitTarget === player.id ? styles.recruitSelected : ''}`}
                            style={{ borderColor: selectedRecruitTarget === player.id ? colorHex : undefined }}
                            onClick={() => setSelectedRecruitTarget(player.id)}
                          >
                            <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>
                              {avatarEmoji}
                            </div>
                            <span className={styles.name}>{player.name}</span>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      className={styles.recruitBtn}
                      onClick={handleSubmitRecruitment}
                      disabled={!selectedRecruitTarget}
                    >
                      Recruit Player
                    </button>
                  </>
                )}
              </div>
            )}

            {myPlayerRecruitmentUsed && (
              <div className={styles.recruitUsed}>
                <span>🤝 Recruitment ability already used</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.container}>
        <div className={styles.nightOverlay}>
          <h1 className={styles.title}>Night Falls</h1>
          <p className={styles.subtitle}>Round {currentRound}</p>

          <div className={styles.sleepingIcon}>
            <span>💤</span>
          </div>

          <p className={styles.faithfulMessage}>
            Close your eyes and wait...<br />
            The traitors are choosing their victim.
          </p>

          <p className={styles.waiting}>Waiting for traitors to decide...</p>
        </div>
      </div>
    );
  }

  if (phase === 'MORNING') {
    if (justRecruited) {
      return (
        <div className={styles.container}>
          <div className={`${styles.morningOverlay} ${styles.recruitedOverlay}`}>
            <div className={styles.recruitedBanner}>
              <div className={styles.recruitedIcon}>🔴</div>
              <h1 className={styles.recruitedTitle}>You Have Been Recruited!</h1>
              <p className={styles.recruitedMessage}>
                A Traitor approached you in the night...<br />
                You are now one of the <strong>Traitors</strong>.<br />
                Help eliminate the Faithful without being discovered.
              </p>
              <p className={styles.recruitedHint}>Your role has changed. Work with your fellow Traitors!</p>
            </div>
            {!isHost && <p className={styles.waiting}>Waiting for host to continue...</p>}
          </div>
        </div>
      );
    }

    const murderedPlayerObj = murderedPlayer ? players.find((p) => p.id === murderedPlayer.id) : undefined;
    return (
      <div className={styles.container}>
        <div className={styles.morningOverlay}>
          <h1 className={styles.title}>Morning</h1>

          {murderedPlayer ? (
            <div className={styles.deathReveal}>
              <div
                className={styles.bigAvatar}
                style={{ background: getColorHex(murderedPlayerObj?.color), color: '#000' }}
              >
                {getAvatarEmoji(murderedPlayerObj?.avatar)}
              </div>
              <h2>{murderedPlayer.name}</h2>
              <p className={styles.deathMessage}>was found dead this morning...</p>
            </div>
          ) : murderBlocked ? (
            <div className={styles.shieldBlockReveal}>
              <div className={styles.shieldIcon}>🛡️</div>
              <h2>{murderBlocked.shieldedPlayerName}</h2>
              <p className={styles.shieldMessage}>was protected by their Shield!</p>
              <p className={styles.noDeathText}>No one was murdered last night.</p>
            </div>
          ) : (
            <div className={styles.noDeathMessage}>
              <p>No one was murdered last night.</p>
            </div>
          )}

          {recruitedPlayer && (
            <div className={styles.recruitReveal}>
              <div className={styles.recruitRevealIcon}>🤝</div>
              {isTraitor ? (
                <>
                  <h3 className={styles.recruitRevealTitle}>{recruitedPlayer.name} has joined your ranks!</h3>
                  <p className={styles.recruitRevealMessage}>They are now a Traitor.</p>
                </>
              ) : (
                <>
                  <h3 className={styles.recruitRevealTitle}>A player was recruited...</h3>
                  <p className={styles.recruitRevealMessage}>
                    <strong>{recruitedPlayer.name}</strong> has joined the Traitors.
                  </p>
                </>
              )}
            </div>
          )}

          {!isHost && <p className={styles.waiting}>Waiting for host to continue...</p>}
        </div>
      </div>
    );
  }

  return null;
}
