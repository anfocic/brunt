import { readFileSync } from "node:fs";

export interface GitHubOptions {
  token: string;
  owner: string;
  repo: string;
}

export function githubOptionsFromEnv(): GitHubOptions | null {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const parts = repo.split("/");
  if (parts.length !== 2) return null;
  return { token, owner: parts[0], repo: parts[1] };
}

export function getPrNumberFromEvent(): number | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf-8"));
    return event.pull_request?.number || event.number || undefined;
  } catch {
    return undefined;
  }
}

export function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export async function upsertPrComment(
  gh: GitHubOptions,
  prNumber: number,
  marker: string,
  body: string
): Promise<void> {
  const existingId = await findComment(gh, prNumber, marker);
  if (existingId) {
    await updateComment(gh, existingId, body);
  } else {
    await createComment(gh, prNumber, body);
  }
}

export async function fileIssue(
  gh: GitHubOptions,
  title: string,
  body: string,
  labels: string[] = []
): Promise<boolean> {
  const exists = await issueExists(gh, title);
  if (exists) return false;
  await createIssue(gh, title, body, labels);
  return true;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
  };
}

async function findComment(gh: GitHubOptions, prNumber: number, marker: string): Promise<number | undefined> {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${gh.owner}/${gh.repo}/issues/${prNumber}/comments?per_page=100`,
      { headers: ghHeaders(gh.token) }
    );
    if (!resp.ok) return undefined;
    const comments = (await resp.json()) as { id: number; body?: string }[];
    return comments.find((c) => c.body?.includes(marker))?.id;
  } catch {
    return undefined;
  }
}

async function createComment(gh: GitHubOptions, prNumber: number, body: string): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/repos/${gh.owner}/${gh.repo}/issues/${prNumber}/comments`,
    { method: "POST", headers: ghHeaders(gh.token), body: JSON.stringify({ body }) }
  );
  if (!resp.ok) console.error(`  warning: failed to post PR comment (${resp.status})`);
}

async function updateComment(gh: GitHubOptions, commentId: number, body: string): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/repos/${gh.owner}/${gh.repo}/issues/comments/${commentId}`,
    { method: "PATCH", headers: ghHeaders(gh.token), body: JSON.stringify({ body }) }
  );
  if (!resp.ok) console.error(`  warning: failed to update PR comment (${resp.status})`);
}

async function issueExists(gh: GitHubOptions, title: string): Promise<boolean> {
  try {
    const query = encodeURIComponent(`repo:${gh.owner}/${gh.repo} is:open in:title "${title}"`);
    const resp = await fetch(
      `https://api.github.com/search/issues?q=${query}&per_page=1`,
      { headers: ghHeaders(gh.token) }
    );
    if (!resp.ok) return false;
    const data = (await resp.json()) as { total_count: number };
    return data.total_count > 0;
  } catch {
    return false;
  }
}

async function createIssue(gh: GitHubOptions, title: string, body: string, labels: string[]): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/repos/${gh.owner}/${gh.repo}/issues`,
    { method: "POST", headers: ghHeaders(gh.token), body: JSON.stringify({ title, body, labels }) }
  );
  if (!resp.ok) console.error(`  warning: failed to create issue (${resp.status})`);
}
