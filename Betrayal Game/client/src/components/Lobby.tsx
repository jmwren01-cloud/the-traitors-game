import { useState, useEffect, useRef, useCallback } from 'react';
import type { Player, C2SEvent, GameSettings } from '../types';
import { PLAYER_COLORS, PLAYER_AVATARS, getColorHex, getAvatarEmoji } from '../avatarConstants';
import { getOrCreateDeviceToken, getSavedPlayerName, savePlayerName, isValidPlayerName } from '../utils/identity';
import type { IdentityState } from '../hooks/useWebSocket';
import { ProfileDrawer } from './ProfileDrawer';
import { HowToPlayModal } from './HowToPlayModal';
import styles from './Lobby.module.css';

const RULES_SEEN_KEY = 'betrayal_rules_seen';

function hasSeenRules(): boolean {
  try {
    return localStorage.getItem(RULES_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markRulesSeen(): void {
  try {
    localStorage.setItem(RULES_SEEN_KEY, '1');
  } catch {
    // localStorage unavailable — nothing to do.
  }
}

interface LobbyProps {
  sessionId?: string;
  players: Player[];
  myPlayerId?: string;
  settings?: GameSettings;
  onSend: (event: C2SEvent) => void;

  identity: IdentityState | null;
  identifyError: string | null;
  identify: (deviceToken: string, playerName: string) => void;
}

export function Lobby({
  sessionId, players, myPlayerId, settings, onSend,
  identity, identifyError, identify,
}: LobbyProps) {
  const [playerName, setPlayerName] = useState(() => getSavedPlayerName() ?? '');
  const [joinSessionId, setJoinSessionId] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [showSettings, setShowSettings] = useState(false);

  const [pendingAction, setPendingAction] = useState<null | { type: 'create' } | { type: 'join'; sessionId: string }>(null);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [rulesSeen, setRulesSeen] = useState<boolean>(() => hasSeenRules());

  const openRules = () => {
    setShowRules(true);
    if (!rulesSeen) {
      markRulesSeen();
      setRulesSeen(true);
    }
  };
  const [copied, setCopied] = useState(false);
  const lastIdentifiedActionRef = useRef<string | null>(null);
  const copiedTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopySession = useCallback(async () => {
    if (!sessionId) return;
    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sessionId);
        success = true;
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = sessionId;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, sessionId.length);
        success = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch {
        success = false;
      }
    }
    if (success) {
      setCopied(true);
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimeoutRef.current = null;
      }, 2000);
    }
  }, [sessionId]);

  // When identity is confirmed, fire the pending create/join action.
  useEffect(() => {
    if (!identity || !pendingAction) return;
    // Avoid duplicate dispatch if identity changes again later.
    const sig = `${pendingAction.type}|${identity.deviceToken}|${identity.playerName}`;
    if (lastIdentifiedActionRef.current === sig) return;
    lastIdentifiedActionRef.current = sig;

    savePlayerName(identity.playerName);
    if (pendingAction.type === 'create') {
      onSend({ type: 'C2S_CREATE_GAME', payload: { playerName: identity.playerName } });
    } else {
      onSend({
        type: 'C2S_JOIN_GAME',
        payload: { sessionId: pendingAction.sessionId, playerName: identity.playerName }
      });
    }
    setPendingAction(null);
  }, [identity, pendingAction, onSend]);

  // Clear pending action if identity errors out.
  useEffect(() => {
    if (identifyError) setPendingAction(null);
  }, [identifyError]);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const minPlayers = settings?.minPlayers || 5;
  const canStart = players.length >= minPlayers;
  const myPlayer = players.find((p) => p.id === myPlayerId);

  const takenColors = players.filter((p) => p.id !== myPlayerId).map((p) => p.color).filter(Boolean) as string[];

  const handleCreate = () => {
    const name = playerName.trim();
    if (!isValidPlayerName(name)) return;
    setPendingAction({ type: 'create' });
    identify(getOrCreateDeviceToken(), name);
  };

  const handleJoin = () => {
    const name = playerName.trim();
    const sid = joinSessionId.trim();
    if (!isValidPlayerName(name) || !sid) return;
    setPendingAction({ type: 'join', sessionId: sid });
    identify(getOrCreateDeviceToken(), name);
  };

  const isIdentifying = pendingAction !== null;
  const nameValid = isValidPlayerName(playerName.trim());

  const handleColorSelect = (colorId: string) => {
    if (takenColors.includes(colorId)) return;
    onSend({ type: 'C2S_SET_AVATAR', payload: { color: colorId } });
  };

  const handleAvatarSelect = (avatarId: string) => {
    onSend({ type: 'C2S_SET_AVATAR', payload: { avatar: avatarId } });
  };

  const updateSettings = (partialSettings: Partial<GameSettings>) => {
    onSend({ type: 'C2S_UPDATE_SETTINGS', payload: { settings: partialSettings } });
  };

  if (!sessionId) {
    const welcomeBack = identity?.isReturningPlayer && !pendingAction;
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>The Traitors</h1>
        <p className={styles.subtitle}>A Game of Deception</p>

        {welcomeBack && (
          <p className={styles.welcomeBack}>👋 Welcome back, {identity!.playerName}!</p>
        )}

        {mode === 'menu' && (
          <div className={styles.menu}>
            <button className={styles.primaryBtn} onClick={() => setMode('create')}>
              Create Game
            </button>
            <button className={styles.secondaryBtn} onClick={() => setMode('join')}>
              Join Game
            </button>
            {!rulesSeen ? (
              <button className={styles.primaryBtn} onClick={openRules}>
                How to Play
              </button>
            ) : (
              <button className={styles.tertiaryBtn} onClick={openRules}>
                How to Play
              </button>
            )}
            <button
              className={styles.tertiaryBtn}
              onClick={() => setShowProfileDrawer(true)}
            >
              My Profile & Stats
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className={styles.form}>
            <input
              type="text"
              placeholder="Your name (2–20 letters/digits)"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className={styles.input}
              maxLength={20}
              autoFocus
            />
            {identifyError && <p className={styles.errorText}>{identifyError}</p>}
            <button
              className={styles.primaryBtn}
              onClick={handleCreate}
              disabled={!nameValid || isIdentifying}
            >
              {isIdentifying ? 'Connecting…' : 'Create Game'}
            </button>
            <button className={styles.backBtn} onClick={() => { setMode('menu'); setPendingAction(null); }}>
              Back
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className={styles.form}>
            <input
              type="text"
              placeholder="Session ID"
              value={joinSessionId}
              onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
              className={styles.input}
              maxLength={8}
            />
            <input
              type="text"
              placeholder="Your name (2–20 letters/digits)"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className={styles.input}
              maxLength={20}
            />
            {identifyError && <p className={styles.errorText}>{identifyError}</p>}
            <button
              className={styles.primaryBtn}
              onClick={handleJoin}
              disabled={!nameValid || !joinSessionId.trim() || isIdentifying}
            >
              {isIdentifying ? 'Connecting…' : 'Join Game'}
            </button>
            <button className={styles.backBtn} onClick={() => { setMode('menu'); setPendingAction(null); }}>
              Back
            </button>
          </div>
        )}

        {showProfileDrawer && (
          <ProfileDrawer
            onClose={() => setShowProfileDrawer(false)}
            onSend={onSend}
          />
        )}

        {showRules && <HowToPlayModal onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Game Lobby</h1>
      
      <div className={styles.sessionInfo}>
        <span>Session ID:</span>
        <code className={styles.sessionId}>{sessionId}</code>
        <button
          type="button"
          className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
          onClick={handleCopySession}
          aria-live="polite"
          aria-label={copied ? 'Session code copied' : 'Copy session code'}
        >
          {copied ? 'Copied!' : 'Copy Code'}
        </button>
      </div>

      <div className={styles.playerList}>
        <h2>Players ({players.length}/22)</h2>
        {players.map((player) => {
          const colorHex = getColorHex(player.color);
          const avatarEmoji = getAvatarEmoji(player.avatar);
          const isMe = player.id === myPlayerId;
          return (
            <div
              key={player.id}
              className={`${styles.playerCard} ${isMe ? styles.me : ''} ${player.isConnected === false ? styles.disconnected : ''}`}
              style={{ borderLeftColor: colorHex }}
            >
              <div className={styles.playerCardRow}>
                <div className={styles.playerAvatarBubble} style={{ background: colorHex }}>
                  {avatarEmoji}
                </div>
                <span className={styles.playerName}>
                  {player.name}
                  {((isMe && player.hasShield) || player.shieldRevealed) && (
                    <span className={styles.shieldBadge} title="Has Shield">🛡️</span>
                  )}
                  {player.isHost && <span className={styles.hostBadge}>HOST</span>}
                  {isMe && <span className={styles.youBadge}>YOU</span>}
                  {player.isConnected === false && <span className={styles.disconnectedBadge}>AWAY</span>}
                </span>
              </div>

              {isMe && (
                <div className={styles.pickerPanel}>
                  <div className={styles.pickerSection}>
                    <span className={styles.pickerLabel}>Color</span>
                    <div className={styles.colorSwatches}>
                      {PLAYER_COLORS.map((c) => {
                        const taken = takenColors.includes(c.id);
                        const selected = myPlayer?.color === c.id;
                        return (
                          <button
                            key={c.id}
                            className={`${styles.colorSwatch} ${selected ? styles.selectedSwatch : ''} ${taken ? styles.takenSwatch : ''}`}
                            style={{ background: c.hex }}
                            onClick={() => handleColorSelect(c.id)}
                            disabled={taken}
                            title={taken ? `${c.label} (taken)` : c.label}
                            aria-label={c.label}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.pickerSection}>
                    <span className={styles.pickerLabel}>Icon</span>
                    <div className={styles.avatarOptions}>
                      {PLAYER_AVATARS.map((a) => {
                        const selected = myPlayer?.avatar === a.id;
                        return (
                          <button
                            key={a.id}
                            className={`${styles.avatarOption} ${selected ? styles.selectedAvatar : ''}`}
                            onClick={() => handleAvatarSelect(a.id)}
                            title={a.label}
                            aria-label={a.label}
                          >
                            {a.emoji}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isHost && settings && (
        <div className={styles.settingsSection}>
          <button 
            className={styles.settingsToggle} 
            onClick={() => setShowSettings(!showSettings)}
          >
            {showSettings ? 'Hide Settings' : 'Game Settings'}
          </button>
          
          {showSettings && (
            <div className={styles.settingsPanel}>
              <div className={styles.settingGroup}>
                <label>Min Players to Start</label>
                <div className={styles.settingControl}>
                  <button 
                    onClick={() => updateSettings({ minPlayers: Math.max(5, minPlayers - 1) })}
                    disabled={minPlayers <= 5}
                  >-</button>
                  <span>{minPlayers}</span>
                  <button 
                    onClick={() => updateSettings({ minPlayers: Math.min(10, minPlayers + 1) })}
                    disabled={minPlayers >= 10}
                  >+</button>
                </div>
              </div>

              <div className={styles.settingGroup}>
                <label>Traitor Assignment</label>
                <div className={styles.traitorModeToggle}>
                  <button 
                    className={settings.traitorMode === 'auto' ? styles.active : ''}
                    onClick={() => updateSettings({ traitorMode: 'auto' })}
                  >Auto (1 per 5)</button>
                  <button 
                    className={settings.traitorMode === 'fixed' ? styles.active : ''}
                    onClick={() => updateSettings({ traitorMode: 'fixed' })}
                  >Fixed Count</button>
                </div>
                {settings.traitorMode === 'fixed' && (
                  <div className={styles.settingControl}>
                    <button 
                      onClick={() => updateSettings({ traitorCount: Math.max(1, settings.traitorCount - 1) })}
                      disabled={settings.traitorCount <= 1}
                    >-</button>
                    <span>{settings.traitorCount} Traitor{settings.traitorCount !== 1 ? 's' : ''}</span>
                    <button 
                      onClick={() => updateSettings({ traitorCount: Math.min(4, settings.traitorCount + 1) })}
                      disabled={settings.traitorCount >= 4}
                    >+</button>
                  </div>
                )}
              </div>

              <div className={styles.settingGroup}>
                <label>Discussion Time</label>
                <div className={styles.settingControl}>
                  <button 
                    onClick={() => updateSettings({ timerDurations: { ...settings.timerDurations, roundtable: Math.max(30, settings.timerDurations.roundtable - 30) } })}
                    disabled={settings.timerDurations.roundtable <= 30}
                  >-</button>
                  <span>{settings.timerDurations.roundtable}s</span>
                  <button 
                    onClick={() => updateSettings({ timerDurations: { ...settings.timerDurations, roundtable: Math.min(300, settings.timerDurations.roundtable + 30) } })}
                    disabled={settings.timerDurations.roundtable >= 300}
                  >+</button>
                </div>
              </div>

              <div className={styles.settingGroup}>
                <label>Voting Time</label>
                <div className={styles.settingControl}>
                  <button 
                    onClick={() => updateSettings({ timerDurations: { ...settings.timerDurations, voting: Math.max(30, settings.timerDurations.voting - 15) } })}
                    disabled={settings.timerDurations.voting <= 30}
                  >-</button>
                  <span>{settings.timerDurations.voting}s</span>
                  <button 
                    onClick={() => updateSettings({ timerDurations: { ...settings.timerDurations, voting: Math.min(120, settings.timerDurations.voting + 15) } })}
                    disabled={settings.timerDurations.voting >= 120}
                  >+</button>
                </div>
              </div>

              <div className={styles.settingGroup}>
                <label>Night Time</label>
                <div className={styles.settingControl}>
                  <button 
                    onClick={() => updateSettings({ timerDurations: { ...settings.timerDurations, night: Math.max(30, settings.timerDurations.night - 15) } })}
                    disabled={settings.timerDurations.night <= 30}
                  >-</button>
                  <span>{settings.timerDurations.night}s</span>
                  <button 
                    onClick={() => updateSettings({ timerDurations: { ...settings.timerDurations, night: Math.min(180, settings.timerDurations.night + 15) } })}
                    disabled={settings.timerDurations.night >= 180}
                  >+</button>
                </div>
              </div>

              <div className={styles.settingGroup}>
                <label className={styles.checkboxLabel}>
                  <input 
                    type="checkbox" 
                    checked={settings.round1DiscussionOnly}
                    onChange={(e) => updateSettings({ round1DiscussionOnly: e.target.checked })}
                  />
                  Round 1 Discussion Only (no banishment)
                </label>
              </div>

              <div className={styles.settingGroup}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={settings.challengesEnabled}
                    onChange={(e) => updateSettings({ challengesEnabled: e.target.checked })}
                  />
                  Shield Challenges Enabled
                </label>
              </div>

              <div className={styles.settingGroup}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={settings.enableSpecialRoles}
                    onChange={(e) => updateSettings({ enableSpecialRoles: e.target.checked })}
                  />
                  Special Roles (Sheriff 7+, Medic 8+, Seer 9+)
                </label>
              </div>

              {settings.challengesEnabled && (
                <div className={styles.settingGroup}>
                  <label>Challenge Time</label>
                  <div className={styles.settingControl}>
                    <button
                      onClick={() => updateSettings({ challengeTimerSeconds: Math.max(30, settings.challengeTimerSeconds - 15) })}
                      disabled={settings.challengeTimerSeconds <= 30}
                    >-</button>
                    <span>{settings.challengeTimerSeconds}s</span>
                    <button
                      onClick={() => updateSettings({ challengeTimerSeconds: Math.min(120, settings.challengeTimerSeconds + 15) })}
                      disabled={settings.challengeTimerSeconds >= 120}
                    >+</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!isHost && settings && (
        <div className={styles.settingsPreview}>
          <p>Settings: {settings.timerDurations.roundtable}s discussion, {settings.timerDurations.voting}s voting, {settings.timerDurations.night}s night</p>
          <p>{settings.traitorMode === 'auto' ? 'Auto traitor assignment' : `${settings.traitorCount} traitor${settings.traitorCount !== 1 ? 's' : ''}`}</p>
        </div>
      )}

      {!canStart && (
        <p className={styles.waitingText}>Waiting for more players... (need at least {minPlayers})</p>
      )}

      {isHost && canStart && (
        <p className={styles.waitingText}>Open the Host panel (bottom-right) to start the game.</p>
      )}

      {!isHost && canStart && (
        <p className={styles.waitingText}>Waiting for host to start...</p>
      )}

      <button
        type="button"
        className={styles.howToPlayLink}
        onClick={openRules}
      >
        How to Play
      </button>

      {showRules && <HowToPlayModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
