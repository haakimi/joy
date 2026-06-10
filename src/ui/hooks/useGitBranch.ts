import { useEffect, useState } from "react";
import { spawn } from "node:child_process";

export function useGitBranch(cwd: string): string | undefined {
  const [branch, setBranch] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    const child = spawn("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.on("data", (d) => (buf += d.toString()));
    child.on("close", (code) => {
      if (cancelled) return;
      if (code === 0) setBranch(buf.trim());
      else setBranch(undefined);
    });
    child.on("error", () => {
      if (!cancelled) setBranch(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);
  return branch;
}
