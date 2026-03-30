import { randomUUID } from "node:crypto";

export interface TemplateOptions {
  resolveEnv?: boolean;
}

export class TemplateEngine {
  private vars = new Map<string, string>();
  private runId = randomUUID();
  private readonly resolveEnv: boolean;

  constructor(options: TemplateOptions = {}) {
    this.resolveEnv = options.resolveEnv ?? false;
  }

  clone(): TemplateEngine {
    const copy = new TemplateEngine({ resolveEnv: this.resolveEnv });
    copy.runId = this.runId;
    for (const [k, v] of this.vars) copy.vars.set(k, v);
    return copy;
  }

  set(key: string, value: string): void {
    this.vars.set(key, value);
  }

  render(input: string): string {
    let result = input.replaceAll("{{uuid}}", () => randomUUID());
    result = result.replaceAll("{{run_id}}", this.runId);
    for (const [key, value] of this.vars) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
    if (this.resolveEnv) {
      result = result.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (_match, name: string) => {
        return process.env[name] ?? `{{${name}}}`;
      });
    }
    return result;
  }

  renderObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.renderValue(value);
    }
    return result;
  }

  private renderValue(value: unknown): unknown {
    if (typeof value === "string") return this.render(value);
    if (Array.isArray(value)) return value.map((v) => this.renderValue(v));
    if (typeof value === "object" && value !== null)
      return this.renderObject(value as Record<string, unknown>);
    return value;
  }
}
