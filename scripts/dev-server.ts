// Runs the bridge outside VS Code (for development and end-to-end tests).
// Usage: node dist/dev-server.js <claude.exe> <codex.exe> [httpPort] [httpsPort]
import path from 'node:path';
import os from 'node:os';
import { ClaudeAgent } from '../src/agents/claude';
import { CodexAgent } from '../src/agents/codex';
import { BridgeServer } from '../src/server';

const [claudeExe, codexExe, httpPort = '9787', httpsPort = '9788'] = process.argv.slice(2);
const log = (s: string) => console.log(s);
const agents = { claude: new ClaudeAgent(claudeExe, log), codex: new CodexAgent(codexExe, log) };
const server = new BridgeServer({
  agents,
  storageDir: path.join(os.tmpdir(), 'pocket-bridge-dev'),
  webDir: path.resolve(__dirname, 'web'),
  httpPort: Number(httpPort),
  httpsPort: Number(httpsPort),
  token: 'dev-token-dev-token-dev-token-xx',
  log,
  openInVSCode: async (a, id) => log(`[dev] open in VS Code: ${a} ${id}`),
  workspaceFolders: () => [process.cwd()],
});
server.start().then(() => log(`[dev] pair: ${server.pairUrl}`));
