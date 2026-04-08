import Anthropic from '@anthropic-ai/sdk';

export interface LLMConfig {
  provider: 'claude' | 'ollama';
  model: string;
  baseUrl?: string;
  maxTokens?: number;
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
  private maxTokens: number;
  private anthropic?: Anthropic;

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.maxTokens = config.maxTokens ?? 4096;

    if (config.provider === 'claude') {
      this.anthropic = new Anthropic();
    }
  }

  async call(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    if (this.provider === 'claude') {
      return this.callClaude(prompt, systemPrompt);
    }
    return this.callOllama(prompt, systemPrompt);
  }

  async callJSON<T>(prompt: string, systemPrompt?: string): Promise<{ data: T } & LLMResponse> {
    const response = await this.call(prompt, systemPrompt);
    const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```/)
      || response.text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in LLM response: ${response.text.slice(0, 200)}`);
    }
    const data = JSON.parse(jsonMatch[1]) as T;
    return { ...response, data };
  }

  private async callClaude(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const response = await this.anthropic!.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      text,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
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
