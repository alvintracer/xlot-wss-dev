import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { compile_program, createFileManager } from '@noir-lang/noir_wasm';

const root = fileURLToPath(new URL('../circuit/', import.meta.url));
const output = fileURLToPath(new URL('../src/generated/', import.meta.url));
const result = await compile_program(createFileManager(root));
await mkdir(output, { recursive: true });
const file_map = Object.fromEntries(Object.entries(result.program.file_map).map(([id, file]) => [id, {
  ...file, path: 'circuit/src/main.nr',
}]));
await writeFile(join(output, 'identity_equality.json'), JSON.stringify({ ...result.program, file_map }));
console.log(`Compiled ${result.name}: ${result.warnings.length} warning(s)`);
