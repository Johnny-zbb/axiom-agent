import {useEffect, useMemo, useRef, useState} from 'react';
import {Brain, ChevronRight, MessageSquare, Plus, Search, SendHorizonal, Settings, Square, Wrench} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {Dialog, DialogContent} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

type RunStatus = 'idle' | 'running' | 'complete' | 'stopped' | 'error';
type InspectorTab = 'tools' | 'run' | 'settings';
type ToolRow = {id: string; name: string; arguments: unknown; observation?: string; isError?: boolean};
type ChatRow = {id: string; sender: 'user' | 'assistant'; content: string; thinking?: string};
type ThreadRow = {id: string; title: string; detail: string};
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
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('tools');
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [error, setError] = useState<string>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => document.documentElement.classList.toggle('dark', media.matches);
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, []);

  useEffect(() => {
    void fetch(`${apiBase}/api/health`)
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [messages, status]);

  const statusDetail = statusDetails[status];
  const completedTools = useMemo(() => tools.filter(tool => tool.observation !== undefined).length, [tools]);

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
    const assistantMessage: ChatRow = {id: crypto.randomUUID(), sender: 'assistant', content: '', thinking: ''};
    setTask('');
    setStatus('running');
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
      const response = await fetch(`${apiBase}/api/runs`, {
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
      if (envelope.error === 'Stopped by user.') setStatus('stopped');
      else {
        setStatus('error');
        setError(envelope.error);
      }
      return;
    }
    if (envelope.type === 'complete') {
      setStatus('complete');
      setThreads(previous => previous.map(thread => thread.id === sessionId ? {...thread, detail: 'Completed'} : thread));
      return;
    }
    const event = envelope.event;
    if (event.type !== 'message_update' && event.type !== 'reasoning_update') {
      setEvents(previous => [...previous, event].slice(-80));
    }
    if (event.type === 'turn_start' && event.turn) setTurn(event.turn);
    if (event.type === 'reasoning_update' && event.delta) {
      setMessages(previous => previous.map(message => message.id === assistantMessageId
        ? {...message, thinking: (message.thinking ?? '') + event.delta}
        : message));
    }
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
      setError(event.error?.message ?? 'Agent run failed.');
    }
  }

  async function stopAgent() {
    if (!runId) return;
    setStatus('stopped');
    await fetch(`${apiBase}/api/runs/${runId}/cancel`, {method: 'POST'}).catch(() => undefined);
  }

  const inspector = (
    <aside className="flex h-full w-80 shrink-0 flex-col bg-muted/40">
      <div className="flex items-center justify-between gap-2 p-4 pb-2">
        <h3 className="text-sm font-semibold">Inspector</h3>
        <Button variant="ghost" size="sm" onClick={() => setIsInspectorOpen(false)}>Hide</Button>
      </div>
      <Tabs value={inspectorTab} onValueChange={value => setInspectorTab(value as InspectorTab)} className="flex min-h-0 flex-1 flex-col">
        <div className="px-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="tools">Tools <Badge variant="secondary" className="ml-1">{completedTools}/{tools.length}</Badge></TabsTrigger>
            <TabsTrigger value="run">Run</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {status === 'running' ? <div className="px-4 pt-3"><IndeterminateBar /></div> : null}
          <div className="space-y-4 p-4">
            {inspectorTab === 'tools' ? <ToolInspector tools={tools} /> : null}
            {inspectorTab === 'run' ? (
              <div className="space-y-4">
                <InspectorRow label="Status" value={statusDetail.label} />
                <InspectorRow label="Turn" value={String(turn)} />
                <InspectorRow label="Session" value={sessionId} />
                <InspectorRow label="Trace" value={traceRunId ?? 'Starts with the next run'} />
                <InspectorRow label="Events" value={String(events.length)} />
              </div>
            ) : null}
            {inspectorTab === 'settings' ? (
              <div className="space-y-5">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium">Workspace safety</h4>
                  <p className="text-sm leading-relaxed text-muted-foreground">File tools stay bounded to the workspace selected in the sidebar.</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Model</p>
                  <p className="font-mono text-xs">{model}</p>
                </div>
                <Alert>
                  <AlertTitle>Local-first</AlertTitle>
                  <AlertDescription>The provider key stays in the sidecar process. File tools remain bounded to the selected workspace.</AlertDescription>
                </Alert>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </Tabs>
    </aside>
  );

  return (
    <SidebarProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar>
          <SidebarHeader className="gap-3">
            <div className="flex items-center gap-2 px-1">
              <span className="h-2.5 w-2.5 rounded-full bg-copper" aria-hidden />
              <h2 className="text-base font-semibold tracking-tight">Axiom Agent</h2>
            </div>
            <Select
              value={isCustomWorkspace ? '__custom__' : workspace}
              onValueChange={value => {
                if (value === '__custom__') setIsCustomWorkspace(true);
                else {
                  setIsCustomWorkspace(false);
                  setWorkspace(value ?? '');
                }
              }}
              disabled={status === 'running'}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Choose a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaceChoices.map(choice => (
                  <SelectItem key={choice.value} value={choice.value} className="text-xs">{choice.label}</SelectItem>
                ))}
                <SelectItem value="__custom__" className="text-xs">Custom workspace</SelectItem>
              </SelectContent>
            </Select>
            {isCustomWorkspace
              ? <Input
                  value={workspace}
                  onChange={event => setWorkspace(event.target.value)}
                  placeholder="Absolute path"
                  disabled={status === 'running'}
                  className="h-8 text-xs"
                />
              : null}
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={newChat} disabled={status === 'running'}>
                      <Plus /> <span>New chat</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setIsSearchOpen(true)}>
                      <Search /> <span>Search</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Recent conversations</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {threads.map(thread => (
                    <SidebarMenuItem key={thread.id}>
                      <SidebarMenuButton isActive={thread.id === sessionId} onClick={() => selectThread(thread.id)}>
                        <MessageSquare />
                        <span className="truncate">{thread.title}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{thread.detail}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => {
                  setInspectorTab('settings');
                  setIsInspectorOpen(true);
                }}>
                  <Settings /> <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-13 shrink-0 items-center px-5">
            <h3 className="truncate text-sm font-medium">
              {threads.find(thread => thread.id === sessionId)?.title ?? 'Coding Agent'}
            </h3>
            <div className="ml-auto flex items-center gap-2">
              {status !== 'idle' ? <span className="text-xs text-muted-foreground">{statusDetail.label}</span> : null}
              {!isInspectorOpen
                ? <Button variant="ghost" size="sm" onClick={() => setIsInspectorOpen(true)}>Inspector</Button>
                : null}
            </div>
          </header>

          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6" role="log" aria-live="polite">
              {messages.length === 0
                ? <ChatLanding onSuggestion={setTask} />
                : messages.map((message, index) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      isLast={index === messages.length - 1}
                      status={status}
                      turn={turn}
                      tools={tools}
                    />
                  ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="shrink-0 bg-background">
            <div className="mx-auto w-full max-w-3xl px-5 pb-5 pt-2">
              {error ? (
                <Alert variant="destructive" className="mb-3">
                  <AlertTitle>Run failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Composer
                value={task}
                onChange={setTask}
                onSubmit={value => void runAgent(value)}
                onStop={() => void stopAgent()}
                isRunning={status === 'running'}
                isDisabled={!configured}
                model={model}
              />
            </div>
          </div>
        </main>

        {isInspectorOpen ? inspector : null}
      </div>

      <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <DialogContent className="overflow-hidden p-0">
          <Command>
            <CommandInput placeholder="Search conversations and actions" />
            <CommandList>
              <CommandEmpty>No conversations found</CommandEmpty>
              <CommandGroup heading="Actions">
                <CommandItem onSelect={() => selectSearchItem('__new__')}>
                  <Plus /> New chat
                </CommandItem>
                <CommandItem onSelect={() => selectSearchItem('__settings__')}>
                  <Settings /> Settings
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Conversations">
                {threads.map(thread => (
                  <CommandItem key={thread.id} onSelect={() => selectSearchItem(thread.id)}>
                    <MessageSquare /> <span className="truncate">{thread.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}

function MessageRow({message, isLast, status, turn, tools}: {
  message: ChatRow;
  isLast: boolean;
  status: RunStatus;
  turn: number;
  tools: ToolRow[];
}) {
  if (message.sender === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }
  const isRunning = status === 'running' && isLast;
  const hasThinking = Boolean(message.thinking?.trim());
  const hasTools = tools.length > 0;
  const hasContent = Boolean(message.content);
  return (
    <div className="flex flex-col gap-3">
      {hasThinking || (isRunning && !hasContent) ? (
        <ThinkingSection thinking={message.thinking ?? ''} isRunning={isRunning} />
      ) : null}
      {isLast && hasTools ? <ToolsSection tools={tools} /> : null}
      {hasContent
        ? <MarkdownRenderer content={message.content} />
        : isRunning && !hasThinking
          ? <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-copper" />
              Working{turn > 0 ? ` · turn ${turn}` : ''}…
            </div>
          : null}
    </div>
  );
}

function ThinkingSection({thinking, isRunning}: {thinking: string; isRunning: boolean}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="max-w-full">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
          <Brain className="h-3.5 w-3.5" />
          <span className="font-medium">Thinking</span>
          {isRunning ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-copper" /> : null}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {thinking
          ? <pre className="max-h-72 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {thinking}
            </pre>
          : <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-copper" />
              Thinking…
            </div>}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolsSection({tools}: {tools: ToolRow[]}) {
  return (
    <div className="flex flex-col gap-1.5">
      {tools.map(tool => (
        <ToolCallRow key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolCallRow({tool}: {tool: ToolRow}) {
  const done = tool.observation !== undefined;
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 text-sm">
      <Wrench className={cn('h-3.5 w-3.5 shrink-0', done ? (tool.isError ? 'text-destructive' : 'text-copper') : 'text-muted-foreground')} />
      <span className="font-medium">{tool.name}</span>
      <span className="truncate font-mono text-xs text-muted-foreground">{toolTarget(tool.arguments)}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {tool.isError ? <span className="text-xs text-destructive">Failed</span> : null}
        <StatusDot variant={done ? (tool.isError ? 'error' : 'success') : 'accent'} isPulsing={!done} />
        <span className="text-xs text-muted-foreground">{done ? (tool.isError ? 'Error' : 'Done') : 'Running'}</span>
      </span>
    </div>
  );
}

function Composer({value, onChange, onSubmit, onStop, isRunning, isDisabled, model}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onStop: () => void;
  isRunning: boolean;
  isDisabled: boolean;
  model: string;
}) {
  function submit() {
    if (isRunning || isDisabled || !value.trim()) return;
    onSubmit(value);
  }
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
      className="rounded-2xl bg-card p-3 shadow-[0_1px_2px_rgba(32,31,29,0.04),0_10px_30px_-18px_rgba(32,31,29,0.25)]">
      <Textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Ask the agent to inspect, change, or test code…"
        disabled={isDisabled}
        className="min-h-24 max-h-48 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        autoFocus
      />
      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs text-muted-foreground">{model} · local workspace</p>
        {isRunning
          ? <Button type="button" variant="destructive" size="sm" onClick={onStop}><Square /> Stop</Button>
          : <Button type="submit" size="sm" disabled={isDisabled || !value.trim()}><SendHorizonal /> Send</Button>}
      </div>
    </form>
  );
}

function ChatLanding({onSuggestion}: {onSuggestion: (prompt: string) => void}) {
  return (
    <div className="flex flex-col items-center gap-8 py-16 text-center">
      <div className="space-y-2">
        <div className="mx-auto mb-4 flex h-8 w-8 items-center justify-center rounded-xl bg-copper/15">
          <span className="h-2.5 w-2.5 rounded-full bg-copper" />
        </div>
        <h1 className="text-3xl font-medium tracking-tight">Where should we start?</h1>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          Ask for a focused code change, investigation, or test run inside the selected workspace.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {landingSuggestions.map(suggestion => (
          <button
            key={suggestion.title}
            onClick={() => onSuggestion(suggestion.prompt)}
            title={suggestion.description}
            className="rounded-full bg-secondary/70 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
            {suggestion.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolInspector({tools}: {tools: ToolRow[]}) {
  if (tools.length === 0) {
    return (
      <div className="rounded-lg bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        No tool calls yet. Reads, edits, searches, and tests will appear here while the agent works.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {tools.map(tool => (
        <div key={tool.id} className="rounded-lg bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <StatusDot
              variant={tool.observation === undefined ? 'accent' : tool.isError ? 'error' : 'success'}
              isPulsing={tool.observation === undefined}
            />
            <span className="font-medium">{tool.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{toolTarget(tool.arguments)}</span>
          </div>
          {tool.observation !== undefined ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap">
              {tool.observation}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function InspectorRow({label, value}: {label: string; value: string}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-xs break-all">{value}</p>
    </div>
  );
}

function StatusDot({variant, isPulsing}: {variant: 'neutral' | 'accent' | 'success' | 'warning' | 'error'; isPulsing?: boolean}) {
  const classes = {
    neutral: 'bg-muted-foreground/60',
    accent: 'bg-copper',
    success: 'bg-emerald-600 dark:bg-emerald-400',
    warning: 'bg-amber-500',
    error: 'bg-destructive',
  } as const;
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', classes[variant], isPulsing && 'animate-pulse')}
      aria-hidden
    />
  );
}

function IndeterminateBar() {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-copper" />
    </div>
  );
}

function MarkdownRenderer({content}: {content: string}) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
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
