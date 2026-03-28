import type { Finding, VectorReport } from "./vectors/types.ts";

export type ConsensusResult = {
  finding: Finding;
  confirmedBy: string[];
  confidence: number;
  vectorName: string;
};

export type ConsensusReport = {
  results: ConsensusResult[];
  models: string[];
  agreement: number;
};

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function matchFindings(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false;
  if (Math.abs(a.line - b.line) > 5) return false;

  const titleSim = jaccard(tokenize(a.title), tokenize(b.title));
  return titleSim > 0.4;
}

export function buildConsensus(
  reportsByModel: Map<string, VectorReport[]>,
  vectorNames: string[]
): ConsensusReport {
  const models = [...reportsByModel.keys()];
  const modelCount = models.length;

  const findingsByVector = new Map<string, Map<string, Finding[]>>();
  for (const vectorName of vectorNames) {
    findingsByVector.set(vectorName, new Map());
  }

  for (const [modelName, reports] of reportsByModel) {
    for (const report of reports) {
      const modelFindings = findingsByVector.get(report.name);
      if (modelFindings) {
        modelFindings.set(modelName, report.findings);
      }
    }
  }

  const results: ConsensusResult[] = [];
  const seen = new Set<string>();

  for (const [vectorName, modelFindings] of findingsByVector) {
    const allFindings: Array<{ finding: Finding; model: string }> = [];
    for (const [model, findings] of modelFindings) {
      for (const f of findings) {
        allFindings.push({ finding: f, model });
      }
    }

    for (const { finding, model } of allFindings) {
      const key = `${vectorName}:${finding.file}:${finding.line}:${finding.title}`;
      if (seen.has(key)) continue;

      const confirmedBy = [model];
      const matchKeys = [key];

      for (const { finding: other, model: otherModel } of allFindings) {
        if (otherModel === model) continue;
        if (confirmedBy.includes(otherModel)) continue;
        if (matchFindings(finding, other)) {
          confirmedBy.push(otherModel);
          matchKeys.push(`${vectorName}:${other.file}:${other.line}:${other.title}`);
        }
      }

      for (const k of matchKeys) seen.add(k);

      results.push({
        finding,
        confirmedBy,
        confidence: confirmedBy.length / modelCount,
        vectorName,
      });
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);

  const totalConfidence = results.reduce((sum, r) => sum + r.confidence, 0);
  const agreement = results.length > 0 ? totalConfidence / results.length : 1;

  return { results, models, agreement };
}
