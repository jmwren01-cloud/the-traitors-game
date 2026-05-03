import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ChatMessage, Role, C2SEvent, ChatChannel, Player, ConfessionReveal } from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import styles from './ChatBox.module.css';
import { vibrateOnce } from '../utils/haptics';

interface ChatBoxProps {
  messages: ChatMessage[];
  myPlayerId?: string;
  myRole?: Role;
  isAlive?: boolean;
  onSend: (event: C2SEvent) => void;
  disabled?: boolean;
  players?: Player[];
  /**
   * Wave 4 / 4 — Confessions for the current visible round, in the
   * server-shuffled order. Anonymous (no playerId).
   */
  confessions?: ConfessionReveal[];
  confessionRound?: number;
}

export function ChatBox({ messages, myPlayerId, myRole, isAlive = true, onSend, disabled, players = [], confessions = [], confessionRound }: ChatBoxProps) {
  const [message, setMessage] = useState('');
  const [activeChannel, setActiveChannel] = useState<ChatChannel>('general');
  const [isMinimized, setIsMinimized] = useState(false);
  const [lastSeenGeneral, setLastSeenGeneral] = useState<number | null>(null);
  const [lastSeenTraitor, setLastSeenTraitor] = useState<number | null>(null);
  const [scrollPositions, setScrollPositions] = useState<Record<ChatChannel, number>>({ general: 0, traitor: 0, confessions: 0 });
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isTraitor = myRole === 'TRAITOR';
  const canAccessTraitorChat = isTraitor && isAlive;

  const generalMessages = useMemo(() => 
    messages.filter((m) => m.channel === 'general' || !m.channel), 
    [messages]
  );
  const traitorMessages = useMemo(() => 
    messages.filter((m) => m.channel === 'traitor'), 
    [messages]
  );

  const currentMessages = activeChannel === 'traitor' ? traitorMessages : generalMessages;

  useEffect(() => {
    if (lastSeenGeneral === null) {
      setLastSeenGeneral(generalMessages.length);
    }
    if (lastSeenTraitor === null) {
      setLastSeenTraitor(traitorMessages.length);
    }
  }, [generalMessages.length, traitorMessages.length, lastSeenGeneral, lastSeenTraitor]);

  const unreadGeneral = lastSeenGeneral !== null ? Math.max(0, generalMessages.length - lastSeenGeneral) : 0;
  const unreadTraitor = lastSeenTraitor !== null ? Math.max(0, traitorMessages.length - lastSeenTraitor) : 0;

  const saveScrollPosition = useCallback(() => {
    if (messagesContainerRef.current) {
      setScrollPositions((prev) => ({
        ...prev,
        [activeChannel]: messagesContainerRef.current?.scrollTop || 0,
      }));
    }
  }, [activeChannel]);

  const handleTabSwitch = useCallback((channel: ChatChannel) => {
    saveScrollPosition();
    setActiveChannel(channel);
    if (channel === 'general') {
      setLastSeenGeneral(generalMessages.length);
    } else {
      setLastSeenTraitor(traitorMessages.length);
    }
  }, [saveScrollPosition, generalMessages.length, traitorMessages.length]);

  useEffect(() => {
    if (messagesContainerRef.current) {
      const savedPosition = scrollPositions[activeChannel];
      if (savedPosition > 0) {
        messagesContainerRef.current.scrollTop = savedPosition;
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    }
  }, [activeChannel, scrollPositions]);

  useEffect(() => {
    if (messagesEndRef.current && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isNearBottom) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [currentMessages.length]);

  useEffect(() => {
    if (!canAccessTraitorChat && activeChannel === 'traitor') {
      setActiveChannel('general');
    }
    if (activeChannel === 'confessions' && confessions.length === 0) {
      setActiveChannel('general');
    }
  }, [canAccessTraitorChat, activeChannel, confessions.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || disabled) return;

    if (activeChannel === 'traitor' && !canAccessTraitorChat) {
      return;
    }

    vibrateOnce(10);
    onSend({
      type: 'C2S_SEND_MESSAGE',
      payload: {
        message: trimmed,
        channel: activeChannel,
      },
    });
    setMessage('');
    inputRef.current?.focus();
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatUnread = (count: number) => {
    if (count <= 0) return null;
    return count > 9 ? '9+' : count.toString();
  };

  const getPlayerById = (id: string) => players.find((p) => p.id === id);

  if (isMinimized) {
    const totalUnread = unreadGeneral + (canAccessTraitorChat ? unreadTraitor : 0);
    return (
      <button
        className={styles.minimizedBtn}
        onClick={() => setIsMinimized(false)}
      >
        Chat {totalUnread > 0 && `(${totalUnread > 9 ? '9+' : totalUnread})`}
      </button>
    );
  }

  return (
    <div className={`${styles.container} ${activeChannel === 'traitor' ? styles.traitorMode : ''}`}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeChannel === 'general' ? styles.activeTab : ''}`}
            onClick={() => handleTabSwitch('general')}
          >
            General
            {activeChannel !== 'general' && formatUnread(unreadGeneral) && (
              <span className={styles.unreadBadge}>{formatUnread(unreadGeneral)}</span>
            )}
          </button>
          {canAccessTraitorChat && (
            <button
              className={`${styles.tab} ${styles.traitorTab} ${activeChannel === 'traitor' ? styles.activeTab : ''}`}
              onClick={() => handleTabSwitch('traitor')}
            >
              Traitors
              {activeChannel !== 'traitor' && formatUnread(unreadTraitor) && (
                <span className={styles.unreadBadge}>{formatUnread(unreadTraitor)}</span>
              )}
            </button>
          )}
          {confessions.length > 0 && (
            <button
              className={`${styles.tab} ${activeChannel === 'confessions' ? styles.activeTab : ''}`}
              onClick={() => handleTabSwitch('confessions')}
              title="Anonymous confessions from this round"
            >
              🕯️ Confessions
              <span className={styles.unreadBadge}>{confessions.length}</span>
            </button>
          )}
        </div>
        <button
          className={styles.minimizeBtn}
          onClick={() => setIsMinimized(true)}
        >
          —
        </button>
      </div>

      {activeChannel === 'traitor' && (
        <div className={styles.traitorWarning}>
          You are in TRAITOR-ONLY chat
        </div>
      )}

      {activeChannel === 'confessions' ? (
        <div className={styles.messages} ref={messagesContainerRef}>
          <p className={styles.emptyText} style={{ fontSize: 11, opacity: 0.7, fontStyle: 'italic', textAlign: 'center' }}>
            Round {confessionRound ?? '—'} • Anonymous • Server-shuffled order
          </p>
          {confessions.map((c, i) => (
            <div key={c.id} className={styles.message} style={{ borderLeft: '3px solid #d4a550', paddingLeft: 8 }}>
              <div className={styles.messageHeader}>
                <span className={styles.playerName} style={{ color: '#f7d896' }}>
                  Anonymous #{i + 1}
                </span>
              </div>
              <p className={styles.messageText} style={{ fontStyle: 'italic' }}>"{c.text}"</p>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      ) : (
      <div className={styles.messages} ref={messagesContainerRef}>
        {currentMessages.length === 0 ? (
          <p className={styles.emptyText}>
            {activeChannel === 'traitor' ? 'No traitor messages yet' : 'No messages yet'}
          </p>
        ) : (
          currentMessages.map((msg) => {
            const msgPlayer = getPlayerById(msg.playerId);
            const colorHex = getColorHex(msgPlayer?.color);
            const avatarEmoji = getAvatarEmoji(msgPlayer?.avatar);
            const isMe = msg.playerId === myPlayerId;
            return (
              <div
                key={msg.id}
                className={`${styles.message} ${isMe ? styles.mine : ''} ${msg.channel === 'traitor' ? styles.traitorMessage : ''}`}
              >
                <div className={styles.messageHeader}>
                  <span
                    className={styles.playerAvatar}
                    style={{ background: colorHex, color: '#000' }}
                  >
                    {avatarEmoji}
                  </span>
                  <span className={styles.playerName} style={{ color: colorHex }}>{msg.playerName}</span>
                  <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
                </div>
                <p className={styles.messageText}>{msg.message}</p>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>
      )}

      <form onSubmit={handleSubmit} className={styles.inputForm} style={activeChannel === 'confessions' ? { display: 'none' } : undefined}>
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => {
            window.setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 250);
          }}
          placeholder={
            disabled 
              ? 'Chat disabled' 
              : activeChannel === 'traitor' 
                ? 'Secret traitor message...' 
                : 'Type a message...'
          }
          maxLength={200}
          disabled={disabled}
          enterKeyHint="send"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={`${styles.input} ${activeChannel === 'traitor' ? styles.traitorInput : ''}`}
        />
        <button
          type="submit"
          disabled={!message.trim() || disabled}
          className={`${styles.sendBtn} ${activeChannel === 'traitor' ? styles.traitorSendBtn : ''}`}
        >
          Send
        </button>
      </form>
    </div>
  );
}
