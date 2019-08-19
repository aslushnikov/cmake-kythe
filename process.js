const path = require('path');
const util = require('util');
const rmAsync = util.promisify(require('rimraf'));
const spawn = require('child_process').spawn;

const COMPILE_COMMANDS_PATH = '/home/aslushnikov/webkit/WebKitBuild/Release/compile_commands.json';
const KYTHE_ROOT_DIRECTORY = '/home/aslushnikov/prog/webkit';
const KYTHE_OUTPUT_DIRECTORY = '/tmp/wk-extract';
const KYTHE_EXTRACTOR_PATH = '/opt/kythe-v0.0.30/extractors/cxx_extractor';

// const COMPILE_COMMANDS_PATH = '/Users/aslushnikov/Downloads/compile_commands.json';

(async() => {
  await rmAsync(KYTHE_OUTPUT_DIRECTORY);
  const compile_commands = require(COMPILE_COMMANDS_PATH);
  const jsc_commands = compile_commands.filter(entry => entry.file.includes('JavaScriptCore'));
  console.log('JavaScriptCore compilation commands: ' + jsc_commands.length);
  for (const entry of jsc_commands) {
    const args = entry.command.trim().split(' ').slice(1);
    await spawnAsyncOrDie(KYTHE_EXTRACTOR_PATH, ...args, {
      cwd: entry.directory,
      stdio: 'inherit',
      env: {
        KYTHE_ROOT_DIRECTORY,
        KYTHE_OUTPUT_DIRECTORY,
      }
    });
  }
})();

async function spawnAsync(command, ...args) {
  let options = {};
  if (args.length && args[args.length - 1].constructor.name !== 'String')
    options = args.pop();
  const cmd = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  cmd.stdout.on('data', data => stdout += data);
  cmd.stderr.on('data', data => stderr += data);
  const code = await new Promise(x => cmd.once('close', x));
  if (stdout)
    debug(stdout);
  if (stderr)
    debug(stderr);
  return {code, stdout, stderr};
}

async function spawnAsyncOrDie(command, ...args) {
  const {code, stdout, stderr} = await spawnAsync(command, ...args);
  if (code !== 0)
    throw new Error(`Failed to executed: "${command} ${args.join(' ')}".\n\n=== STDOUT ===\n${stdout}\n\n\n=== STDERR ===\n${stderr}`);
  return {stdout, stderr};
}
