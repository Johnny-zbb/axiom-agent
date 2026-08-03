import type {FormEvent, KeyboardEvent} from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import styles from './styles.module.css';

type MessageRole = 'system' | 'user' | 'assistant';

type Message = {
  role: MessageRole;
  content: string;
};

const systemMessage: Message = {
  role: 'system',
  content: '你是一个回答简洁的助手。',
};

function createReply(input: string): string {
  if (input.includes('天空') && input.includes('蓝')) {
    return '因为阳光进入大气层后，蓝色光比其他颜色更容易被散射。';
  }

  if (/你好|hello/i.test(input)) {
    return '你好！这条回答会作为一条 assistant message 加入数组。';
  }

  return `我收到了“${input}”。在真实应用中，这里会显示模型生成的回答。`;
}

export default function MessagePlayground() {
  const [messages, setMessages] = useState<Message[]>([systemMessage]);
  const [input, setInput] = useState('为什么天空是蓝色的？');
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [mobilePane, setMobilePane] = useState<'chat' | 'messages'>('chat');
  const replyTimerRef = useRef<number | undefined>(undefined);
  const highlightTimerRef = useRef<number | undefined>(undefined);
  const chatRef = useRef<HTMLDivElement>(null);
  const codePanelRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== 'system'),
    [messages],
  );

  useEffect(
    () => () => {
      window.clearTimeout(replyTimerRef.current);
      window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    window.requestAnimationFrame(() => {
      for (const panel of [chatRef.current, codePanelRef.current]) {
        if (panel) {
          panel.scrollTop = panel.scrollHeight;
        }
      }
    });
  }, [loading, messages, mobilePane]);

  const highlightMessage = (index: number) => {
    window.clearTimeout(highlightTimerRef.current);
    setHighlightedIndex(index);
    highlightTimerRef.current = window.setTimeout(
      () => setHighlightedIndex(-1),
      1600,
    );
  };

  const sendMessage = (event?: FormEvent) => {
    event?.preventDefault();

    const text = input.trim();
    if (!text || loading) {
      return;
    }

    const userMessage: Message = {
      role: 'user',
      content: text,
    };

    const userMessageIndex = messages.length;
    const assistantMessageIndex = userMessageIndex + 1;

    setMessages((current) => [...current, userMessage]);
    highlightMessage(userMessageIndex);
    setInput('');
    setLoading(true);
    setMobilePane('messages');

    replyTimerRef.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: createReply(text),
        },
      ]);
      highlightMessage(assistantMessageIndex);
      setLoading(false);
    }, 650);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const reset = () => {
    window.clearTimeout(replyTimerRef.current);
    window.clearTimeout(highlightTimerRef.current);
    setMessages([systemMessage]);
    setInput('为什么天空是蓝色的？');
    setLoading(false);
    setHighlightedIndex(0);
    setMobilePane('chat');
  };

  const statusText = loading
    ? '等待 assistant message'
    : highlightedIndex >= 0
      ? `已加入 ${messages[highlightedIndex]?.role} message`
      : '等待发送';

  return (
    <section className={styles.playground} aria-label="Messages 交互演示">
      <header className={styles.header}>
        <div>
          <span>交互演示</span>
          <strong>Messages 如何形成</strong>
        </div>
        <div className={styles.toolbar}>
          <span className={styles.localBadge}>本地模拟</span>
          <button type="button" onClick={reset} className={styles.resetButton}>
            重置
          </button>
        </div>
      </header>

      <div className={styles.mobileTabs} role="tablist" aria-label="演示视图">
        <button
          aria-controls="messages-chat-panel"
          aria-selected={mobilePane === 'chat'}
          className={mobilePane === 'chat' ? styles.activeTab : ''}
          id="messages-chat-tab"
          onClick={() => setMobilePane('chat')}
          role="tab"
          type="button">
          Chat
        </button>
        <button
          aria-controls="messages-data-panel"
          aria-selected={mobilePane === 'messages'}
          className={mobilePane === 'messages' ? styles.activeTab : ''}
          id="messages-data-tab"
          onClick={() => setMobilePane('messages')}
          role="tab"
          type="button">
          Messages
          <span>{messages.length}</span>
        </button>
      </div>

      <div className={styles.workspace}>
        <div
          aria-labelledby="messages-chat-tab"
          className={`${styles.panel} ${
            mobilePane === 'chat' ? styles.mobileActive : ''
          }`}
          id="messages-chat-panel"
          role="tabpanel">
          <div className={styles.panelTitle}>
            <span>Chat</span>
            <small>用户界面</small>
          </div>

          <div className={styles.chat} ref={chatRef}>
            {visibleMessages.length === 0 && (
              <div className={styles.empty}>发送一条消息</div>
            )}

            {visibleMessages.map((message, index) => (
              <div
                className={`${styles.message} ${
                  message.role === 'user'
                    ? styles.userMessage
                    : styles.assistantMessage
                }`}
                key={`${message.role}-${index}`}>
                <span>{message.role}</span>
                <p>{message.content}</p>
              </div>
            ))}

            {loading && (
              <div
                className={`${styles.message} ${styles.assistantMessage} ${styles.typing}`}>
                <span>assistant</span>
                <p>
                  <i />
                  <i />
                  <i />
                </p>
              </div>
            )}
          </div>

          <form className={styles.composer} onSubmit={sendMessage}>
            <input
              aria-label="输入一条消息"
              disabled={loading}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入一条消息"
              value={input}
            />
            <button disabled={loading || !input.trim()} type="submit">
              {loading ? '生成中' : '发送'}
            </button>
          </form>
        </div>

        <div
          aria-labelledby="messages-data-tab"
          className={`${styles.panel} ${styles.messagesPanel} ${
            mobilePane === 'messages' ? styles.mobileActive : ''
          }`}
          id="messages-data-panel"
          role="tabpanel">
          <div className={styles.panelTitle}>
            <span>Messages</span>
            <small>{messages.length} 条</small>
          </div>
          <div
            className={styles.codePanel}
            aria-live="polite"
            ref={codePanelRef}>
            <span className={styles.bracket}>[</span>
            {messages.map((message, index) => (
              <div
                className={`${styles.messageObject} ${
                  index === highlightedIndex ? styles.justAdded : ''
                }`}
                key={`${message.role}-${index}`}>
                <span className={`${styles.roleTag} ${styles[message.role]}`}>
                  {message.role}
                </span>
                <pre>
                  <code>{JSON.stringify(message, null, 2)}</code>
                </pre>
                {index === highlightedIndex && (
                  <span className={styles.addedLabel}>刚刚加入</span>
                )}
              </div>
            ))}
            <span className={styles.bracket}>]</span>
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={loading ? styles.statusPulsing : ''} />
        <strong>当前发生：</strong>
        {statusText}
      </footer>
    </section>
  );
}
