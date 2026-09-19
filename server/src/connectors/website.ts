import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { config } from "../config";

export interface WebsiteUpdate {
  id: string;
  date: string;
  title: string;
  text: string;
  imageUrl?: string;
}

const MAX_ENTRIES = 20;

function updatesFilePath(): string {
  return path.resolve(__dirname, "..", "..", config.website.repoPath, "content", "updates.json");
}

export async function appendWebsiteUpdate(entry: WebsiteUpdate): Promise<void> {
  const file = updatesFilePath();
  let current: WebsiteUpdate[] = [];
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      current = [];
    }
  }
  current.unshift(entry);
  current = current.slice(0, MAX_ENTRIES);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2), "utf-8");

  if (config.website.autoGitPush) {
    const repoRoot = path.resolve(__dirname, "..", "..", config.website.repoPath);
    const git = simpleGit(repoRoot);
    await git.add(["content/updates.json"]);
    const status = await git.status();
    if (status.staged.length > 0) {
      await git.commit(`Add website update: ${entry.title}`);
      await git.push();
    }
  }
}
