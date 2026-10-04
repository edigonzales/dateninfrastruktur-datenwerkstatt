import {spawnSync} from 'node:child_process';
import {cp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {caddyConfig} from './deployment.mjs';
const containers = [];
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', env: {...process.env, ...env}});
  if (result.status !== 0) throw Error(`${command} failed: ${result.status}`);
}
function cleanup() {
  for (const name of containers) spawnSync('docker', ['rm', '-f', name], {stdio: 'ignore'});
}
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', cleanup);
try {
  for (const [index, base, channel] of [
    [0, '/', 'post-message'],
    [1, '/lab/', 'post-message'],
    [2, '/lab/', 'auto'],
  ]) {
    if (index < 2) {
      run('npx', ['vite', 'build'], {APP_BASE_PATH: base});
      run('node', ['scripts/license-inventory.mjs']);
    }
    const directory = `deploy/generated/test-${index}`;
    await mkdir(directory, {recursive: true});
    await cp('dist', `${directory}/dist`, {recursive: true});
    const config = JSON.parse(await readFile('public/runtime-config.json', 'utf8'));
    config.appBasePath = base;
    config.buildId = `test-deployment-${channel}`;
    config.runtimes.webRChannel = channel;
    // Explicit loopback fixture provider, never shipped in the normal image.
    config.portalProviders = [
      {id: 'fixture', title: 'Synthetisches Testportal', baseUrl: 'http://127.0.0.1:4174/portal/'},
    ];
    config.allowedDataOrigins = ['http://127.0.0.1:4174'];
    await writeFile(`${directory}/dist/runtime-config.json`, JSON.stringify(config));
    await writeFile(`${directory}/Caddyfile`, caddyConfig(config));
    await cp('deploy/runtime.Dockerfile', `${directory}/Dockerfile`);
    const image = `datenwerkstatt-p7-test:${index}`;
    run('docker', ['build', '-t', image, directory]);
    const name = `datenwerkstatt-p7-${process.pid}-${index}`;
    containers.push(name);
    run('docker', [
      'run',
      '-d',
      '--name',
      name,
      '--user',
      '1000870000:0',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=32m',
      '--cap-drop=ALL',
      '--security-opt',
      'no-new-privileges',
      '-p',
      `127.0.0.1:${4180 + index}:8080`,
      image,
    ]);
  }
  console.log('Three static container profiles ready (root, /lab/, /lab/ auto).');
  await new Promise(() => {
    setInterval(() => {}, 60000);
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
