import { spawn } from 'node:child_process';

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

  private runClaude(args: string[], prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', reject);

      // Send prompt via stdin
      proc.stdin.write(prompt);
      proc.stdin.end();

      // Timeout after 5 minutes
      setTimeout(() => {
        proc.kill();
        reject(new Error('claude timed out after 300s'));
      }, 300_000);
    });
  }

  private async callClaude(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const args = ['-p', '--model', this.model, '--output-format', 'text'];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    if (this.allowedTools.length > 0) {
      args.push('--allowed-tools', ...this.allowedTools);
    }

    const stdout = await this.runClaude(args, prompt);

    return {
      text: stdout.trim(),
      tokensUsed: 0,
      model: this.model,
    };
  }

  private async callClaudeJSON<T>(prompt: string, systemPrompt?: string): Promise<{ data: T } & LLMResponse> {
    // Use text output and parse JSON ourselves — simpler than dealing with the JSON envelope
    const response = await this.callClaude(prompt, systemPrompt);
    const text = response.text;

    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
      || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in Claude response: ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(jsonMatch[1]) as T;

    return { ...response, data };
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
