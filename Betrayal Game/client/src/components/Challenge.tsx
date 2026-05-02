import { useState, useEffect, useRef } from 'react';
import type { Player, C2SEvent, ChallengeState, TimerState } from '../types';
import styles from './Challenge.module.css';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';
import { Timer } from './Timer';

interface ChallengeProps {
  challenge?: ChallengeState;
  players: Player[];
  myPlayerId?: string;
  phase: string;
  timer?: TimerState;
  onSend: (event: C2SEvent) => void;
}

export function Challenge({
  challenge,
  players,
  myPlayerId,
  phase,
  timer,
  onSend,
}: ChallengeProps) {
  const [hasAnswered, setHasAnswered] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showingPlayers, setShowingPlayers] = useState(true);
  const [tapTime, setTapTime] = useState<number | null>(null);
  const { play } = useSoundContext();
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    setHasAnswered(false);
    setInputValue('');
    setShowingPlayers(true);
    setTapTime(null);
    soundPlayedRef.current = false;
  }, [challenge?.type, challenge?.startTime]);

  useEffect(() => {
    if (challenge && !soundPlayedRef.current && phase === 'CHALLENGE') {
      soundPlayedRef.current = true;
      play('roleReveal');
    }
  }, [challenge, phase, play]);

  useEffect(() => {
    if (challenge?.type === 'MISSING_PLAYER' && challenge.hiddenPlayerId) {
      setShowingPlayers(false);
    }
  }, [challenge?.hiddenPlayerId, challenge?.type]);

  useEffect(() => {
    if (challenge?.type === 'MISSING_PLAYER' && showingPlayers && challenge.startTime) {
      const elapsed = Date.now() - challenge.startTime;
      const delay = Math.max(0, 3000 - elapsed);
      const t = setTimeout(() => setShowingPlayers(false), delay);
      return () => clearTimeout(t);
    }
  }, [challenge?.type, challenge?.startTime, showingPlayers]);

  const handleTimeEstimateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasAnswered || !challenge) return;
    const guess = parseFloat(inputValue);
    if (!Number.isFinite(guess)) return;
    setTapTime(guess);
    setHasAnswered(true);
    vibrate('medium');
    // Send the numeric guess; the server scores closest-to-targetTime with
    // earliest server-side submission as the tie-breaker.
    onSend({ type: 'C2S_SUBMIT_CHALLENGE_ANSWER', payload: { answer: guess } });
  };

  const handleWordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasAnswered || !inputValue.trim() || !challenge) return;
    setHasAnswered(true);
    vibrate('medium');
    onSend({ type: 'C2S_SUBMIT_CHALLENGE_ANSWER', payload: { answer: inputValue.trim() } });
  };

  const handleMissingPlayerSubmit = (playerName: string) => {
    if (hasAnswered || !challenge) return;
    setHasAnswered(true);
    vibrate('medium');
    onSend({ type: 'C2S_SUBMIT_CHALLENGE_ANSWER', payload: { answer: playerName } });
  };

  const handleContinue = () => {
    onSend({ type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} });
  };

  const me = players.find((p) => p.id === myPlayerId);
  const isAlive = me?.isAlive ?? true;
  const isHost = !!me?.isHost;

  if (!challenge) {
    return <div className={styles.container}>Loading challenge...</div>;
  }

  const answeredCount = challenge.answeredCount ?? 0;
  const eligibleCount = challenge.eligibleCount ?? players.filter((p) => p.isAlive).length;
  const showTimer = phase === 'CHALLENGE' && timer && timer.phase === 'CHALLENGE';

  const timerBar = showTimer ? (
    <div className={styles.timerBar}>
      <Timer endTime={timer!.endTime} />
    </div>
  ) : null;

  const answerCountBadge = phase === 'CHALLENGE' ? (
    <div className={styles.answerCount}>
      {answeredCount}/{eligibleCount} answered
    </div>
  ) : null;

  // CHALLENGE_RESULT phase
  if (phase === 'CHALLENGE_RESULT' || challenge.completed) {
    return (
      <div className={styles.container}>
        <h2 className={styles.title}>Challenge Complete!</h2>

        {challenge.winnerName ? (
          <div className={styles.resultSection}>
            <div className={styles.winnerBadge}>
              <span className={styles.shieldIcon}>🛡️</span>
              <span className={styles.winnerName}>{challenge.winnerName}</span>
            </div>
            <p className={styles.resultText}>
              {challenge.shieldAwarded === undefined
                ? 'won the challenge!'
                : challenge.shieldAwarded
                ? 'earned a Shield!'
                : 'won but already has a Shield!'}
            </p>
          </div>
        ) : (
          <div className={styles.resultSection}>
            <p className={styles.noWinnerText}>No winner this round!</p>
          </div>
        )}

        {challenge.correctAnswer !== undefined && challenge.correctAnswer !== null && (
          <p className={styles.correctAnswer}>
            Correct answer: <strong>{challenge.correctAnswer}</strong>
            {challenge.type === 'TIME_ESTIMATE' && 's'}
          </p>
        )}

        {isHost ? (
          <button className={styles.continueBtn} onClick={handleContinue}>
            Continue to Roundtable
          </button>
        ) : (
          <p className={styles.waitingText}>Waiting for host to continue...</p>
        )}
      </div>
    );
  }

  // TIME_ESTIMATE — players type a numeric guess (seconds). The server
  // hides targetTime from the payload until the result phase, so each
  // player guesses blind. Closest-to-target wins, ties broken by earliest
  // server-side submission.
  if (challenge.type === 'TIME_ESTIMATE') {
    return (
      <div className={styles.container}>
        {timerBar}
        <h2 className={styles.title}>Number Estimate</h2>
        <p className={styles.instructions}>
          Type your best guess for the secret number. Closest wins!
        </p>
        {answerCountBadge}

        {!hasAnswered && isAlive ? (
          <form onSubmit={handleTimeEstimateSubmit} className={styles.inputForm}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Your guess..."
              className={styles.textInput}
              autoFocus
              autoComplete="off"
            />
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!Number.isFinite(parseFloat(inputValue))}
            >
              Submit
            </button>
          </form>
        ) : (
          <div className={styles.waitingSection}>
            {tapTime !== null && (
              <p className={styles.tapResult}>
                Your guess: {tapTime}
              </p>
            )}
            <p className={styles.waitingText}>Waiting for others...</p>
          </div>
        )}
      </div>
    );
  }

  // WORD_SCRAMBLE
  if (challenge.type === 'WORD_SCRAMBLE') {
    return (
      <div className={styles.container}>
        {timerBar}
        <h2 className={styles.title}>Word Scramble</h2>
        <p className={styles.instructions}>Unscramble this word:</p>

        <div className={styles.scrambledWord}>
          {challenge.scrambledWord?.toUpperCase()}
        </div>
        {answerCountBadge}

        {!hasAnswered && isAlive ? (
          <form onSubmit={handleWordSubmit} className={styles.inputForm}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Your answer..."
              className={styles.textInput}
              autoFocus
              autoComplete="off"
            />
            <button type="submit" className={styles.submitBtn}>Submit</button>
          </form>
        ) : (
          <div className={styles.waitingSection}>
            {hasAnswered && <p className={styles.submitted}>Answer submitted!</p>}
            <p className={styles.waitingText}>Waiting for result...</p>
          </div>
        )}
      </div>
    );
  }

  // MISSING_PLAYER
  if (challenge.type === 'MISSING_PLAYER') {
    const shownPlayers = (challenge.shownPlayerIds || [])
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is Player => p !== undefined);

    return (
      <div className={styles.container}>
        {timerBar}
        <h2 className={styles.title}>Missing Player</h2>

        {showingPlayers ? (
          <>
            <p className={styles.instructions}>Memorize these players!</p>
            <div className={styles.playerGrid}>
              {shownPlayers.map((p) => (
                <div key={p.id} className={styles.playerCard}>
                  <div className={styles.avatar}>{p.name[0]?.toUpperCase()}</div>
                  <span className={styles.playerName}>{p.name}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className={styles.instructions}>Who is missing?</p>
            {answerCountBadge}

            {!hasAnswered && isAlive ? (
              <div className={styles.playerGrid}>
                {/*
                  Show a button for EVERY player who was originally on screen,
                  including the one the server is now hiding. Without the
                  hidden player in the list there is no correct button to
                  press, which made the challenge unwinnable.
                */}
                {shownPlayers.map((p) => (
                  <button
                    key={p.id}
                    className={styles.playerButton}
                    onClick={() => handleMissingPlayerSubmit(p.name)}
                    disabled={hasAnswered}
                  >
                    <div className={styles.avatar}>{p.name[0]?.toUpperCase()}</div>
                    <span className={styles.playerName}>{p.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.waitingSection}>
                {hasAnswered && <p className={styles.submitted}>Answer submitted!</p>}
                <p className={styles.waitingText}>Waiting for result...</p>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return null;
}
