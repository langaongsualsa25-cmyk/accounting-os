// Blueprint §1 (ข้อห้าม): never send data, documents or prompts to an
// external AI/API. This guard fails the build if application code pulls in
// an external AI SDK or a general-purpose outbound HTTP client.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

const FORBIDDEN_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  '@google/genai',
  'cohere-ai',
  '@mistralai/mistralai',
  'langchain',
  '@langchain/core',
  'axios',
  'node-fetch',
  'got',
  'undici',
];

const FORBIDDEN_CODE = [/\bfetch\s*\(/, /\bhttps?\.request\s*\(/, /\bhttps?\.get\s*\(/];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('no external AI/API calls', () => {
  it('declares no external AI SDK or outbound HTTP client dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => FORBIDDEN_PACKAGES.includes(d) || d.startsWith('@langchain/'))).toEqual([]);
  });

  it('application code makes no outbound HTTP calls', () => {
    const offenders = ['src', 'scripts']
      .flatMap((d) => sourceFiles(join(ROOT, d)))
      .filter((f) => FORBIDDEN_CODE.some((re) => re.test(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
