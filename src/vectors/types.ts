import type { DiffFile } from "../diff.ts";
export type { DiffFile };
import type { Provider } from "../providers/types.ts";

export type Severity = "low" | "medium" | "high" | "critical";

export type Finding = {
  file: string;
  line: number;
  severity: Severity;
  title: string;
  description: string;
  reproduction: string;
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
  analyze(
    files: DiffFile[],
    context: Map<string, string>,
    provider: Provider
  ): Promise<Finding[]>;
}
