import React from "react";
import { Box, Text } from "ink";
import { getTheme, type Theme } from "./theme/theme.js";
import {
  describeToolCall,
  parseBashOutput,
  formatDuration,
} from "./toolFormat.js";

export type LogItem =
  | { kind: "user"; text: string; id: string; ts?: number }
  | { kind: "assistant"; text: string; id: string; isThinking?: boolean }
  | { kind: "turn"; n: number; id: string; model?: string; ts?: number }
  | { kind: "turnEnd"; n: number; id: string; tools: number; durationMs?: number; tokIn?: number; tokOut?: number }
  | { kind: "skills"; count: number; names: string[]; id: string }
  | {
      kind: "tool";
      name: string;
      input: unknown;            
      output?: string;
      isError?: boolean;
      pending?: boolean;
      id: string;
      startedAt?: number;        
      finishedAt?: number;       
    }
  | { kind: "info"; text: string; id: string }
  | { kind: "error"; text: string; id: string }
  | { kind: "stop"; reason: string; id: string }
  | {
      kind: "plan";
      plan: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
      explanation?: string;
      id: string;
    }
  | {
      kind: "compact";
      summary: string;
      savedTokens: number;
      id: string;
    }
  | {
      kind: "subagent";
      agentId: string;
      task: string;
      status: "running" | "done";
      result?: string;
      id: string;
    }
  | {
      kind: "banner";
      model: string;
      skillCount: number;
      cwd: string;
      id: string;
    };

const MAX_OUTPUT_LINES = 10;
const JOY_BANNER = [
  "      ██  ██████  ██    ██",
  "      ██ ██    ██  ██  ██ ",
  "      ██ ██    ██   ████  ",
  "██    ██ ██    ██    ██   ",
  " ██████   ██████     ██   ",
];

function clampLines(s: string, maxLines: number): {
  body: string;
  hidden: number;
  total: number;
} {
  const lines = s.split("\n");
  if (lines.length <= maxLines) {
    return { body: s, hidden: 0, total: lines.length };
  }
  return {
    body: lines.slice(0, maxLines).join("\n"),
    hidden: lines.length - maxLines,
    total: lines.length,
  };
}

export const LogView = React.memo(function LogView({ items }: { items: LogItem[] }) {
  const theme = getTheme();
  return (
    <Box flexDirection="column">
      {items.map((it) => (
        <LogRow key={it.id} item={it} theme={theme} />
      ))}
    </Box>
  );
});

export function LogRow({ item, theme }: { item: LogItem; theme: Theme }) {
  switch (item.kind) {
    case "turn":
      return <TurnHeader n={item.n} model={item.model} ts={item.ts} theme={theme} />;
    case "turnEnd":
      return <TurnFooter item={item} theme={theme} />;
    case "skills":
      return null; 
    case "user":
      return <Card label="you" icon="|" labelColor={theme.user} theme={theme} ts={item.ts}>
        <MessageBody text={item.text} theme={theme} />
      </Card>;
    case "assistant":
      return (
        <Card
          label={item.isThinking ? "joy · thinking" : "joy"}
          icon={item.isThinking ? "*" : ">"}
          labelColor={theme.assistant}
          theme={theme}
        >
          <MessageBody text={item.text} theme={theme} muted={item.isThinking} />
        </Card>
      );
    case "tool":
      return <ToolRow item={item} theme={theme} />;
    case "info":
      return (
        <Box>
          <Text color={theme.fgMuted}>  {item.text}</Text>
        </Box>
      );
    case "error":
      return (
        <Card label="error" icon="x" labelColor={theme.failure} theme={theme}>
          <Text color={theme.fg}>{item.text}</Text>
        </Card>
      );
    case "stop":
      return null; 
    case "plan":
      return <PlanRow item={item} theme={theme} />;
    case "compact":
      return <CompactRow item={item} theme={theme} />;
    case "subagent":
      return <SubagentRow item={item} theme={theme} />;
    case "banner":
      return <BannerRow item={item} theme={theme} />;
  }
}

