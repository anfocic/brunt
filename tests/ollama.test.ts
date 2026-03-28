import { describe, test, expect } from "bun:test";
import { OllamaProvider } from "../src/providers/ollama.ts";

describe("OllamaProvider", () => {
  test("uses default host, model, and maxTokens", () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe("ollama");
  });

  test("accepts model from options", () => {
    const provider = new OllamaProvider({ model: "codellama" });
    expect(provider.name).toBe("ollama");
  });

  test("accepts maxTokens from options", () => {
    const provider = new OllamaProvider({ maxTokens: 2048 });
    expect(provider.name).toBe("ollama");
  });

  test("respects OLLAMA_HOST env var", () => {
    const orig = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://remote:11434";
    try {
      const provider = new OllamaProvider();
      expect(provider.name).toBe("ollama");
    } finally {
      if (orig === undefined) {
        delete process.env.OLLAMA_HOST;
      } else {
        process.env.OLLAMA_HOST = orig;
      }
    }
  });

  test("respects OLLAMA_MODEL env var", () => {
    const orig = process.env.OLLAMA_MODEL;
    process.env.OLLAMA_MODEL = "mistral";
    try {
      const provider = new OllamaProvider();
      expect(provider.name).toBe("ollama");
    } finally {
      if (orig === undefined) {
        delete process.env.OLLAMA_MODEL;
      } else {
        process.env.OLLAMA_MODEL = orig;
      }
    }
  });

  test("options.model overrides OLLAMA_MODEL env var", () => {
    const orig = process.env.OLLAMA_MODEL;
    process.env.OLLAMA_MODEL = "mistral";
    try {
      const provider = new OllamaProvider({ model: "codellama" });
      expect(provider.name).toBe("ollama");
    } finally {
      if (orig === undefined) {
        delete process.env.OLLAMA_MODEL;
      } else {
        process.env.OLLAMA_MODEL = orig;
      }
    }
  });
});
