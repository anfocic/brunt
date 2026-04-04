import type { CustomVectorConfig } from "../config.js";
import type { Vector, DiffFile, Finding, Severity } from "./types.js";
import { SEVERITY_ORDER } from "./types.js";
import { createVector } from "./factory.js";
import { matchGlob } from "../util.js";

function filterFiles(
  files: DiffFile[],
  include?: string[],
  exclude?: string[]
): DiffFile[] {
  let filtered = files;

  if (include && include.length > 0) {
    filtered = filtered.filter((f) =>
      include.some((pattern) => matchGlob(pattern, f.path))
    );
  }

  if (exclude && exclude.length > 0) {
    filtered = filtered.filter(
      (f) => !exclude.some((pattern) => matchGlob(pattern, f.path))
    );
  }

  return filtered;
}

function applySeverityFloor(findings: Finding[], floor: Severity): Finding[] {
  const floorLevel = SEVERITY_ORDER[floor];
  return findings.map((f) => {
    if (SEVERITY_ORDER[f.severity] < floorLevel) {
      return { ...f, severity: floor };
    }
    return f;
  });
}

export function createCustomVectors(configs: CustomVectorConfig[]): Vector[] {
  return configs.map((config) => {
    const baseVector = createVector(config.name, config.description, config.prompt);

    // If no filters or severity override, return as-is
    if (!config.include && !config.exclude && !config.severity) {
      return baseVector;
    }

    // Wrap with file filtering and/or severity floor
    return {
      name: baseVector.name,
      description: baseVector.description,
      promptHash: baseVector.promptHash,
      async analyze(files, context, provider, crossRefs) {
        const filtered = filterFiles(files, config.include, config.exclude);
        if (filtered.length === 0) return [];

        // Filter context to only include filtered files
        const filteredContext = new Map<string, string>();
        for (const file of filtered) {
          const ctx = context.get(file.path);
          if (ctx) filteredContext.set(file.path, ctx);
        }

        let findings = await baseVector.analyze(filtered, filteredContext, provider, crossRefs);

        if (config.severity) {
          findings = applySeverityFloor(findings, config.severity);
        }

        return findings;
      },
    };
  });
}