function BannerRow({ item, theme }: { item: Extract<LogItem, { kind: "banner" }>; theme: Theme }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {JOY_BANNER.map((line, index) => (
          <Text key={index} color={theme.accent} bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box>
        <Text color={theme.fgMuted}>joy</Text>
        <Text color={theme.fgMuted}> · {item.model}</Text>
        <Text color={theme.fgMuted}> · {item.skillCount} skills</Text>
        <Text color={theme.fgMuted}> · {shrinkCwd(item.cwd)}</Text>
      </Box>
      <Box>
        <Text color={theme.fgFaint}>type / for commands · enter to chat</Text>
      </Box>
    </Box>
  );
}

function MessageBody({
  text,
  theme,
  muted = false,
}: {
  text: string;
  theme: Theme;
  muted?: boolean;
}) {
  if (muted) {
    return <Text color={theme.fgMuted}>{text}</Text>;
  }
  return (
    <Box flexDirection="column">
      {text.split("\n").map((line, index) => (
        <Text
          key={index}
          color={theme.messageFg}
          backgroundColor={theme.messageBg}
        >
          {` ${line || " "} `}
        </Text>
      ))}
    </Box>
  );
}

function shrinkCwd(p: string): string {
  const home = process.env.HOME || "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function SubagentRow({ item, theme }: { item: Extract<LogItem, { kind: "subagent" }>; theme: Theme }) {
  const isRunning = item.status === "running";
  return (
    <Box flexDirection="column">
      <Card
        label={isRunning ? "subagent" : "subagent done"}
        icon={isRunning ? ">" : "v"}
        labelColor={isRunning ? theme.accent : theme.success}
        theme={theme}
      >
        <Box flexDirection="column">
          <Box marginBottom={1}>
            {isRunning ? (
              <Box flexDirection="row">
                <Text color={theme.warn}>running {item.agentId}</Text>
              </Box>
            ) : (
              <Text color={theme.success}>done {item.agentId}</Text>
            )}
          </Box>
          {item.task && (
            <Box marginBottom={1}>
              <Text color={theme.fgMuted}>Task: {item.task}</Text>
            </Box>
          )}
          {item.result && (
            <Box flexDirection="column" paddingX={1}>
              {item.result.split("\n").map((line, i) => (
                <Text key={i} color={theme.fgMuted}>{line || " "}</Text>
              ))}
            </Box>
          )}
        </Box>
      </Card>
    </Box>
  );
}

function CompactRow({ item, theme }: { item: Extract<LogItem, { kind: "compact" }>; theme: Theme }) {
  return (
    <Box flexDirection="column">
      <Card label="compact" icon="-" labelColor={theme.warn} theme={theme}>
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.success}>
              Compressed context · saved ~{Math.round(item.savedTokens / 1000)}K tokens
            </Text>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            {item.summary.split("\n").map((line, i) => (
              <Text key={i} color={theme.fgMuted}>{line || " "}</Text>
            ))}
          </Box>
        </Box>
      </Card>
    </Box>
  );
}

function PlanRow({ item, theme }: { item: Extract<LogItem, { kind: "plan" }>; theme: Theme }) {
  return (
    <Box flexDirection="column">
      <Card label="plan" icon="-" labelColor={theme.accent} theme={theme}>
        {item.explanation && (
          <Box marginBottom={1}>
            <Text color={theme.fgMuted}>{item.explanation}</Text>
          </Box>
        )}
        <Box flexDirection="column">
          {item.plan.map((step, index) => (
            <Box key={index} marginTop={1} flexDirection="row" alignItems="center">
              <Box width={3} marginRight={1}>
                {step.status === "pending" && <Text color={theme.fgMuted}>o</Text>}
                {step.status === "in_progress" && <Text color={theme.warn}>&gt;</Text>}
                {step.status === "completed" && <Text color={theme.success}>v</Text>}
              </Box>
              <Text color={step.status === "completed" ? theme.fgMuted : theme.fg}>
                {step.step}
              </Text>
              {step.status === "in_progress" && (
                <Box marginLeft={1}><Text color={theme.warn}>(in progress)</Text></Box>
              )}
            </Box>
          ))}
        </Box>
      </Card>
    </Box>
  );
}

function TurnHeader({
  n, model, ts, theme,
}: { n: number; model?: string; ts?: number; theme: Theme }) {
  const time = ts ? new Date(ts) : new Date();
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  return (
    <Box>
      <Text color={theme.fgMuted}>-- </Text>
      <Text color={theme.fgMuted} bold>turn {n}</Text>
      {model && (
        <>
          <Text color={theme.fgMuted}>  ·  </Text>
          <Text color={theme.fgMuted}>{model}</Text>
        </>
      )}
      <Text color={theme.fgMuted}>  ·  </Text>
      <Text color={theme.fgFaint}>{hh}:{mm}</Text>
      <Text color={theme.fgMuted}> ---------</Text>
    </Box>
  );
}

function TurnFooter({
  item, theme,
}: {
  item: Extract<LogItem, { kind: "turnEnd" }>;
  theme: Theme;
}) {
  const dur = item.durationMs ? formatDuration(item.durationMs) : undefined;
  return (
    <Box>
      <Text color={theme.fgMuted}>-- </Text>
      <Text color={theme.fgMuted}>turn {item.n} done</Text>
      {item.tools > 0 && (
        <>
          <Text color={theme.fgMuted}>  ·  </Text>
          <Text color={theme.fgMuted}>{item.tools} tool{item.tools === 1 ? "" : "s"}</Text>
        </>
      )}
      {dur && (
        <>
          <Text color={theme.fgMuted}>  ·  </Text>
          <Text color={theme.fgMuted}>{dur}</Text>
        </>
      )}
      {(item.tokIn || item.tokOut) && (
        <>
          <Text color={theme.fgMuted}>  ·  </Text>
          <Text color={theme.fgMuted}>↑{item.tokIn ?? 0} ↓{item.tokOut ?? 0}</Text>
        </>
      )}
    </Box>
  );
}

function Card({
  label, icon, labelColor, theme, ts, children,
}: {
  label: string;
  icon: string;
  labelColor: string;
  theme: Theme;
  ts?: number;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={labelColor} bold>{icon} {label}</Text>
        {ts && (
          <>
            <Text color={theme.fgFaint}>  </Text>
            <Text color={theme.fgFaint}>{tsLabel(ts)}</Text>
          </>
        )}
      </Box>
      <Box paddingLeft={2}>{children}</Box>
    </Box>
  );
}

function tsLabel(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function ToolRow({
  item, theme,
}: { item: Extract<LogItem, { kind: "tool" }>; theme: Theme }) {
  const display = describeToolCall(item.name, item.input);
  const isBash = item.name === "bash";

  const dur = !item.pending && item.finishedAt && item.startedAt
      ? formatDuration(item.finishedAt - item.startedAt)
      : undefined;

  let exitInfo: { exit?: number; killed?: boolean; body: string } | undefined;
  let bodyForRender = item.output ?? "";
  if (item.output !== undefined && isBash) {
    exitInfo = parseBashOutput(item.output);
    bodyForRender = exitInfo.body;
  }

  let badge: React.ReactNode;
  if (item.pending) {
    badge = (
      <Text color={theme.warn} bold>running</Text>
    );
  } else if (item.isError) {
    const code = exitInfo?.exit !== undefined
      ? ` exit ${exitInfo.exit}`
      : exitInfo?.killed
        ? ` killed`
        : "";
    badge = (
      <Text color={theme.failure} bold>failed{code}</Text>
    );
  } else {
    const code = exitInfo?.exit === 0 ? "" : exitInfo?.exit !== undefined ? ` exit ${exitInfo.exit}` : "";
    badge = (
      <Text color={theme.success} bold>done{code}</Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.tool} bold>&gt; {item.name}</Text>
        {dur && (
          <>
            <Text color={theme.fgMuted}>  ·  </Text>
            <Text color={theme.fgMuted}>{dur}</Text>
          </>
        )}
        <Text color={theme.fgMuted}>  ·  </Text>
        {badge}
      </Box>

      <Box paddingLeft={2}>
        {display.headline ? (
          <Text color={theme.fg}>{display.headline}</Text>
        ) : null}
        {display.detail && (
          <Text color={theme.fgFaint}>  ({display.detail})</Text>
        )}
        {display.rawJson && !display.headline && (
          <Text color={theme.fgMuted}>{display.rawJson}</Text>
        )}
      </Box>

      {!item.pending && bodyForRender && bodyForRender.trim() && (
        <OutputPanel
          body={bodyForRender}
          isError={!!item.isError}
          theme={theme}
        />
      )}
    </Box>
  );
}

function OutputPanel({
  body, isError, theme,
}: { body: string; isError: boolean; theme: Theme }) {
  const { body: shown, hidden, total } = clampLines(body, MAX_OUTPUT_LINES);
  return (
    <Box paddingLeft={2} flexDirection="column">
      {shown.split("\n").map((line, i) => (
        <Text key={i} color={isError ? theme.failure : theme.fgMuted}>{line || " "}</Text>
      ))}
      {hidden > 0 && (
        <Text color={theme.fgFaint}>
          - {hidden} more lines -
        </Text>
      )}
    </Box>
  );
}
