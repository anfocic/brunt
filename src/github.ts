import { exec } from "./util.ts";
import type { Finding, VectorReport } from "./vectors/types.ts";

type ReviewComment = {
  path: string;
  line: number;
  body: string;
};

function buildCommentBody(finding: Finding, vectorName: string): string {
  const severity = finding.severity.toUpperCase();
  return [
    `**[brunt/${vectorName}] ${severity}: ${finding.title}**`,
    "",
    finding.description,
    "",
    `**Reproduction:** ${finding.reproduction}`,
  ].join("\n");
}

function buildReviewBody(vectorReports: VectorReport[]): string {
  const total = vectorReports.reduce((sum, v) => sum + v.findings.length, 0);
  if (total === 0) {
    return "**brunt** found no issues.";
  }

  const lines = [`**brunt** found **${total}** issue${total === 1 ? "" : "s"}:`, ""];
  for (const vr of vectorReports) {
    if (vr.findings.length === 0) continue;
    lines.push(`- **${vr.name}**: ${vr.findings.length} finding${vr.findings.length === 1 ? "" : "s"}`);
  }
  return lines.join("\n");
}

export async function postPrReview(
  vectorReports: VectorReport[],
  commitSha: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is required for PR comments. Set it as an environment variable."
    );
  }

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error(
      "GITHUB_REPOSITORY is required (format: owner/repo). Set it as an environment variable."
    );
  }
  if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: "${repo}". Expected "owner/repo".`);
  }

  const prNumber = process.env.BRUNT_PR_NUMBER ?? process.env.GITHUB_PR_NUMBER;
  if (!prNumber) {
    throw new Error(
      "PR number not found. Set BRUNT_PR_NUMBER or GITHUB_PR_NUMBER environment variable."
    );
  }
  if (!/^\d+$/.test(prNumber)) {
    throw new Error(`Invalid PR number: "${prNumber}". Must be a positive integer.`);
  }

  const comments: ReviewComment[] = [];
  for (const vr of vectorReports) {
    for (const f of vr.findings) {
      comments.push({
        path: f.file,
        line: f.line,
        body: buildCommentBody(f, vr.name),
      });
    }
  }

  const reviewBody = buildReviewBody(vectorReports);
  const totalFindings = vectorReports.reduce((sum, v) => sum + v.findings.length, 0);

  const body = JSON.stringify({
    commit_id: commitSha,
    body: reviewBody,
    event: totalFindings > 0 ? "REQUEST_CHANGES" : "APPROVE",
    comments,
  });

  const response = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${text}`);
  }

  console.error(
    `Posted PR review with ${comments.length} inline comment${comments.length === 1 ? "" : "s"}.`
  );
}

export async function getHeadSha(): Promise<string> {
  const { stdout, exitCode } = await exec("git", ["rev-parse", "HEAD"]);
  if (exitCode !== 0) throw new Error("Failed to get HEAD SHA.");
  return stdout.trim();
}

export { buildCommentBody, buildReviewBody };
