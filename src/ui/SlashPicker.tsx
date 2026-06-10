import React from "react";
import { Box, Text } from "ink";
import type { SlashCommand } from "../commands.js";
import { getTheme } from "./theme/theme.js";

interface Props {
  matches: SlashCommand[];
  selected: number;
}

export default function SlashPicker({ matches, selected }: Props) {
  if (matches.length === 0) return null;
  const theme = getTheme();
  const w = Math.max(...matches.map((c) => c.name.length));
  const visible = matches.slice(0, 6);
  const overflow = matches.length - visible.length;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.borderIdle}
      paddingX={1}
    >
      <Box marginBottom={0}>
        <Text color={theme.fg} bold>{"  slash commands"}</Text>
        <Text color={theme.fgMuted}>  ({matches.length} match{matches.length === 1 ? "" : "es"})</Text>
      </Box>
      {visible.map((c, i) => {
        const active = i === selected;
        return (
          <Box key={c.name}>
            <Text
              color={active ? (theme.name === "dark" ? "black" : "white") : theme.fg}
              backgroundColor={active ? theme.fg : undefined}
              bold={active}
            >
              {active ? " > " : "   "}
              /{c.name.padEnd(w)}
              {" "}
            </Text>
            <Text color={theme.fgMuted}> {c.description}</Text>
          </Box>
        );
      })}
      {overflow > 0 && (
        <Text color={theme.fgMuted}>{"   "}... +{overflow} more</Text>
      )}
      <Box marginTop={0}>
        <Text color={theme.fgMuted}>{"   ↑↓"}</Text>
        <Text color={theme.fgMuted}> select </Text>
        <Text color={theme.fgMuted}>·</Text>
        <Text color={theme.fgMuted}> Tab</Text>
        <Text color={theme.fgMuted}> complete </Text>
        <Text color={theme.fgMuted}>·</Text>
        <Text color={theme.fgMuted}> Enter</Text>
        <Text color={theme.fgMuted}> run </Text>
        <Text color={theme.fgMuted}>·</Text>
        <Text color={theme.fgMuted}> Esc</Text>
        <Text color={theme.fgMuted}> cancel</Text>
      </Box>
    </Box>
  );
}
