export interface LLMConfig {
  provider: 'claude' | 'ollama';
  model?: string;
  baseUrl?: string;
  allowedTools?: string[];
  maxTurns?: number;
}

export interface LLMResponse {
  text: string;
  tokensUsed: number;
  model: string;
}

export class LLM {
  readonly provider: string;
  readonly model: string;
  private baseUrl: string;
  private allowedTools: string[];
  private maxTurns: number;

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    this.model = config.model ?? (config.provider === 'claude' ? 'sonnet' : 'qwen3.5:32b');
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.allowedTools = config.allowedTools ?? [];
    this.maxTurns = config.maxTurns ?? 25;
  }

  async call(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    if (this.provider === 'claude') {
      return this.callClaude(prompt, systemPrompt);
    }
    return this.callOllama(prompt, systemPrompt);
  }

  async callJSON<T>(prompt: string, systemPrompt?: string): Promise<{ data: T } & LLMResponse> {
    // Try up to 2 times — JSON parsing can fail if response is truncated
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.call(
        attempt === 0 ? prompt : `${prompt}\n\nVIKTIG: Svar KUN med gyldig JSON i en json-kodeblokk. Ingen annen tekst.`,
        systemPrompt,
      );
      const text = response.text;

      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
        || text.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) {
        if (attempt === 0) continue;
        throw new Error(`No JSON found in response: ${text.slice(0, 200)}`);
      }

      try {
        const data = JSON.parse(jsonMatch[1]) as T;
        return { ...response, data };
      } catch (e) {
        if (attempt === 0) continue;
        throw e;
      }
    }
    throw new Error('Failed to get valid JSON after 2 attempts');
  }

  private async callClaude(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const args: string[] = [
      '-p',
      '--output-format', 'text',
      '--model', this.model,
      '--max-turns', String(this.maxTurns),
      '--dangerously-skip-permissions',
    ];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    if (this.allowedTools.length > 0) {
      args.push('--allowedTools', this.allowedTools.join(','));
    }

    // Send prompt via stdin to handle long prompts
    const proc = Bun.spawn(['claude', ...args], {
      stdin: new Response(prompt),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const errMsg = stderr.trim() || output.trim();
      throw new Error(`claude exited with code ${exitCode}: ${errMsg.slice(0, 500)}`);
    }

    return {
      text: output.trim(),
      tokensUsed: 0,
      model: this.model,
    };
  }

  private async callOllama(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
    }

    const result = await response.json() as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      text: result.message.content,
      tokensUsed: (result.eval_count ?? 0) + (result.prompt_eval_count ?? 0),
      model: this.model,
    };
  }

  static formatPrompt(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return vars[key] ?? match;
    });
  }
}
