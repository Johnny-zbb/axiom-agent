import {useEffect, useMemo, useRef, useState} from 'react';
import styles from './styles.module.css';

type Actor = 'USER' | 'APP' | 'LLM' | 'TOOL';

type Trace = {
  actor: Actor;
  target: Actor;
  title: string;
  payload: unknown;
};

const traces: Trace[] = [
  {
    actor: 'USER',
    target: 'APP',
    title: '发送问题',
    payload: {
      role: 'user',
      content: '北京今天需要带伞吗？',
    },
  },
  {
    actor: 'APP',
    target: 'LLM',
    title: '发送 Messages 和 Tools',
    payload: {
      messages: [
        {
          role: 'user',
          content: '北京今天需要带伞吗？',
        },
      ],
      tools: ['get_weather(city)'],
    },
  },
  {
    actor: 'LLM',
    target: 'APP',
    title: '返回 Tool Call',
    payload: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          name: 'get_weather',
          arguments: {
            city: '北京',
          },
        },
      ],
    },
  },
  {
    actor: 'APP',
    target: 'TOOL',
    title: '执行天气工具',
    payload: {
      function: 'get_weather',
      arguments: {
        city: '北京',
      },
    },
  },
  {
    actor: 'TOOL',
    target: 'APP',
    title: '返回工具结果',
    payload: {
      condition: '小雨',
      temperature: 18,
    },
  },
  {
    actor: 'APP',
    target: 'LLM',
    title: '带着结果再次请求',
    payload: {
      appended_messages: [
        {
          role: 'assistant',
          tool_call: 'get_weather(city="北京")',
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '小雨，18℃',
        },
      ],
    },
  },
  {
    actor: 'LLM',
    target: 'APP',
    title: '生成最终回答',
    payload: {
      role: 'assistant',
      content: '今天有小雨，建议带伞。',
    },
  },
];

