import assert from "node:assert/strict";
import test from "node:test";

import type { SlashCommand } from "../src/commands.ts";
import {
  completeSlashInput,
  finishPendingTool,
  getTabAction,
  nextCwdAfterCommand,
} from "../src/ui/appState.ts";

const command = (name: string): SlashCommand => ({
  name,
  description: `${name} command`,
  run: async () => ({}),
});

test("Tab completes the selected slash command instead of toggling tools", () => {
  const matches = [command("model")];

  assert.deepEqual(
    getTabAction({
      slashMode: true,
      matches,
      pickerIdx: 0,
      input: "/mo",
      hasExpandableTool: true,
    }),
    { handled: true, input: "/model " },
  );
});

test("Tab toggles the latest tool only outside slash completion", () => {
  assert.deepEqual(
    getTabAction({
      slashMode: false,
      matches: [],
      pickerIdx: 0,
      input: "",
      hasExpandableTool: true,
    }),
    { handled: true, toggleLatestTool: true },
  );
});

test("slash completion preserves already complete command text", () => {
  assert.equal(completeSlashInput("/model", command("model")), "/model ");
});

test("finishing a pending tool removes the tool-use id key", () => {
  const pending = new Map<string, string>([["toolu_1", "item_1"]]);

  assert.equal(finishPendingTool(pending, "toolu_1"), "item_1");
  assert.equal(pending.has("toolu_1"), false);
});

test("cwd state follows process cwd after a slash command changes it", () => {
  assert.equal(nextCwdAfterCommand("/old/path", "/new/path"), "/new/path");
});
