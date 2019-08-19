const path = require('path');
const util = require('util');
const fs = require('fs');
const spawn = require('child_process').spawn;
const ProgressBar = require('progress');

const KYTHE_EXTRACTOR_PATH    = '/opt/kythe/extractors/cxx_extractor';
const KYTHE_INDEXER_PATH      = '/opt/kythe/indexers/cxx_indexer';
const KYTHE_WRITE_TABLES_PATH = '/opt/kythe/tools/write_tables';

const PARALLEL = 25;
const KYTHE_ROOT_DIRECTORY = '/home/aslushnikov/prog/webkit';
const KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY = '/tmp/wk-extract';
const KYTHE_ENTRIES_OUTPUT_FILE = '/tmp/wk.entries';
const KYTHE_SERVING_TABLE = '/tmp/wk.serving';

const COMPILE_COMMANDS_PATH = '/home/aslushnikov/webkit/WebKitBuild/Release/compile_commands.json';
// const COMPILE_COMMANDS_PATH = '/Users/aslushnikov/Downloads/compile_commands.json';

const rmAsync = util.promisify(require('rimraf'));
const mkdirAsync = util.promisify(fs.mkdir.bind(fs));
const readdirAsync = util.promisify(fs.readdir);

(async() => {
  const compile_commands = require(COMPILE_COMMANDS_PATH);
  const bmallocCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/bmalloc'));
  // const wtfCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/WTF'));
  // const jscCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/JavaScriptCore'));
  console.log('bmalloc commands: ' + bmallocCommandsIndex);
  //console.log('wtf commands: ' + wtfCommandsIndex);
  //console.log('jsc commands: ' + jscCommandsIndex);

  await run_cxx_extractor(compile_commands.slice(0, bmallocCommandsIndex + 1));
  await run_cxx_indexer();
})();

async function run_cxx_extractor(commands) {
  await rmAsync(KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY);
  await mkdirAsync(KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY);

  let commandIndex = 0;
  const progressBar = new ProgressBar(`Running cxx_extractor with ${PARALLEL} workers [:bar] :percent :etas `, {
    complete: '.',
    incomplete: ' ',
    width: 20,
    total: commands.length,
  });
  await Promise.all([...Array(PARALLEL)].map(cxx_extractor));

  async function cxx_extractor() {
    if (commandIndex >= commands.length)
      return;
    const entry = commands[commandIndex++];
    const args = entry.command.trim().split(' ').slice(1);
    await spawnAsyncOrDie(KYTHE_EXTRACTOR_PATH, ...args, {
      cwd: entry.directory,
      //stdio: 'inherit',
      env: {
        KYTHE_ROOT_DIRECTORY,
        KYTHE_OUTPUT_DIRECTORY: KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY,
      }
    });
    progressBar.tick(1);
    // Recurse into itself to see if there's more work.
    cxx_extractor();
  }
}

async function run_cxx_indexer() {
  const kzipFiles = (await readdirAsync(KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY)).filter(entry => entry.endsWith('.kzip'));
  await rmAsync(KYTHE_ENTRIES_OUTPUT_FILE);
  await rmAsync(KYTHE_SERVING_TABLE);
  const progressBar = new ProgressBar(`Running cxx_indexer [:bar] :percent :etas `, {
    complete: '.',
    incomplete: ' ',
    width: 20,
    total: kzipFiles.length,
  });
  for (const kzipFile of kzipFiles) {
    await spawnAsyncOrDie(KYTHE_INDEXER_PATH, kzipFile, '-o', KYTHE_ENTRIES_OUTPUT_FILE, {
      cwd: KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY
    });
    await spawnAsyncOrDie(KYTHE_WRITE_TABLES_PATH, '--entries', KYTHE_ENTRIES_OUTPUT_FILE, '--out', KYTHE_SERVING_TABLE);
    progressBar.tick();
  }
}

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
  return {code, stdout, stderr};
}

async function spawnAsyncOrDie(command, ...args) {
  const {code, stdout, stderr} = await spawnAsync(command, ...args);
  if (code !== 0)
    throw new Error(`Failed to executed: "${command} ${args.join(' ')}".\n\n=== STDOUT ===\n${stdout}\n\n\n=== STDERR ===\n${stderr}`);
  return {stdout, stderr};
}
