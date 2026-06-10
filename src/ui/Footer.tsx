import React from "react";
import { Box, Text } from "ink";
import { getTheme } from "./theme/theme.js";

interface Props {
  cwd: string;
  branch?: string;
  model: string;
  skillsCount: number;
  thinking: boolean;
  tokensIn: number;
  tokensOut: number;
  /** Optional max context window; used to render "x%". */
  contextMax?: number;
}

function shrink(p: string): string {
  const home = process.env.HOME || "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  if (p.length > 36) return "..." + p.slice(-33);
  return p;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export default function Footer({
  cwd,
  branch,
  model,
  skillsCount,
  thinking,
  tokensIn,
  tokensOut,
  contextMax = 200_000,
}: Props) {
  const theme = getTheme();
  const total = tokensIn + tokensOut;
  const pct = contextMax > 0 ? Math.min(100, (total / contextMax) * 100) : 0;
  const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);

  return (
    <Box marginTop={1}>
      <Box marginRight={1}>
        {thinking ? (
          <>
            <Text color={theme.fgMuted} bold>{"thinking "}</Text>
          </>
        ) : (
          <>
            <Text color={theme.fgMuted}>o</Text>
            <Text color={theme.fgMuted} bold>{" ready "}</Text>
          </>
        )}
      </Box>

      <Segment color={theme.fgMuted}>{shrink(cwd)}</Segment>
      {branch && <Segment color={theme.fgMuted}>{`⎇ ${branch}`}</Segment>}
      <Segment color={theme.fgMuted}>{model}</Segment>
      <Segment color={theme.fgMuted}>{`skills ${skillsCount}`}</Segment>
      <Segment color={theme.fgMuted}>
        {`↑${fmtTokens(tokensIn)} ↓${fmtTokens(tokensOut)} (${pctStr}%)`}
      </Segment>
    </Box>
  );
}

function Segment({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <Box marginRight={1}>
      <Text color="gray">│ </Text>
      <Text color={color as any}>{children}</Text>
    </Box>
  );
}
