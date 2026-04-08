import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LLMConfig {
  provider: 'claude' | 'ollama';
  model?: string;
  baseUrl?: string;
  allowedTools?: string[];
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

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    this.model = config.model ?? (config.provider === 'claude' ? 'sonnet' : 'qwen3.5:32b');
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.allowedTools = config.allowedTools ?? [];
  }

  async call(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    if (this.provider === 'claude') {
      return this.callClaude(prompt, systemPrompt);
    }
    return this.callOllama(prompt, systemPrompt);
  }

  async callJSON<T>(prompt: string, systemPrompt?: string): Promise<{ data: T } & LLMResponse> {
    if (this.provider === 'claude') {
      return this.callClaudeJSON<T>(prompt, systemPrompt);
    }
    // Ollama: parse JSON from text response
    const response = await this.callOllama(prompt, systemPrompt);
    const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```/)
      || response.text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in LLM response: ${response.text.slice(0, 200)}`);
    }
    const data = JSON.parse(jsonMatch[1]) as T;
    return { ...response, data };
  }

  private async callClaude(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const args = ['-p', '--model', this.model, '--output-format', 'text'];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    if (this.allowedTools.length > 0) {
      args.push('--allowed-tools', ...this.allowedTools);
    }

    args.push(prompt);

    const { stdout } = await execFileAsync('claude', args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    });

    return {
      text: stdout.trim(),
      tokensUsed: 0, // claude CLI doesn't report tokens in text mode
      model: this.model,
    };
  }

  private async callClaudeJSON<T>(prompt: string, systemPrompt?: string): Promise<{ data: T } & LLMResponse> {
    const args = ['-p', '--model', this.model, '--output-format', 'json'];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    if (this.allowedTools.length > 0) {
      args.push('--allowed-tools', ...this.allowedTools);
    }

    args.push(prompt);

    const { stdout } = await execFileAsync('claude', args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    });

    const result = JSON.parse(stdout);

    // claude --output-format json returns { result: "text", ... }
    const text = result.result ?? result.text ?? stdout;
    const tokensUsed = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);

    // Extract JSON from the text content
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
      || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in Claude response: ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(jsonMatch[1]) as T;

    return { text, tokensUsed, model: this.model, data };
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
