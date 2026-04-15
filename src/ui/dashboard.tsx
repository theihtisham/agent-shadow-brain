// src/ui/dashboard.tsx — Ink/React terminal UI for Shadow Brain

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { Orchestrator } from '../brain/orchestrator.js';
import { BrainInsight, FileChange, AgentTool, BrainPersonality } from '../types.js';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'red',
  high: 'yellow',
  medium: 'blue',
  low: 'gray',
};

const TYPE_COLORS: Record<string, string> = {
  add: 'green',
  modify: 'yellow',
  delete: 'red',
  rename: 'cyan',
};

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// Header component
const Header: React.FC<{ personality: BrainPersonality }> = ({ personality }) => (
  <Box borderStyle="double" borderColor="magenta" paddingX={1}>
    <Text bold color="magenta"> SHADOW BRAIN </Text>
    <Text> | </Text>
    <Text color="cyan">v4.0.0</Text>
    <Text> | </Text>
    <Text color="green">[{personality}]</Text>
    <Text> | </Text>
    <Text dimColor>Press q to quit, p to pause</Text>
  </Box>
);

// Status bar
const StatusBar: React.FC<{
  running: boolean;
  uptime: number;
  agentCount: number;
  insightCount: number;
  personality: BrainPersonality;
}> = ({ running, uptime, agentCount, insightCount, personality }) => (
  <Box paddingX={1}>
    <Text bold>Status: </Text>
    <Text color={running ? 'green' : 'red'}>{running ? 'ACTIVE' : 'STOPPED'}</Text>
    <Text> | </Text>
    <Text>Uptime: <Text color="cyan">{formatUptime(uptime)}</Text></Text>
    <Text> | </Text>
    <Text>Agents: <Text color="green">{agentCount}</Text></Text>
    <Text> | </Text>
    <Text>Insights: <Text color="yellow">{insightCount}</Text></Text>
    <Text> | </Text>
    <Text>Mode: <Text color="magenta">{personality}</Text></Text>
  </Box>
);

// Agent panel
const AgentPanel: React.FC<{ agents: string[] }> = ({ agents }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">AGENTS</Text>
    <Box flexDirection="column">
      {agents.length > 0 ? agents.map((agent, i) => (
        <Box key={i}>
          <Text color="green"> [ACTIVE] </Text>
          <Text>{agent}</Text>
        </Box>
      )) : (
        <Text dimColor> No agents detected</Text>
      )}
    </Box>
  </Box>
);

// Changes panel
const ChangesPanel: React.FC<{ changes: FileChange[] }> = ({ changes }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">FILE CHANGES ({changes.length})</Text>
    <Box flexDirection="column">
      {changes.slice(-8).map((change, i) => (
        <Box key={i}>
          <Text color={TYPE_COLORS[change.type] || 'white'}>
            {` ${change.type.toUpperCase().padEnd(8)}`}
          </Text>
          <Text>{change.path}</Text>
        </Box>
      ))}
      {changes.length > 8 && <Text dimColor> ... and {changes.length - 8} more</Text>}
    </Box>
  </Box>
);

// Insights panel
const InsightsPanel: React.FC<{ insights: BrainInsight[] }> = ({ insights }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">INSIGHTS ({insights.length})</Text>
    <Box flexDirection="column">
      {insights.slice(-5).map((insight, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={PRIORITY_COLORS[insight.priority] || 'white'} bold>
              {` [${insight.priority.toUpperCase()}] `}
            </Text>
            <Text bold>{insight.title}</Text>
          </Box>
          {insight.files && insight.files.length > 0 && (
            <Text dimColor>{`   Files: ${insight.files.join(', ')}`}</Text>
          )}
          <Text dimColor>{`   ${insight.type} | ${insight.priority}`}</Text>
        </Box>
      ))}
      {insights.length > 5 && (
        <Text dimColor> ... and {insights.length - 5} more</Text>
      )}
    </Box>
  </Box>
);

// Log panel
const LogPanel: React.FC<{ logs: string[] }> = ({ logs }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">LOG</Text>
    <Box flexDirection="column">
      {logs.slice(-6).map((log, i) => (
        <Text key={i} dimColor>{` ${log}`}</Text>
      ))}
    </Box>
  </Box>
);

// v4.0.0 Hyper-Intelligence Status Panel
const V4StatusPanel: React.FC<{
  turboEntries: number;
  turboCompression: string;
  evolutionGen: number;
  swarmConvergence: string;
  kgEntities: number;
}> = ({ turboEntries, turboCompression, evolutionGen, swarmConvergence, kgEntities }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color="magenta">V4.0.0 HYPER-INTELLIGENCE</Text>
    <Box flexDirection="column">
      <Box>
        <Text color="cyan"> TurboQuant: </Text>
        <Text>{turboEntries} entries | {turboCompression} compressed</Text>
      </Box>
      <Box>
        <Text color="cyan"> Self-Evolution: </Text>
        <Text>Generation {evolutionGen}</Text>
      </Box>
      <Box>
        <Text color="cyan"> Swarm: </Text>
        <Text>Convergence {swarmConvergence}</Text>
      </Box>
      <Box>
        <Text color="cyan"> Knowledge Graph: </Text>
        <Text>{kgEntities} entities</Text>
      </Box>
    </Box>
  </Box>
);

