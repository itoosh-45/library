import { expect, it } from 'vitest';
import { productionSecurityPolicy } from '../security-policy';

it('T24 production CSP admits only product destinations and forbids executable inline content', () => {
  const policy = productionSecurityPolicy();
  expect(policy).toContain("script-src 'self';"); expect(policy).not.toContain('unsafe-eval');
  expect(policy).toContain("object-src 'none'"); expect(policy).toContain('https://generativelanguage.googleapis.com');
  expect(policy).not.toContain('https:;'); expect(policy).not.toContain('127.0.0.1');
  expect(productionSecurityPolicy('https://catalog.example.test/')).toContain('https://catalog.example.test');
  for (const target of ['http://catalog.example.test/', 'https://secret@catalog.example.test/', 'https://catalog.example.test/?key=secret', 'https://catalog.example.test/#secret', 'https://catalog.example.test/api', "https://catalog.example.test/'; script-src *"]) expect(() => productionSecurityPolicy(target)).toThrow();
});
