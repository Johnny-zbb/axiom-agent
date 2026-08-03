import {useEffect, useMemo, useState} from 'react';

import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {AppShell} from '@astryxdesign/core/AppShell';
import {ChatComposer, ChatLayout, ChatMessage, ChatMessageBubble, ChatToolCalls} from '@astryxdesign/core/Chat';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {CommandPalette} from '@astryxdesign/core/CommandPalette';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, Layout, LayoutContent, LayoutHeader, LayoutPanel, VStack} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {Markdown} from '@astryxdesign/core/Markdown';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {Selector} from '@astryxdesign/core/Selector';
import {SideNav, SideNavCollapseButton, SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Heading, Text} from '@astryxdesign/core/Text';
import {createStaticSource, type SearchableItem} from '@astryxdesign/core/Typeahead';

type RunStatus = 'idle' | 'running' | 'complete' | 'stopped' | 'error';
type InspectorTab = 'tools' | 'run' | 'settings';
type ToolRow = {id: string; name: string; arguments: unknown; observation?: string; isError?: boolean};
type ChatRow = {id: string; sender: 'user' | 'assistant'; content: string};
type ThreadRow = {id: string; title: string; detail: string};
type SearchItem = SearchableItem<{kind: 'thread' | 'action'; group: string}>;
type AgentEvent = {
  type: string;
  turn?: number;
  delta?: string;
  call?: {id: string; name: string; arguments: unknown};
  result?: {content: string; isError: boolean};
  error?: {message: string};
  finalMessage?: {content: string};
};
type Envelope =
  | {type: 'run_created'; runId: string; traceRunId: string; sessionId: string; workspace: string}
  | {type: 'agent_event'; event: AgentEvent}
  | {type: 'complete'; runId: string}
  | {type: 'transport_error'; error: string};

const landingSuggestions = [
  {
    title: 'Fix a failing test',
    description: 'Inspect the relevant files, make the smallest fix, and run the tests.',
    prompt: 'Inspect the failing tests, implement the smallest correct fix, and run the relevant Node tests.',
  },
  {
    title: 'Explain this workspace',
    description: 'Map the important modules and describe how the execution path works.',
    prompt: 'Inspect this workspace and explain its architecture, main modules, and execution flow.',
  },
  {
    title: 'Review before changing',
    description: 'Find the relevant code and propose a focused implementation plan first.',
    prompt: 'Inspect the relevant code for this task and propose a minimal implementation plan before making changes:',
  },
];

const statusDetails: Record<RunStatus, {label: string; variant: 'neutral' | 'accent' | 'success' | 'warning' | 'error'}> = {
  idle: {label: 'Ready', variant: 'neutral'},
  running: {label: 'Agent running', variant: 'accent'},
  complete: {label: 'Completed', variant: 'success'},
  stopped: {label: 'Stopped', variant: 'warning'},
  error: {label: 'Failed', variant: 'error'},
};