export default function ToolCallingPlayground() {
  const [step, setStep] = useState(0);
  const [expanded, setExpanded] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mobilePane, setMobilePane] = useState<'chat' | 'trace'>('chat');
  const traceListRef = useRef<HTMLDivElement>(null);
  const visibleTraces = useMemo(() => traces.slice(0, step + 1), [step]);

  useEffect(() => {
    setExpanded(step);
    window.requestAnimationFrame(() => {
      const list = traceListRef.current;
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    });
  }, [mobilePane, step]);

  useEffect(() => {
    if (!playing) {
      return undefined;
    }

    if (step === traces.length - 1) {
      setPlaying(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setStep((value) => Math.min(value + 1, traces.length - 1));
    }, 1100);

    return () => window.clearTimeout(timer);
  }, [playing, step]);

  const togglePlay = () => {
    if (step === traces.length - 1) {
      setStep(0);
      setPlaying(true);
      return;
    }

    setPlaying((value) => !value);
  };

  const reset = () => {
    setPlaying(false);
    setStep(0);
    setExpanded(0);
    setMobilePane('chat');
  };

  return (
    <section className={styles.playground} aria-label="Tool Calling 交互演示">
      <header className={styles.header}>
        <div>
          <span>交互演示</span>
          <strong>Tool Calling 如何完成</strong>
        </div>
        <div className={styles.controls}>
          <button
            aria-label="上一步"
            disabled={step === 0}
            onClick={() => {
              setPlaying(false);
              setStep((value) => Math.max(0, value - 1));
            }}
            type="button">
            ‹
          </button>
          <button className={styles.playButton} onClick={togglePlay} type="button">
            {playing ? '暂停' : step === traces.length - 1 ? '重播' : '播放'}
          </button>
          <button
            aria-label="下一步"
            disabled={step === traces.length - 1}
            onClick={() => {
              setPlaying(false);
              setStep((value) => Math.min(traces.length - 1, value + 1));
            }}
            type="button">
            ›
          </button>
          <button className={styles.resetButton} onClick={reset} type="button">
            重置
          </button>
        </div>
      </header>

      <div className={styles.progress} aria-label={`当前第 ${step + 1} 步`}>
        {traces.map((trace, index) => (
          <button
            aria-label={`跳到第 ${index + 1} 步：${trace.title}`}
            aria-current={index === step ? 'step' : undefined}
            className={`${index <= step ? styles.progressActive : ''} ${
              index === step ? styles.progressCurrent : ''
            }`}
            key={trace.title}
            onClick={() => {
              setPlaying(false);
              setStep(index);
            }}
            type="button">
            {index + 1}
          </button>
        ))}
      </div>

      <div className={styles.mobileTabs} role="tablist" aria-label="演示视图">
        <button
          aria-controls="tool-chat-panel"
          aria-selected={mobilePane === 'chat'}
          className={mobilePane === 'chat' ? styles.activeTab : ''}
          id="tool-chat-tab"
          onClick={() => setMobilePane('chat')}
          role="tab"
          type="button">
          Chat
        </button>
        <button
          aria-controls="tool-trace-panel"
          aria-selected={mobilePane === 'trace'}
          className={mobilePane === 'trace' ? styles.activeTab : ''}
          id="tool-trace-tab"
          onClick={() => setMobilePane('trace')}
          role="tab"
          type="button">
          Trace
          <span>{visibleTraces.length}</span>
        </button>
      </div>

      <div className={styles.workspace}>
        <div
          aria-labelledby="tool-chat-tab"
          className={`${styles.chatPanel} ${
            mobilePane === 'chat' ? styles.mobileActive : ''
          }`}
          id="tool-chat-panel"
          role="tabpanel">
          <div className={styles.panelTitle}>
            <strong>Chat</strong>
            <small>用户界面</small>
          </div>
          <div className={styles.chatBody}>
            <div className={styles.userBubble}>北京今天需要带伞吗？</div>

            {step < traces.length - 1 && (
              <div className={styles.activity} aria-label="处理中">
                <i />
                <i />
                <i />
              </div>
            )}

            {step === traces.length - 1 && (
              <div className={styles.assistantBubble}>
                今天有小雨，建议带伞。
              </div>
            )}
          </div>
          <div className={styles.inputPreview}>
            <span>输入消息…</span>
            <button disabled type="button">
              发送
            </button>
          </div>
        </div>

        <div
          aria-labelledby="tool-trace-tab"
          className={`${styles.tracePanel} ${
            mobilePane === 'trace' ? styles.mobileActive : ''
          }`}
          id="tool-trace-panel"
          role="tabpanel">
          <div className={styles.panelTitle}>
            <strong>Trace</strong>
            <small>{visibleTraces.length} 个事件</small>
          </div>
          <div
            className={styles.traceList}
            aria-live="polite"
            ref={traceListRef}>
            {visibleTraces.map((trace, index) => {
              const open = expanded === index;

              return (
                <article
                  className={`${styles.traceItem} ${
                    index === step ? styles.currentTrace : ''
                  }`}
                  key={`${trace.actor}-${trace.title}`}>
                  <button
                    aria-expanded={open}
                    className={styles.traceSummary}
                    onClick={() => setExpanded(open ? -1 : index)}
                    type="button">
                    <span className={styles.stepNumber}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={`${styles.actor} ${
                        styles[`actor${trace.actor}`]
                      }`}>
                      {trace.actor}
                    </span>
                    <span className={styles.traceTitle}>
                      <strong>{trace.title}</strong>
                      <small>
                        {trace.actor} → {trace.target}
                      </small>
                    </span>
                    <span className={styles.chevron}>{open ? '−' : '+'}</span>
                  </button>

                  {open && (
                    <div className={styles.traceDetails}>
                      <pre>
                        <code>{JSON.stringify(trace.payload, null, 2)}</code>
                      </pre>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={playing ? styles.statusPulsing : ''} />
        <strong>当前发生：</strong>
        {traces[step].actor} → {traces[step].target} · {traces[step].title}
      </footer>
    </section>
  );
}
