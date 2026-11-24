import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AI_DEFAULT_URL, type AiConnection, type AiInfo, type AiInput, type AiView } from '../shared/ai.js';
import type { Key } from '../shared/i18n.js';
import type { Db } from './db.js';
import type { Settings } from './settings.js';

type Stored = Omit<AiInput, 'apiKey'> & { apiKey: string | null };
export interface AiConfig extends Omit<AiInput, 'apiKey'> { apiKey: string | null }

export interface AiRequest { system: string; text: string; schema: z.ZodType; signal: AbortSignal }

export class AiError extends Error {
  constructor(message: Key, readonly status: 409 | 422 | 429 | 502 | 504 = 502, readonly unreachable = false) { super(message); }
}

const TIMEOUT = 240_000;
const CHECK_TIMEOUT = 10_000;
const MAX_RESPONSE = 2_000_000;
const MAX_OUTPUT_TOKENS = 16_000;

const unreachable = () => new AiError('Strežnik umetne inteligence ni dosegljiv.', 502, true);
const unusable = () => new AiError('Model ni vrnil uporabnega odgovora. Poskusite znova ali izpolnite polja ročno.');

function statusError(status: number): AiError {
  if (status === 401 || status === 403) return new AiError('Ponudnik je zavrnil ključ.');
  if (status === 404) return new AiError('Model ali naslov pri ponudniku ne obstaja.');
  if (status === 429) return new AiError('Pri ponudniku je dosežena omejitev porabe. Poskusite pozneje.');
  return new AiError('Ponudnik je vrnil napako. Poskusite znova.');
}

function failure(error: unknown, signal: AbortSignal): AiError {
  if (error instanceof AiError) return error;
  if (signal.aborted) return new AiError('Branje je trajalo predolgo. Poskusite znova ali izpolnite polja ročno.', 504);
  return unreachable();
}