export default function App() {
  const [workspace, setWorkspace] = useState('');
  const [workspaceChoices, setWorkspaceChoices] = useState<Array<{value: string; label: string}>>([]);
  const [isCustomWorkspace, setIsCustomWorkspace] = useState(false);
  const [task, setTask] = useState('');
  const [sessionId, setSessionId] = useState('coding-agent-gui');
  const [model, setModel] = useState('deepseek-v4-flash');
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [runId, setRunId] = useState<string>();
  const [traceRunId, setTraceRunId] = useState<string>();
  const [turn, setTurn] = useState(0);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([
    {id: 'coding-agent-gui', title: 'New coding task', detail: 'Ready'},
  ]);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('tools');
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetch('/api/health')
      .then(response => response.json())
      .then(config => {
        const defaultWorkspace = config.defaultWorkspace ?? '';
        setWorkspace(defaultWorkspace);
        setWorkspaceChoices(defaultWorkspace ? [{value: defaultWorkspace, label: workspaceLabel(defaultWorkspace)}] : []);
        setConfigured(Boolean(config.ready));
        setModel(config.model ?? 'deepseek-v4-flash');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Cannot connect to local service.'));
  }, []);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, []);

  const statusDetail = statusDetails[status];
  const completedTools = useMemo(() => tools.filter(tool => tool.observation !== undefined).length, [tools]);
  const searchSource = useMemo(() => createStaticSource<SearchItem>([
    {id: '__new__', label: 'New chat', auxiliaryData: {kind: 'action', group: 'Actions'}},
    {id: '__settings__', label: 'Settings', auxiliaryData: {kind: 'action', group: 'Actions'}},
    ...threads.map(thread => ({
      id: thread.id,
      label: thread.title,
      auxiliaryData: {kind: 'thread' as const, group: 'Conversations'},
    })),
  ]), [threads]);

  function newChat() {
    if (status === 'running') return;
    const id = `coding-agent-${Date.now()}`;
    setSessionId(id);
    setMessages([]);
    setTask('');
    setTools([]);
    setEvents([]);
    setTraceRunId(undefined);
    setTurn(0);
    setStatus('idle');
    setActivityOpen(false);
    setThreads(previous => [{id, title: 'New coding task', detail: 'Ready'}, ...previous]);
  }

  function selectThread(id: string) {
    if (status === 'running' || id === sessionId) return;
    setSessionId(id);
    setMessages([]);
    setTools([]);
    setEvents([]);
    setTraceRunId(undefined);
    setStatus('idle');
  }

  function selectSearchItem(id: string) {
    setIsSearchOpen(false);
    if (id === '__new__') newChat();
    else if (id === '__settings__') {
      setInspectorTab('settings');
      setIsInspectorOpen(true);
    } else selectThread(id);
  }

  async function runAgent(prompt: string) {
    if (!workspace.trim() || !prompt.trim()) {
      setError('Workspace and message are required.');
      return;
    }
    const userMessage: ChatRow = {id: crypto.randomUUID(), sender: 'user', content: prompt.trim()};
    const assistantMessage: ChatRow = {id: crypto.randomUUID(), sender: 'assistant', content: ''};
    setTask('');
    setStatus('running');
    setActivityOpen(true);
    setRunId(undefined);
    setTraceRunId(undefined);
    setTurn(0);
    setMessages(previous => [...previous, userMessage, assistantMessage]);
    setThreads(previous => previous.map(thread => thread.id === sessionId
      ? {...thread, title: prompt.trim().slice(0, 42), detail: 'Running'}
      : thread));
    setTools([]);
    setEvents([]);
    setInspectorTab('tools');
    setError(undefined);

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({workspace, task: prompt.trim(), sessionId}),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Run request failed (${response.status}).`);
      }
      await consumeLines(response.body, envelope => handleEnvelope(envelope, assistantMessage.id));
    } catch (cause) {
      setStatus(previous => previous === 'stopped' ? previous : 'error');
      setError(cause instanceof Error ? cause.message : 'Run failed.');
    }
  }

  function handleEnvelope(envelope: Envelope, assistantMessageId: string) {
    if (envelope.type === 'run_created') {
      setRunId(envelope.runId);
      setTraceRunId(envelope.traceRunId);
      return;
    }
    if (envelope.type === 'transport_error') {
      setActivityOpen(false);
      if (envelope.error === 'Stopped by user.') setStatus('stopped');
      else {
        setStatus('error');
        setError(envelope.error);
      }
      return;
    }
    if (envelope.type === 'complete') {
      setStatus('complete');
      setActivityOpen(false);
      setThreads(previous => previous.map(thread => thread.id === sessionId ? {...thread, detail: 'Completed'} : thread));
      return;
    }
    const event = envelope.event;
    if (event.type !== 'message_update') setEvents(previous => [...previous, event].slice(-80));
    if (event.type === 'turn_start' && event.turn) setTurn(event.turn);
    if (event.type === 'message_update' && event.delta) {
      setMessages(previous => previous.map(message => message.id === assistantMessageId
        ? {...message, content: message.content + event.delta}
        : message));
    }
    if (event.type === 'tool_execution_start' && event.call) {
      setTools(previous => [...previous, {id: event.call!.id, name: event.call!.name, arguments: event.call!.arguments}]);
    }
    if (event.type === 'tool_execution_end' && event.call && event.result) {
      setTools(previous => previous.map(tool => tool.id === event.call!.id
        ? {...tool, observation: event.result!.content, isError: event.result!.isError}
        : tool));
    }
    if (event.type === 'run_end' && event.finalMessage?.content) {
      setMessages(previous => previous.map(message => message.id === assistantMessageId && !message.content
        ? {...message, content: event.finalMessage!.content}
        : message));
    }
    if (event.type === 'run_error') {
      setStatus('error');
      setActivityOpen(false);
      setError(event.error?.message ?? 'Agent run failed.');
    }
  }

  async function stopAgent() {
    if (!runId) return;
    setStatus('stopped');
    setActivityOpen(false);
    await fetch(`/api/runs/${runId}/cancel`, {method: 'POST'}).catch(() => undefined);
  }

  const composer = (
    <ChatComposer
      value={task}
      onChange={setTask}
      onSubmit={value => void runAgent(value)}
      onStop={() => void stopAgent()}
      isStopShown={status === 'running'}
      isDisabled={!configured}
      placeholder="Ask the agent to inspect, change, or test code…"
      footerActions={<Text type="supporting" color="secondary">{model} · local workspace</Text>}
      status={error ? {type: 'error', message: error} : undefined}
    />
  );

  const conversationNav = (
    <SideNav
      header={
        <VStack gap={3}>
          <Heading level={3}>Axiom Agent</Heading>
          <Selector
            label="Workspace"
            options={[...workspaceChoices, {value: '__custom__', label: 'Custom workspace'}]}
            value={isCustomWorkspace ? '__custom__' : workspace}
            onChange={value => {
              if (value === '__custom__') setIsCustomWorkspace(true);
              else {
                setIsCustomWorkspace(false);
                setWorkspace(value ?? '');
              }
            }}
            size="sm"
            isDisabled={status === 'running'}
          />
          {isCustomWorkspace
            ? <TextInput label="Custom path" value={workspace} onChange={setWorkspace} width="100%" isDisabled={status === 'running'} />
            : null}
        </VStack>
      }
      topContent={
        <VStack gap={0.5}>
          <Button label="New chat" variant="ghost" width="100%" onClick={newChat} isDisabled={status === 'running'} />
          <Button label="Search" variant="ghost" width="100%" onClick={() => setIsSearchOpen(true)} />
        </VStack>
      }
      footer={<Button label="Settings" variant="ghost" width="100%" onClick={() => {
        setInspectorTab('settings');
        setIsInspectorOpen(true);
      }} />}
      footerIcons={<SideNavCollapseButton />}
      collapsible={{hasButton: false}}
      resizable={{defaultWidth: 256, minWidth: 220, maxWidth: 340, autoSaveId: 'coding-agent-history'}}>
      <SideNavSection title="Recent conversations">
        {threads.map(thread => (
          <SideNavItem
            key={thread.id}
            label={thread.title}
            isSelected={thread.id === sessionId}
            endContent={<Text type="supporting" color="secondary">{thread.detail}</Text>}
            onClick={() => selectThread(thread.id)}
          />
        ))}
      </SideNavSection>
    </SideNav>
  );

  const inspector = (
    <LayoutPanel width={320} padding={0} hasDivider label="Agent inspector">
      <VStack height="100%">
        <VStack gap={2} padding={3}>
          <HStack hAlign="between" vAlign="center" gap={2}>
            <Heading level={3}>Inspector</Heading>
            <Button label="Hide" variant="ghost" size="sm" onClick={() => setIsInspectorOpen(false)} />
          </HStack>
          <TabList value={inspectorTab} onChange={value => setInspectorTab(value as InspectorTab)} size="sm" layout="fill" hasDivider>
            <Tab value="tools" label="Tools" endContent={<Badge variant="neutral" label={`${completedTools}/${tools.length}`} />} />
            <Tab value="run" label="Run" />
            <Tab value="settings" label="Settings" />
          </TabList>
        </VStack>
        {status === 'running' ? <ProgressBar isIndeterminate label="Agent is working" /> : null}
        <VStack gap={3} padding={3}>
          {inspectorTab === 'tools' ? <ToolInspector tools={tools} /> : null}
          {inspectorTab === 'run' ? (
            <VStack gap={3}>
              <InspectorRow label="Status" value={statusDetail.label} />
              <InspectorRow label="Turn" value={String(turn)} />
              <InspectorRow label="Session" value={sessionId} />
              <InspectorRow label="Trace" value={traceRunId ?? 'Starts with the next run'} />
              <InspectorRow label="Events" value={String(events.length)} />
            </VStack>
          ) : null}
          {inspectorTab === 'settings' ? (
            <VStack gap={4}>
              <VStack gap={1}>
                <Heading level={4}>Workspace safety</Heading>
                <Text type="body" color="secondary">File tools stay bounded to the workspace selected in the sidebar.</Text>
              </VStack>
              <Divider />
              <VStack gap={2}>
                <Text type="label">Model</Text>
                <Text type="code" color="secondary">{model}</Text>
              </VStack>
              <Divider />
              <Banner status="info" title="Local-first" description="The provider key stays on the localhost server. File tools remain bounded to the selected workspace." />
            </VStack>
          ) : null}
        </VStack>
      </VStack>
    </LayoutPanel>
  );

  return (
    <>
      <AppShell height="fill" variant="section" contentPadding={0} sideNav={conversationNav}>
      <Layout
        height="fill"
        padding={0}
        header={
          <LayoutHeader padding={3} hasDivider>
            <HStack hAlign="between" vAlign="center" gap={3}>
              <Heading level={3}>{threads.find(thread => thread.id === sessionId)?.title ?? 'Coding Agent'}</Heading>
              {!isInspectorOpen
                ? <Button label="Inspector" variant="ghost" size="sm" onClick={() => setIsInspectorOpen(true)} />
                : null}
            </HStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={0}>
            <ChatLayout
              composer={composer}
              style={{height: '100%'}}
              emptyState={<ChatLanding onSuggestion={setTask} />}>
              {messages.length > 0 ? <VStack gap={5} padding={4} role="log" aria-live="polite">
                {messages.map((message, index) => (
                  <ChatMessage key={message.id} sender={message.sender} density="spacious">
                    {message.sender === 'assistant' && index === messages.length - 1
                      ? <AgentActivity
                          status={status}
                          turn={turn}
                          events={events}
                          tools={tools}
                          isOpen={activityOpen}
                          onOpenChange={setActivityOpen}
                        />
                      : null}
                    <ChatMessageBubble variant={message.sender === 'assistant' ? 'ghost' : 'filled'}>
                      {message.sender === 'assistant'
                        ? message.content
                          ? <Markdown
                              density="compact"
                              headingLevelStart={3}
                              contentWidth={720}
                              isStreaming={status === 'running' && index === messages.length - 1}>
                              {message.content}
                            </Markdown>
                          : <HStack gap={2} vAlign="center">
                              <StatusDot variant="accent" label="Agent working" isPulsing />
                              <Text type="body" color="secondary">Working…</Text>
                            </HStack>
                        : <Text as="p" type="body" textWrap="pretty">{message.content}</Text>}
                    </ChatMessageBubble>
                  </ChatMessage>
                ))}
              </VStack> : null}
            </ChatLayout>
          </LayoutContent>
        }
        end={isInspectorOpen ? inspector : undefined}
      />
      </AppShell>
      <CommandPalette
        isOpen={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        searchSource={searchSource}
        label="Search conversations and actions"
        emptySearchText="No conversations found"
        onValueChange={selectSearchItem}
        renderItem={(item: SearchItem) => (
          <HStack hAlign="between" gap={3} width="100%">
            <Text type="body">{item.label}</Text>
            <Text type="supporting" color="secondary">{item.auxiliaryData?.group}</Text>
          </HStack>
        )}
      />
    </>
  );
}

function AgentActivity({status, turn, events, tools, isOpen, onOpenChange}: {
  status: RunStatus;
  turn: number;
  events: AgentEvent[];
  tools: ToolRow[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const completed = tools.filter(tool => tool.observation !== undefined).length;
  const isRunning = status === 'running';
  const visibleEvents = events.filter(event => ['run_start', 'turn_start', 'run_end', 'run_error'].includes(event.type));
  const summary = isRunning
    ? `Working · turn ${Math.max(turn, 1)}`
    : `Processed ${turn} ${turn === 1 ? 'turn' : 'turns'} · ${completed} ${completed === 1 ? 'tool' : 'tools'}`;

  return (
    <Collapsible
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      trigger={
        <HStack gap={2} vAlign="center">
          <StatusDot
            variant={isRunning ? 'accent' : status === 'error' ? 'error' : status === 'stopped' ? 'warning' : 'success'}
            label={summary}
            isPulsing={isRunning}
          />
          <Text type="supporting" color="secondary">{summary}</Text>
        </HStack>
      }>
      <VStack gap={3} paddingBlock={2}>
        {tools.length > 0
          ? <ChatToolCalls calls={tools.map(tool => ({
              key: tool.id,
              name: tool.name,
              status: tool.observation === undefined ? 'running' : tool.isError ? 'error' : 'complete',
              target: toolTarget(tool.arguments),
              errorMessage: tool.isError ? tool.observation : undefined,
              data: tool.observation,
            }))} defaultIsExpanded={false} />
          : <Text type="supporting" color="secondary">Preparing context and selecting the next action.</Text>}
        {visibleEvents.length > 0 ? (
          <VStack gap={1}>
            {visibleEvents.slice(-5).map((event, index) => (
              <HStack key={`${event.type}-${index}`} gap={2} vAlign="center">
                <StatusDot variant={event.type === 'run_error' ? 'error' : 'neutral'} label={activityLabel(event)} />
                <Text type="supporting" color="secondary">{activityLabel(event)}</Text>
              </HStack>
            ))}
          </VStack>
        ) : null}
      </VStack>
    </Collapsible>
  );
}

function ChatLanding({onSuggestion}: {onSuggestion: (prompt: string) => void}) {
  return (
    <VStack gap={8} maxWidth={720} padding={4}>
      <VStack gap={1}>
        <Text type="large" color="secondary">Coding Agent</Text>
        <Text type="display-2" as="h1">Where should we start?</Text>
        <Text type="body" color="secondary">Ask for a focused code change, investigation, or test run inside the selected workspace.</Text>
      </VStack>
      <Grid columns={{minWidth: 200, repeat: 'fit'}} gap={3}>
        {landingSuggestions.map(suggestion => (
          <ClickableCard
            key={suggestion.title}
            label={suggestion.title}
            variant="muted"
            padding={3}
            onClick={() => onSuggestion(suggestion.prompt)}>
            <VStack gap={1}>
              <Heading level={4}>{suggestion.title}</Heading>
              <Text type="supporting" color="secondary">{suggestion.description}</Text>
            </VStack>
          </ClickableCard>
        ))}
      </Grid>
    </VStack>
  );
}

function ToolInspector({tools}: {tools: ToolRow[]}) {
  if (tools.length === 0) {
    return <EmptyState isCompact title="No tool calls yet" description="Reads, edits, searches, and tests will appear here while the agent works." />;
  }
  return (
    <List density="compact" hasDividers>
      {tools.map(tool => (
        <ListItem
          key={tool.id}
          label={tool.name}
          description={toolTarget(tool.arguments)}
          startContent={<StatusDot
            variant={tool.observation === undefined ? 'accent' : tool.isError ? 'error' : 'success'}
            label={tool.observation === undefined ? 'Running' : tool.isError ? 'Failed' : 'Complete'}
            isPulsing={tool.observation === undefined}
          />}
          endContent={<Text type="supporting" color="secondary">{tool.observation === undefined ? 'Running' : tool.isError ? 'Error' : 'Done'}</Text>}
        />
      ))}
    </List>
  );
}

function InspectorRow({label, value}: {label: string; value: string}) {
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary">{label}</Text>
      <Text type="code" textWrap="wrap">{value}</Text>
      <Divider />
    </VStack>
  );
}

function toolTarget(argumentsValue: unknown) {
  if (!argumentsValue || typeof argumentsValue !== 'object') return 'workspace';
  const record = argumentsValue as Record<string, unknown>;
  for (const key of ['path', 'command', 'query', 'pattern']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return 'workspace';
}

function activityLabel(event: AgentEvent) {
  if (event.type === 'run_start') return 'Started agent run';
  if (event.type === 'turn_start') return `Started turn ${event.turn ?? ''}`.trim();
  if (event.type === 'tool_execution_start') return `Running ${event.call?.name ?? 'tool'}`;
  if (event.type === 'tool_execution_end') return `${event.call?.name ?? 'Tool'} finished`;
  if (event.type === 'run_end') return 'Prepared final response';
  if (event.type === 'run_error') return event.error?.message ?? 'Run failed';
  return event.type.replaceAll('_', ' ');
}

function workspaceLabel(path: string) {
  const normalized = path.replace(/[\\/]+$/, '');
  const name = normalized.split(/[\\/]/).pop();
  return name ?? path;
}

async function consumeLines(stream: ReadableStream<Uint8Array>, receive: (envelope: Envelope) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const {done, value} = await reader.read();
    buffer += decoder.decode(value, {stream: !done});
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) receive(JSON.parse(line));
    if (done) break;
  }
  if (buffer.trim()) receive(JSON.parse(buffer));
}
