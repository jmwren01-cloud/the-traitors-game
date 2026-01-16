import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ChatMessage, Role, C2SEvent, ChatChannel } from '../types';
import styles from './ChatBox.module.css';

interface ChatBoxProps {
  messages: ChatMessage[];
  myPlayerId?: string;
  myRole?: Role;
  isAlive?: boolean;
  onSend: (event: C2SEvent) => void;
  disabled?: boolean;
}

export function ChatBox({ messages, myPlayerId, myRole, isAlive = true, onSend, disabled }: ChatBoxProps) {
  const [message, setMessage] = useState('');
  const [activeChannel, setActiveChannel] = useState<ChatChannel>('general');
  const [isMinimized, setIsMinimized] = useState(false);
  const [lastSeenGeneral, setLastSeenGeneral] = useState<number | null>(null);
  const [lastSeenTraitor, setLastSeenTraitor] = useState<number | null>(null);
  const [scrollPositions, setScrollPositions] = useState<{ general: number; traitor: number }>({ general: 0, traitor: 0 });
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isTraitor = myRole === 'TRAITOR';
  const canAccessTraitorChat = isTraitor && isAlive;

  // Filter messages by channel
  const generalMessages = useMemo(() => 
    messages.filter((m) => m.channel === 'general' || !m.channel), 
    [messages]
  );
  const traitorMessages = useMemo(() => 
    messages.filter((m) => m.channel === 'traitor'), 
    [messages]
  );

  const currentMessages = activeChannel === 'traitor' ? traitorMessages : generalMessages;

  // Initialize last seen counts on first render to avoid false unread counts
  useEffect(() => {
    if (lastSeenGeneral === null) {
      setLastSeenGeneral(generalMessages.length);
    }
    if (lastSeenTraitor === null) {
      setLastSeenTraitor(traitorMessages.length);
    }
  }, [generalMessages.length, traitorMessages.length, lastSeenGeneral, lastSeenTraitor]);

  // Calculate unread counts (only count new messages since last seen)
  const unreadGeneral = lastSeenGeneral !== null ? Math.max(0, generalMessages.length - lastSeenGeneral) : 0;
  const unreadTraitor = lastSeenTraitor !== null ? Math.max(0, traitorMessages.length - lastSeenTraitor) : 0;

  // Save scroll position before switching tabs
  const saveScrollPosition = useCallback(() => {
    if (messagesContainerRef.current) {
      setScrollPositions((prev) => ({
        ...prev,
        [activeChannel]: messagesContainerRef.current?.scrollTop || 0,
      }));
    }
  }, [activeChannel]);

  // Handle tab switch
  const handleTabSwitch = useCallback((channel: ChatChannel) => {
    saveScrollPosition();
    setActiveChannel(channel);
    // Mark messages as seen when switching to that tab
    if (channel === 'general') {
      setLastSeenGeneral(generalMessages.length);
    } else {
      setLastSeenTraitor(traitorMessages.length);
    }
  }, [saveScrollPosition, generalMessages.length, traitorMessages.length]);

  // Restore scroll position after tab switch
  useEffect(() => {
    if (messagesContainerRef.current) {
      const savedPosition = scrollPositions[activeChannel];
      if (savedPosition > 0) {
        messagesContainerRef.current.scrollTop = savedPosition;
      } else {
        // Scroll to bottom if no saved position
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    }
  }, [activeChannel, scrollPositions]);

  // Scroll to bottom when new messages arrive in active channel
  useEffect(() => {
    if (messagesEndRef.current && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isNearBottom) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [currentMessages.length]);

  // Reset to general channel if traitor access is lost
  useEffect(() => {
    if (!canAccessTraitorChat && activeChannel === 'traitor') {
      setActiveChannel('general');
    }
  }, [canAccessTraitorChat, activeChannel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || disabled) return;

    // Prevent sending traitor messages if not allowed
    if (activeChannel === 'traitor' && !canAccessTraitorChat) {
      return;
    }

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

      <div className={styles.messages} ref={messagesContainerRef}>
        {currentMessages.length === 0 ? (
          <p className={styles.emptyText}>
            {activeChannel === 'traitor' ? 'No traitor messages yet' : 'No messages yet'}
          </p>
        ) : (
          currentMessages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${msg.playerId === myPlayerId ? styles.mine : ''} ${msg.channel === 'traitor' ? styles.traitorMessage : ''}`}
            >
              <div className={styles.messageHeader}>
                <span className={styles.playerName}>{msg.playerName}</span>
                <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
              </div>
              <p className={styles.messageText}>{msg.message}</p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            disabled 
              ? 'Chat disabled' 
              : activeChannel === 'traitor' 
                ? 'Secret traitor message...' 
                : 'Type a message...'
          }
          maxLength={200}
          disabled={disabled}
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
