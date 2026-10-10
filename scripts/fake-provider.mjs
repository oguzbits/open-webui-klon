// A model provider for hand checks and the browser check of Teilprojekt 2b (Ollama and OpenAI format).
// Usage: node scripts/fake-provider.mjs [port=11500] [mode=ok] [key]
//   mode: ok | unauthorized | server_error | redirect | hang | html | garbage | wrong_shape | oversized
//   key:  require "Authorization: Bearer <key>"
// Listens on all interfaces so a container can reach it as host.docker.internal.
import { FAKE_MODE, FakeProvider } from '../apps/api/src/testing/fake-provider.ts';

const [port = '11500', mode = FAKE_MODE.OK, key] = process.argv.slice(2);
if (!Object.values(FAKE_MODE).includes(mode)) {
  console.error(`Unknown mode "${mode}". Use one of: ${Object.values(FAKE_MODE).join(', ')}`);
  process.exit(1);
}

const provider = await FakeProvider.start(Number(port), '0.0.0.0');
provider.mode = mode;
provider.requiredKey = key;
// A chat answers in three pieces, 200 ms apart, so the stream is visible in the browser. A non-streaming
// request (the title job) gets the same text joined; the title is then the whole answer.
provider.deltas = ['Hallo ', 'aus dem ', 'Testanbieter.'];
provider.streamDelayMs = 200;
console.log(`fake provider on port ${provider.port}, mode ${mode}${key ? ', key required' : ''}`);

process.on('SIGINT', async () => {
  await provider.close();
  process.exit(0);
});
