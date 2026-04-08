// Rate limit detection patterns (from flogvit-coder)
const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /usage.?limit/i,
  /quota.?exceeded/i,
  /hit your limit/i,
];

function isRateLimited(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some(p => p.test(text));
}

function parseRateLimitDelay(text: string): number | null {
  const seconds = text.match(/try again in (\d+)\s*second/i);
  if (seconds) return parseInt(seconds[1]) * 1000;

  const minutes = text.match(/try again in (\d+)\s*minute/i);
  if (minutes) return parseInt(minutes[1]) * 60_000;

  const hours = text.match(/try again in (\d+)\s*hour/i);
  if (hours) return parseInt(hours[1]) * 3_600_000;

  const resetsAt = text.match(/resets? at (\d{1,2}):(\d{2})/i);
  if (resetsAt) {
    const now = new Date();
    const target = new Date();
    target.setHours(parseInt(resetsAt[1]), parseInt(resetsAt[2]), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  const resetsPm = text.match(/resets?\s+(\d{1,2})(am|pm)\b/i);
  if (resetsPm) {
    let hour = parseInt(resetsPm[1]);
    if (resetsPm[2].toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (resetsPm[2].toLowerCase() === 'am' && hour === 12) hour = 0;
    const now = new Date();
    const target = new Date();
    target.setHours(hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  return null;
}

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

export class RateLimitError extends Error {
  readonly waitMs: number;
  constructor(message: string, waitMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.waitMs = waitMs;
  }
}

export class LLM {
  readonly provider: string;
  readonly model: string;
  private baseUrl: string;
  private allowedTools: string[];
  private maxTurns: number;

  // Shared rate limit state — when one call hits limit, all pause
  private static rateLimitedUntil = 0;

  static isCurrentlyRateLimited(): boolean {
    return Date.now() < LLM.rateLimitedUntil;
  }

  static getRateLimitWaitMs(): number {
    return Math.max(0, LLM.rateLimitedUntil - Date.now());
  }

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    this.model = config.model ?? (config.provider === 'claude' ? 'sonnet' : 'qwen3.5:32b');
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.allowedTools = config.allowedTools ?? [];
    this.maxTurns = config.maxTurns ?? 25;
  }

  async call(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    // Wait if rate limited
    if (LLM.isCurrentlyRateLimited()) {
      const waitMs = LLM.getRateLimitWaitMs();
      throw new RateLimitError(`Rate limited. Waiting ${Math.ceil(waitMs / 60_000)} minutes.`, waitMs);
    }

    if (this.provider === 'claude') {
      return this.callClaude(prompt, systemPrompt);
    }
    return this.callOllama(prompt, systemPrompt);
  }

  async callJSON<T>(prompt: string, systemPrompt?: string): Promise<{ data: T } & LLMResponse> {
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

    const proc = Bun.spawn(['claude', ...args], {
      stdin: new Response(prompt),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    const combined = `${output}\n${stderr}`;

    // Check for rate limiting
    if (exitCode !== 0 && isRateLimited(combined)) {
      const delayMs = parseRateLimitDelay(combined) ?? 5 * 60_000; // Default 5 min
      LLM.rateLimitedUntil = Date.now() + delayMs;
      const delayMin = Math.ceil(delayMs / 60_000);
      console.error(`⚠️  Rate limited! Pausing all Claude calls for ${delayMin} minutes.`);
      console.error(`   Raw output: ${combined.slice(0, 300)}`);
      throw new RateLimitError(`Rate limited. Waiting ${delayMin} minutes.`, delayMs);
    }

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
