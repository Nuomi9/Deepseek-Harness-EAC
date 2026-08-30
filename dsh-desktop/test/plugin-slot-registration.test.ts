import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function pluginSource(name) {
  return readFileSync(join(root, 'assets', 'plugins', name, 'lib', 'client.js'), 'utf8');
}

test('root companion plugins inject parent slots before registering entries', () => {
  const balance = pluginSource('dsh-balance');
  const floatWindow = pluginSource('dsh-float-window');
  const pet = pluginSource('dsh-pet');

  assert.match(balance,
    /slots\.inject\("conversation\.composer\.dock",\s*\(\) => ctx\.slots\.register\(\{\s*name: "conversation\.composer\.dock"/);
  assert.match(balance,
    /slots\.inject\("settings\.section",\s*\(\) => ctx\.slots\.register\(\{\s*name: "settings\.section"/);
  assert.match(floatWindow,
    /slots\.inject\("conversation\.session\.header\.actions",\s*\(\) => ctx\.slots\.register\(\{\s*name: "conversation\.session\.header\.actions"/);
  assert.match(pet,
    /slots\.inject\("settings\.section"/);
});
