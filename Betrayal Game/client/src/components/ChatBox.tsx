import { useState, useRef, useEffect } from 'react';
import type { ChatMessage, Role, C2SEvent } from '../types';
import styles from './ChatBox.module.css';

interface ChatBoxProps {
  messages: ChatMessage[];
  myPlayerId?: string;
  myRole?: Role;
  onSend: (event: C2SEvent) => void;
  disabled?: boolean;
  isNightPhase?: boolean;
}

export function ChatBox({ messages, myPlayerId, myRole, onSend, disabled, isNightPhase }: ChatBoxProps) {
  const [message, setMessage] = useState('');
  const [isTraitorMode, setIsTraitorMode] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isTraitor = myRole === 'TRAITOR';
  const canSendTraitorMessage = isTraitor && isNightPhase;

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || disabled) return;

    onSend({
      type: 'C2S_SEND_MESSAGE',
      payload: {
        message: trimmed,
        traitorOnly: canSendTraitorMessage && isTraitorMode,
      },
    });
    setMessage('');
    inputRef.current?.focus();
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (isMinimized) {
    return (
      <button
        className={styles.minimizedBtn}
        onClick={() => setIsMinimized(false)}
      >
        Chat ({messages.length})
      </button>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span>Chat</span>
        <button
          className={styles.minimizeBtn}
          onClick={() => setIsMinimized(true)}
        >
          —
        </button>
      </div>

      <div className={styles.messages}>
        {messages.length === 0 ? (
          <p className={styles.emptyText}>No messages yet</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${msg.playerId === myPlayerId ? styles.mine : ''} ${msg.isTraitorOnly ? styles.traitorOnly : ''}`}
            >
              <div className={styles.messageHeader}>
                <span className={styles.playerName}>{msg.playerName}</span>
                {msg.isTraitorOnly && <span className={styles.traitorBadge}>Traitor</span>}
                <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
              </div>
              <p className={styles.messageText}>{msg.message}</p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputForm}>
        {canSendTraitorMessage && (
          <button
            type="button"
            className={`${styles.traitorToggle} ${isTraitorMode ? styles.active : ''}`}
            onClick={() => setIsTraitorMode(!isTraitorMode)}
            title="Toggle traitor-only chat"
          >
            🔒
          </button>
        )}
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={disabled ? 'Chat disabled' : isTraitorMode ? 'Traitor message...' : 'Type a message...'}
          maxLength={200}
          disabled={disabled}
          className={`${styles.input} ${isTraitorMode ? styles.traitorInput : ''}`}
        />
        <button
          type="submit"
          disabled={!message.trim() || disabled}
          className={styles.sendBtn}
        >
          Send
        </button>
      </form>
    </div>
  );
}
