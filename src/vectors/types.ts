import type { DiffFile } from "../diff.js";
export type { DiffFile };
import type { Provider } from "@packages/llm";
import type { CrossRefMatch } from "../crossref.js";

export type Severity = "low" | "medium" | "high" | "critical";

export const SEVERITY_ORDER: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export type Finding = {
  file: string;
  line: number;
  severity: Severity;
  title: string;
  description: string;
  reproduction: string;
  package?: string;
};

export type VectorReport = {
  name: string;
  findings: Finding[];
  duration: number; // ms
};

export type ScanReport = {
  vectors: VectorReport[];
  totalFindings: number;
  totalDuration: number; // ms
};

export interface Vector {
  name: string;
  description: string;
  promptHash?: string; // stable hash for cache key — avoids unreliable function.toString()
  analyze(
    files: DiffFile[],
    context: Map<string, string>,
    provider: Provider,
    crossRefs?: CrossRefMatch[]
  ): Promise<Finding[]>;
}
