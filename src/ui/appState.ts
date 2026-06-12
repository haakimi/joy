import type { SlashCommand } from "../commands.js";

export type TabAction =
  | { handled: false }
  | { handled: true; input: string }
  | { handled: true; toggleLatestTool: true };

export function completeSlashInput(_input: string, command: Pick<SlashCommand, "name">): string {
  return `/${command.name} `;
}

export function getTabAction(args: {
  slashMode: boolean;
  matches: Array<Pick<SlashCommand, "name">>;
  pickerIdx: number;
  input: string;
  hasExpandableTool: boolean;
}): TabAction {
  if (args.slashMode && args.matches.length > 0) {
    const selected = args.matches[args.pickerIdx] ?? args.matches[0];
    return { handled: true, input: completeSlashInput(args.input, selected) };
  }

  if (args.hasExpandableTool) {
    return { handled: true, toggleLatestTool: true };
  }

  return { handled: false };
}

export function finishPendingTool(
  pendingToolIds: Map<string, string>,
  toolUseId: string,
): string | undefined {
  const itemId = pendingToolIds.get(toolUseId);
  if (itemId) pendingToolIds.delete(toolUseId);
  return itemId;
}

export function nextCwdAfterCommand(_previousCwd: string, currentCwd: string): string {
  return currentCwd;
}
