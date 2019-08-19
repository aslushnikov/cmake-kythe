const path = require('path');
const util = require('util');
const fs = require('fs');
const spawn = require('child_process').spawn;

const KYTHE_ROOT_DIRECTORY = '/home/aslushnikov/prog/webkit';
const KYTHE_OUTPUT_DIRECTORY = '/tmp/wk-extract';
const KYTHE_EXTRACTOR_PATH = '/opt/kythe-v0.0.30/extractors/cxx_extractor';

const COMPILE_COMMANDS_PATH = '/home/aslushnikov/webkit/WebKitBuild/Release/compile_commands.json';
// const COMPILE_COMMANDS_PATH = '/Users/aslushnikov/Downloads/compile_commands.json';

const rmAsync = util.promisify(require('rimraf'));
const mkdirAsync = util.promisify(fs.mkdir.bind(fs));

(async() => {
  const compile_commands = require(COMPILE_COMMANDS_PATH);
  const bmallocCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/bmalloc'));
  // const wtfCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/WTF'));
  // const jscCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/JavaScriptCore'));
  console.log('bmalloc commands: ' + bmallocCommandsIndex);
  //console.log('wtf commands: ' + wtfCommandsIndex);
  //console.log('jsc commands: ' + jscCommandsIndex);
  const commands = compile_commands.slice(0, bmallocCommandsIndex + 1);
  await rmAsync(KYTHE_OUTPUT_DIRECTORY);
  await mkdirAsync(KYTHE_OUTPUT_DIRECTORY);
  for (const entry of commands) {
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

function findLastIndex(a, p) {
  let lastIndex = -1;
  for (let i = 0; i < a.length; ++i) {
    if (p.call(null, a[i]))
      lastIndex = i;
  }
  return lastIndex;
}

async function spawnAsync(command, ...args) {
  let options = {};
  if (args.length && args[args.length - 1].constructor.name !== 'String')
    options = args.pop();
  const cmd = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  if (cmd.stdout)
    cmd.stdout.on('data', data => stdout += data);
  if (cmd.stderr)
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