// Preusmeritve niso dovoljene, da ključ in besedilo ne gresta na drug naslov.
async function call(url: string, key: string | null, signal: AbortSignal, body?: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
    headers: { accept: 'application/json', ...(body !== undefined && { 'content-type': 'application/json' }), ...(key && { authorization: `Bearer ${key}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > MAX_RESPONSE) throw unusable();
    chunks.push(chunk);
  }
  let json: unknown = null;
  try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { if (response.ok) throw unusable(); }
  return { status: response.status, json };
}

function parseAnswer(text: unknown): unknown {
  if (typeof text !== 'string') throw unusable();
  // Nekateri modeli odgovor kljub navodilom ovijejo v Markdown.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw unusable(); }
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

// Ocena števila žetonov; slovensko besedilo jih porabi več kot angleško.
const contextSize = (chars: number) => Math.min(65_536, Math.ceil((chars / 2.2 + 6000) / 4096) * 4096);

async function askOllama(config: AiConfig, r: AiRequest): Promise<unknown> {
  const { status, json } = await call(`${config.baseUrl}/api/chat`, config.apiKey, r.signal, {
    model: config.model, stream: false, format: jsonSchema(r.schema),
    messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.text }],
    options: { temperature: 0, num_ctx: contextSize(r.system.length + r.text.length), num_predict: 4096 },
  });
  if (status !== 200) throw statusError(status);
  return parseAnswer((json as { message?: { content?: unknown } } | null)?.message?.content);
}

async function askOpenAi(config: AiConfig, r: AiRequest): Promise<unknown> {
  const ask = (response_format: unknown) => call(`${config.baseUrl}/chat/completions`, config.apiKey, r.signal, {
    model: config.model, response_format,
    messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.text }],
  });
  let { status, json } = await ask({ type: 'json_schema', json_schema: { name: 'pogodba', strict: true, schema: jsonSchema(r.schema) } });
  // Strežniki brez podpore za sheme poznajo vsaj obliko JSON; odgovor v vsakem primeru preverimo.
  if (status === 400 || status === 422) ({ status, json } = await ask({ type: 'json_object' }));
  if (status !== 200) throw statusError(status);
  return parseAnswer((json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content);
}

export class Ai {
  constructor(private db: Db, private settings: Settings, private anthropicUrl = AI_DEFAULT_URL.anthropic) {}

  private get stored(): Stored | null { return this.settings.get<Stored>('ai'); }

  // Null, če ni nastavljeno ali ključa ni več mogoče prebrati.
  get current(): AiConfig | null {
    const stored = this.stored;
    if (!stored) return null;
    if (stored.apiKey === null) return { ...stored, apiKey: null };
    const apiKey = this.settings.decrypt(stored.apiKey);
    return apiKey === null ? null : { ...stored, apiKey };
  }

  get info(): AiInfo | null {
    const config = this.current;
    return config && { destination: config.provider === 'anthropic' ? 'Anthropic' : new URL(config.baseUrl).host };
  }

  view(): AiView {
    const stored = this.stored;
    if (!stored) return { settings: null, unreadableKey: false };
    const { apiKey, ...rest } = stored;
    return { settings: { ...rest, hasKey: apiKey !== null }, unreadableKey: this.current === null };
  }

  // Shranjen ključ velja samo za naslov, za katerega je bil vnesen.
  private keyFor({ provider, baseUrl, apiKey }: AiConnection): string | null {
    if (apiKey) return apiKey;
    const old = this.current;
    return old && old.provider === provider && old.baseUrl === baseUrl ? old.apiKey : null;
  }

  // Vrne false, če ponudnik zahteva ključ, ta pa ni vnesen ali shranjen.
  save(input: AiInput): boolean {
    const key = this.keyFor(input);
    if (input.provider === 'anthropic' && !key) return false;
    this.settings.set('ai', { ...input, apiKey: key && this.settings.encrypt(key) } satisfies Stored);
    return true;
  }

  clear(): void { this.settings.remove('ai'); }

  private anthropic(apiKey: string | null): Anthropic {
    return new Anthropic({ apiKey, authToken: null, baseURL: this.anthropicUrl, maxRetries: 1, logLevel: 'off', fetchOptions: { redirect: 'error' } });
  }

  private anthropicError(error: unknown, signal: AbortSignal): AiError {
    if (error instanceof Anthropic.APIConnectionError) return failure(null, signal);
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') return statusError(error.status);
    return failure(error, signal);
  }

  async models(connection: AiConnection): Promise<string[]> {
    const key = this.keyFor(connection);
    const signal = AbortSignal.timeout(CHECK_TIMEOUT);
    if (connection.provider === 'anthropic') {
      if (!key) throw new AiError('Vnesite ključ.', 422);
      try {
        return (await this.anthropic(key).models.list({ limit: 100 }, { signal })).data.map((m) => m.id);
      } catch (error) { throw this.anthropicError(error, signal); }
    }
    try {
      const ollama = connection.provider === 'ollama';
      const { status, json } = await call(`${connection.baseUrl}${ollama ? '/api/tags' : '/models'}`, key, signal);
      if (status !== 200) throw statusError(status);
      const list = (ollama ? (json as { models?: unknown } | null)?.models : (json as { data?: unknown } | null)?.data) ?? [];
      if (!Array.isArray(list)) throw unusable();
      return list.map((m: { name?: unknown; id?: unknown }) => (ollama ? m.name : m.id)).filter((m): m is string => typeof m === 'string' && m.length <= 200).sort().slice(0, 500);
    } catch (error) { throw failure(error, signal); }
  }

  async ask(request: Omit<AiRequest, 'signal'>, cancelled: AbortSignal): Promise<unknown> {
    const config = this.current;
    if (!config) throw new AiError('Umetna inteligenca ni nastavljena.', 409);
    const signal = AbortSignal.any([cancelled, AbortSignal.timeout(TIMEOUT)]);
    if (config.provider !== 'anthropic') {
      try {
        return await (config.provider === 'ollama' ? askOllama : askOpenAi)(config, { ...request, signal });
      } catch (error) { throw failure(error, signal); }
    }
    try {
      const message = await this.anthropic(config.apiKey).messages.create({
        model: config.model, max_tokens: MAX_OUTPUT_TOKENS, system: request.system, messages: [{ role: 'user', content: request.text }],
        output_config: { format: { type: 'json_schema', schema: jsonSchema(request.schema) } },
      }, { signal });
      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') throw unusable();
      return parseAnswer(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''));
    } catch (error) { throw error instanceof AiError ? error : this.anthropicError(error, signal); }
  }

  // Porabi eno od današnjih branj; false, če jih ni več.
  take(userId: string, day: string): boolean {
    const limit = this.stored?.dailyLimit ?? 0;
    this.db.prepare('DELETE FROM ai_usage WHERE day < ?').run(day);
    return this.db.prepare(`INSERT INTO ai_usage (user_id, day, count) SELECT ?, ?, 1 WHERE ? > 0
      ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 WHERE count < ?`).run(userId, day, limit, limit).changes > 0;
  }

  giveBack(userId: string, day: string): void {
    this.db.prepare('UPDATE ai_usage SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0').run(userId, day);
  }
}
