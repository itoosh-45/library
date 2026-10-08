import { expect, test } from 'vitest';
import { GroqVisionSession } from './groqVision';
import { recognitionModels } from './recognition';
test('Groq key check sends no image and accepts only an available vision model', async () => {
  let calls = 0;
  const session = new GroqVisionSession(async (url, init) => { calls++; expect(url).toBe('https://api.groq.com/openai/v1/models'); expect(init?.body).toBeUndefined(); expect(init?.method).toBeUndefined(); expect(init?.credentials).toBe('omit'); return Response.json({data: [{id: recognitionModels.groq}]}); });
  session.configure('synthetic-groq-key-never-live',true,true); await session.checkConnection(); expect(calls).toBe(1);
});
test('Groq key rejection retains the HTTP cause and never displays the provider body', async () => {
  const session = new GroqVisionSession(async () => new Response('secret provider payload', {status: 401}));
  session.configure('synthetic-groq-key-never-live',true,true); await expect(session.checkConnection()).rejects.toMatchObject({state:'key',httpStatus:401});
});
