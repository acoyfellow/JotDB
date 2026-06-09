import { describe, it, expect } from 'vitest';
import app from '../src/index';

const env = { JOTDB: {} } as any;

describe('HTTP safety gates', () => {
  it('rejects all HTTP traffic unless explicitly enabled', async () => {
    const response = await app.fetch(new Request('https://example.test/'), env);
    expect(response.status).toBe(403);
  });

  it('rejects benchmark traffic without a bearer token', async () => {
    const response = await app.fetch(new Request('https://example.test/bench?mode=user-prefs'), {
      ...env,
      HTTP_ENABLED: '1',
    });
    expect(response.status).toBe(401);
  });
});
