import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(__dirname, '..');
const repoRoot = join(frontendDir, '..');
const zeroclawDir = join(repoRoot, 'zeroclaw');
const port = process.env.VITE_ZEROCLAW_PORT || '42617';
const zeroclawFeatures = process.env.ZEROCLAW_CARGO_FEATURES || 'gateway,agent-runtime';

let gateway;
let frontend;

const stop = () => {
  if (gateway && !gateway.killed) gateway.kill('SIGINT');
  if (frontend && !frontend.killed) frontend.kill('SIGINT');
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const waitForGateway = async () => {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // still starting (cargo build may take a while on first run)
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`ZeroClaw gateway did not become ready on 127.0.0.1:${port}`);
};

const startFrontend = () => {
  frontend = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--open'],
    { cwd: frontendDir, stdio: 'inherit' },
  );
  frontend.on('exit', (code) => {
    if (typeof code === 'number' && code !== 0) process.exit(code);
  });
};

try {
  if (!existsSync(join(zeroclawDir, 'Cargo.toml'))) {
    console.warn('zeroclaw/ not found — starting Roman Bath frontend only.');
    console.warn(
      'Run ZeroClaw gateway separately: cd zeroclaw && cargo run --no-default-features --features gateway,agent-runtime -- gateway start',
    );
    startFrontend();
  } else {
    console.log(`Starting ZeroClaw gateway on :${port}…`);
    gateway = spawn(
      'cargo',
      [
        'run',
        '--no-default-features',
        '--features',
        zeroclawFeatures,
        '--',
        'gateway',
        'start',
        '-p',
        port,
      ],
      {
        cwd: zeroclawDir,
        stdio: 'inherit',
      },
    );
    gateway.on('exit', (code) => {
      if (typeof code === 'number' && code !== 0) process.exit(code);
    });
    await waitForGateway();
    console.log(`ZeroClaw gateway ready → http://127.0.0.1:${port}`);
    startFrontend();
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  stop();
  process.exit(1);
}
