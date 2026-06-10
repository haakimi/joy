import React from "react";
import { Box, Text } from "ink";

interface Props {
  model: string;
  skillCount: number;
  cwd: string;
}

export default function Banner({ model, skillCount, cwd }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>joy</Text>
        <Text color="gray"> — {model}</Text>
        <Text color="gray"> · {skillCount} skills</Text>
        <Text color="gray"> · {shrinkPath(cwd)}</Text>
      </Box>
    </Box>
  );
}

function shrinkPath(p: string): string {
  const home = process.env.HOME || "";
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}
