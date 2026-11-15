import type { AttemptResponse, ErrorResponse, ForgeResponse, InitResponse, Nation, OkResponse } from '../../shared/api';
import type { Action, Puzzle } from '../../shared/engine/rules';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({ type: 'error', message: `HTTP ${res.status}` }))) as T | ErrorResponse;
  if (!res.ok || (typeof data === 'object' && data !== null && 'type' in data && data.type === 'error')) {
    const msg = (data as ErrorResponse).message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  init: () => call<InitResponse>('/api/init'),
  attempt: (actions: Action[]) => call<AttemptResponse>('/api/attempt', { actions }),
  nation: (nation: Nation) => call<InitResponse>('/api/nation', { nation }),
  seen: () => call<OkResponse>('/api/seen', {}),
  chalk: () => call<OkResponse>('/api/chalk', {}),
  subscribe: () => call<OkResponse>('/api/subscribe', {}),
  forge: (puzzle: Puzzle, proof: Action[], title: string) => call<ForgeResponse>('/api/forge', { puzzle, proof, title }),
};
