import {useMemo, useState} from 'react';

import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {Layout, LayoutContent, HStack, VStack} from '@astryxdesign/core/Layout';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Heading, Text} from '@astryxdesign/core/Text';

type EvalTask = {
  id: string;
  title: string;
  durationMs: number;
  turns: number;
  toolCalls: number;
  focus: string;
};

const tasks: EvalTask[] = [
  {id: 'fix-clamp-boundaries', title: 'Clamp boundaries', durationMs: 13571, turns: 5, toolCalls: 5, focus: 'Boundary logic'},
  {id: 'implement-sum', title: 'Implement sum', durationMs: 7438, turns: 5, toolCalls: 5, focus: 'Missing implementation'},
  {id: 'normalize-profile', title: 'Normalize profile', durationMs: 9464, turns: 5, toolCalls: 8, focus: 'Cross-module behavior'},
  {id: 'repair-retry', title: 'Repair retry', durationMs: 8717, turns: 5, toolCalls: 6, focus: 'Async control flow'},
  {id: 'validate-port', title: 'Validate port', durationMs: 9917, turns: 5, toolCalls: 5, focus: 'Input validation'},
];

const traceSteps = [
  ['run_start', 'Core created the run and attached the persisted Session.'],
  ['turn_start', 'Context Builder projected messages and Coding Agent tools.'],
  ['tool_execution_start', 'The model inspected the copied fixture workspace.'],
  ['tool_execution_end', 'Tool Runtime returned a bounded observation.'],
  ['run_end', 'Independent verifier passed; immutable tests were unchanged.'],
] as const;

function Metric({label, value, detail}: {label: string; value: string; detail: string}) {
  return (
    <Card minHeight={128}>
      <VStack gap={2}>
        <Text type="supporting" color="secondary">{label}</Text>
        <Text type="display-2" as="p" hasTabularNumbers>{value}</Text>
        <Text type="supporting" color="secondary">{detail}</Text>
      </VStack>
    </Card>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState(tasks[0].id);
  const selected = useMemo(
    () => tasks.find(task => task.id === selectedId) ?? tasks[0],
    [selectedId],
  );

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={6} isScrollable>
          <VStack gap={6} maxWidth={1280}>
            <VStack gap={2}>
              <HStack hAlign="between" vAlign="center" gap={4} wrap="wrap">
                <VStack gap={1}>
                  <HStack gap={2} vAlign="center">
                    <StatusDot variant="success" label="Evaluation complete" />
                    <Text type="label" color="secondary">AXIOM AGENT / EVALUATION</Text>
                  </HStack>
                  <Heading level={1}>Coding Agent baseline</Heading>
                </VStack>
                <HStack gap={2} vAlign="center">
                  <Badge variant="neutral" label="deepseek-v4-flash" />
                  <Badge variant="success" label="5 / 5 passed" />
                </HStack>
              </HStack>
              <Text type="body" color="secondary">
                Real Token Rhythm run · isolated workspaces · independent verifiers · JSONL Session and Trace artifacts
              </Text>
            </VStack>

            <Grid columns={{minWidth: 220, repeat: 'fit'}} gap={4}>
              <Metric label="Pass rate" value="100%" detail="All five fixed tasks passed" />
              <Metric label="Model turns" value="25" detail="Five turns per task" />
              <Metric label="Tool calls" value="29" detail="Read, write, search, test" />
              <Metric label="Wall time" value="49.1s" detail="Sum of task durations" />
            </Grid>

            <Card>
              <VStack gap={4}>
                <HStack hAlign="between" vAlign="center" gap={4} wrap="wrap">
                  <VStack gap={1}>
                    <Heading level={3}>Task results</Heading>
                    <Text type="supporting" color="secondary">Select a row to inspect its runtime path.</Text>
                  </VStack>
                  <ProgressBar value={5} max={5} label="Passed tasks" hasValueLabel variant="success" />
                </HStack>
                <Divider />
                <VStack gap={0}>
                  {tasks.map((task, index) => (
                    <VStack key={task.id} gap={0}>
                      <HStack hAlign="between" vAlign="center" gap={4} paddingBlock={2} wrap="wrap">
                        <HStack gap={3} vAlign="center">
                          <StatusDot variant="success" label={`${task.title} passed`} />
                          <Button
                            label={`Inspect ${task.title}`}
                            variant={selectedId === task.id ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setSelectedId(task.id)}>
                            {task.title}
                          </Button>
                        </HStack>
                        <HStack gap={4} vAlign="center">
                          <Text type="supporting" color="secondary">{task.focus}</Text>
                          <Text type="code" hasTabularNumbers>{(task.durationMs / 1000).toFixed(1)}s</Text>
                          <Badge variant="neutral" label={`${task.toolCalls} tools`} />
                        </HStack>
                      </HStack>
                      {index < tasks.length - 1 ? <Divider /> : null}
                    </VStack>
                  ))}
                </VStack>
              </VStack>
            </Card>

            <Grid columns={{minWidth: 360, repeat: 'fit'}} gap={4}>
              <Card>
                <VStack gap={4}>
                  <VStack gap={1}>
                    <Text type="supporting" color="secondary">SELECTED TASK</Text>
                    <Heading level={3}>{selected.title}</Heading>
                    <Text type="code" color="secondary">{selected.id}</Text>
                  </VStack>
                  <Divider />
                  <Grid columns={2} gap={4}>
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">Turns</Text>
                      <Text type="display-2" hasTabularNumbers>{selected.turns}</Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">Tool calls</Text>
                      <Text type="display-2" hasTabularNumbers>{selected.toolCalls}</Text>
                    </VStack>
                  </Grid>
                  <ProgressBar
                    value={selected.durationMs}
                    max={15000}
                    label="Duration against 15s reference"
                    hasValueLabel
                    formatValueLabel={value => `${(value / 1000).toFixed(1)}s`}
                    variant="accent"
                  />
                  <Badge variant="success" label="Verifier passed · immutable files unchanged" />
                </VStack>
              </Card>

              <Card>
                <VStack gap={4}>
                  <VStack gap={1}>
                    <Text type="supporting" color="secondary">EVENT STREAM</Text>
                    <Heading level={3}>Runtime path</Heading>
                  </VStack>
                  <Divider />
                  <VStack gap={3}>
                    {traceSteps.map(([event, description], index) => (
                      <HStack key={event} gap={3} vAlign="start">
                        <StatusDot
                          variant={index === traceSteps.length - 1 ? 'success' : 'accent'}
                          label={event}
                          isPulsing={false}
                        />
                        <VStack gap={1}>
                          <Text type="code">{event}</Text>
                          <Text type="supporting" color="secondary">{description}</Text>
                        </VStack>
                      </HStack>
                    ))}
                  </VStack>
                </VStack>
              </Card>
            </Grid>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
