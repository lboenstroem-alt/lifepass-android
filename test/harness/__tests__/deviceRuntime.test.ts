/**
 * The test realm lacks the Node globals the phone lacks (test/setup/env.ts),
 * so code that would crash on Hermes fails here too.
 */
import { Buffer as NodeBuffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { api, Reply } from '@test/server';
import { TEST_API_BASE } from '@test/server/testEnv';

describe('device runtime (Hermes, React Native 0.81)', () => {
  it('has no global crypto and no Buffer', () => {
    expect(typeof crypto).toBe('undefined');
    expect(typeof Buffer).toBe('undefined');
    expect('crypto' in globalThis).toBe(false);
    expect(() => crypto.randomUUID()).toThrow(ReferenceError);
  });

  it('has no AbortSignal.timeout or AbortSignal.any', () => {
    expect(AbortSignal.timeout).toBeUndefined();
    expect(AbortSignal.any).toBeUndefined();
    expect('timeout' in AbortSignal).toBe(false);
    expect(() => AbortSignal.timeout(10)).toThrow(TypeError);
  });

  it('keeps the AbortSignal the polyfill has: abort(), instanceof, listeners', () => {
    const controller = new AbortController();
    expect(controller.signal).toBeInstanceOf(AbortSignal);
    const heard: string[] = [];
    controller.signal.addEventListener('abort', () => heard.push('abort'));
    controller.abort();
    expect(heard).toEqual(['abort']);
    expect(AbortSignal.abort().aborted).toBe(true);
  });

  it('still lets a client timeout abort a fetch through the stub server', async () => {
    api.on('GET', '/slow', Reply.hang());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10);
    await expect(fetch(`${TEST_API_BASE}/slow`, { signal: controller.signal })).rejects.toThrow();
    clearTimeout(timer);
  });

  it('lets harness code import what it needs from Node', () => {
    expect(NodeBuffer.from('LifePass').toString('base64')).toBe('TGlmZVBhc3M=');
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