// Main Dashboard
const Dashboard: React.FC<{
  orchestrator: Orchestrator;
  onQuit: () => void;
}> = ({ orchestrator, onQuit }) => {
  const { exit } = useApp();
  const [running, setRunning] = useState(true);
  const [paused, setPaused] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [insights, setInsights] = useState<BrainInsight[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [uptime, setUptime] = useState(0);
  const [personality, setPersonality] = useState<BrainPersonality>('balanced');
  // v4.0.0 state
  const [turboEntries, setTurboEntries] = useState(0);
  const [turboCompression, setTurboCompression] = useState('N/A');
  const [evolutionGen, setEvolutionGen] = useState(0);
  const [swarmConvergence, setSwarmConvergence] = useState('N/A');
  const [kgEntities, setKgEntities] = useState(0);

  // Subscribe to orchestrator events
  useEffect(() => {
    const addLog = (msg: string) => {
      const time = new Date().toLocaleTimeString();
      setLogs(prev => [...prev.slice(-20), `${time} ${msg}`]);
    };

    orchestrator.on('started', () => { setRunning(true); addLog('Shadow Brain started'); });
    orchestrator.on('stopped', () => { setRunning(false); addLog('Shadow Brain stopped'); });
    orchestrator.on('agents-detected', ({ adapters }: any) => {
      setAgents(adapters.map((a: any) => `${a.displayName} (${a.name})`));
      addLog(`Detected ${adapters.length} agent(s)`);
    });
    orchestrator.on('analysis-start', ({ changeCount }: any) => {
      addLog(`Analyzing ${changeCount} change(s)...`);
    });
    orchestrator.on('insights', ({ insights: newInsights }: any) => {
      setInsights(prev => [...prev, ...newInsights].slice(-50));
      addLog(`Generated ${newInsights.length} insight(s)`);
    });
    orchestrator.on('injection', ({ adapter, success }: any) => {
      addLog(`${success ? 'Injected' : 'Failed to inject'} into ${adapter}`);
    });
    orchestrator.on('info', ({ message }: any) => {
      addLog(message);
    });
    orchestrator.on('error', ({ error }: any) => {
      addLog(`Error: ${error.message}`);
    });

    // Get initial status
    const status = orchestrator.getStatus();
    setPersonality(status.personality);
    setUptime(status.uptime);

    // Update uptime every second + v4.0.0 stats
    const interval = setInterval(() => {
      const s = orchestrator.getStatus();
      setUptime(s.uptime);
      // v4.0.0 stats
      const turbo = s.turboMemoryStats as any;
      if (turbo) {
        setTurboEntries(turbo.totalEntries ?? 0);
        setTurboCompression(turbo.compressionRatio ? `${(turbo.compressionRatio * 100).toFixed(1)}%` : 'N/A');
      }
      setEvolutionGen(s.evolutionGeneration ?? 0);
      setSwarmConvergence(typeof s.swarmConvergence === 'number' ? s.swarmConvergence.toFixed(3) : 'N/A');
      setKgEntities(s.knowledgeGraphEntities ?? 0);
    }, 1000);

    return () => clearInterval(interval);
  }, [orchestrator]);

  // Key handling
  useInput((input: string) => {
    if (input === 'q') {
      orchestrator.stop();
      setRunning(false);
      setTimeout(() => { exit(); onQuit(); }, 100);
    }
    if (input === 'p') {
      setPaused(prev => !prev);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header personality={personality} />
      <StatusBar
        running={running && !paused}
        uptime={uptime}
        agentCount={agents.length}
        insightCount={insights.length}
        personality={personality}
      />
      {paused && <Text color="yellow" bold>  [PAUSED]</Text>}
      <AgentPanel agents={agents} />
      <ChangesPanel changes={changes} />
      <InsightsPanel insights={insights} />
      <V4StatusPanel
        turboEntries={turboEntries}
        turboCompression={turboCompression}
        evolutionGen={evolutionGen}
        swarmConvergence={swarmConvergence}
        kgEntities={kgEntities}
      />
      <LogPanel logs={logs} />
    </Box>
  );
};

export function renderDashboard(orchestrator: Orchestrator): Promise<void> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <Dashboard orchestrator={orchestrator} onQuit={() => {
        unmount();
        resolve();
      }} />
    );
  });
}
