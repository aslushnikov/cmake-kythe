const path = require('path');
const util = require('util');
const fs = require('fs');
const {spawn} = require('child_process');
const ProgressBar = require('progress');

const KYTHE_EXTRACTOR_PATH     = '/opt/kythe/extractors/cxx_extractor';
const KYTHE_INDEXER_PATH       = '/opt/kythe/indexers/cxx_indexer';
const KYTHE_WRITE_ENTRIES_PATH = '/opt/kythe/tools/write_entries';
const KYTHE_WRITE_TABLES_PATH  = '/opt/kythe/tools/write_tables';
const KYTHE_HTTP_SERVER        = '/opt/kythe/tools/http_server';
const KYTHE_WEB_UI             = '/opt/kythe/web/ui';

const PARALLEL = 50;
const KYTHE_ROOT_DIRECTORY = '/home/aslushnikov/prog/webkit';
const KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY = '/tmp/wk-extract';
const KYTHE_ENTRIES_OUTPUT_DIRECTORY = '/tmp/wk-entries';
const KYTHE_SERVING_TABLE = '/tmp/wk.serving';
const GRAPH_STORE_PATH = '/tmp/wk.graphstore';

const COMPILE_COMMANDS_PATH = '/home/aslushnikov/webkit/WebKitBuild/Release/compile_commands.json';

const rmAsync = util.promisify(require('rimraf'));
const mkdirAsync = util.promisify(fs.mkdir.bind(fs));
const readdirAsync = util.promisify(fs.readdir);
const existsAsync = util.promisify(fs.exists);

const RED_COLOR = '\x1b[31m';
const GREEN_COLOR = '\x1b[32m';
const YELLOW_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

(async() => {
  if (await existsAsync(GRAPH_STORE_PATH)) {
    const text = await question(`Serving table ${GRAPH_STORE_PATH} exists - do you want to ${RED_COLOR}DELETE${RESET_COLOR} it? (Y/n) `);
    const answer = text.trim().toLowerCase();
    if (answer === 'y') {
      await rmAsync(GRAPH_STORE_PATH);
    } else if (answer === 'n') {
      //console.log(`OK, please run "${YELLOW_COLOR}rm -rf ${GRAPH_STORE_PATH}${RESET_COLOR}" yourself and re-run the script`);
    } else {
      console.log('ERROR: did not understand your answer!');
      return;
    }
  }
  const compile_commands = require(COMPILE_COMMANDS_PATH);
  const bmallocCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/bmalloc'));
  // const wtfCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/WTF'));
  // const jscCommandsIndex = findLastIndex(compile_commands, entry => entry.file.includes('Source/JavaScriptCore'));

  const t = Date.now();
  await run_cxx_extractor(compile_commands.slice(0, bmallocCommandsIndex + 1));
  await run_cxx_indexer();
  await write_serving_table_from_entries();
  printDuration('Total time: ', Date.now() - t);

  console.log(`
    Serving on :8080
  `);
  await spawnAsyncOrDie(KYTHE_HTTP_SERVER, '--public_resources', KYTHE_WEB_UI, '--listen', ':8080', '--serving_table', KYTHE_SERVING_TABLE);
})();

async function run_cxx_extractor(commands) {
  const t = Date.now();
  await rmAsync(KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY);
  await mkdirAsync(KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY);

  let commandIndex = 0;
  const progressBar = new ProgressBar(`Running cxx_extractor with ${PARALLEL} workers [:bar] :current/:total :percent :etas `, {
    complete: '.',
    incomplete: ' ',
    width: 20,
    total: commands.length,
  });
  await Promise.all([...Array(PARALLEL)].map(cxx_extractor));
  printDuration('CXX_EXTRACTION: ', Date.now() - t);

  async function cxx_extractor() {
    if (commandIndex >= commands.length)
      return;
    const entry = commands[commandIndex++];
    const args = entry.command.trim().split(' ').slice(1);
    await spawnAsyncOrDie(KYTHE_EXTRACTOR_PATH, ...args, {
      cwd: entry.directory,
      env: {
        KYTHE_ROOT_DIRECTORY,
        KYTHE_OUTPUT_DIRECTORY: KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY,
      }
    });
    progressBar.tick(1);
    await cxx_extractor();
  }
}

async function run_cxx_indexer() {
  const t = Date.now();
  const kzipFiles = (await readdirAsync(KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY)).filter(entry => entry.endsWith('.kzip'));
  console.log('Writing indexes...');
  await spawnAsyncOrDie('/bin/sh', path.join(__dirname, 'run_kythe_indexer.sh'), KYTHE_INDEXER_PATH, KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY, KYTHE_WRITE_ENTRIES_PATH, GRAPH_STORE_PATH, {
    stdio: 'inherit',
  });
  printDuration('CXX_INDEXER: ', Date.now() - t);
}

async function write_serving_table_from_entries() {
  const t = Date.now();
  console.log('Writing serving table...');
  await spawnAsyncOrDie(KYTHE_WRITE_TABLES_PATH, '--graphstore', GRAPH_STORE_PATH, '--out', KYTHE_SERVING_TABLE, '--num_workers', PARALLEL + '');
  printDuration('WRITE_TABLES: ', Date.now() - t);
}

function printDuration(label, time) {
  const quant = [1000, 60, 60];
  const suffix = ['ms', 'sec', 'min', 'h'];
  let i = 0;
  for (; i < quant.length; ++i) {
    if (time >= quant[i])
      time = time / quant[i];
    else
      break;
  }
  let timeText = '';
  if (i === 0) {
    timetext = time.toFixed(2) + suffix[0];
  } else {
    const div = Math.floor(time);
    const fl = time - div;
    timetext = `${div}${suffix[i]} ${Math.round(quant[i - 1] * fl)}${suffix[i - 1]}`;
  }
  console.log(`${label}${YELLOW_COLOR}${timetext}${RESET_COLOR}`);
}

function findLastIndex(a, p) {
  let lastIndex = -1;
  for (let i = 0; i < a.length; ++i) {
    if (p.call(null, a[i]))
      lastIndex = i;
  }
  return lastIndex;
}

async function question(q) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(fulfill => {
    rl.question(q, (answer) => {
      rl.close();
      fulfill(answer);
    });
  });
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
    throw new Error(`Failed to execute: "${command} ${args.join(' ')}".\n\n=== STDOUT ===\n${stdout}\n\n\n=== STDERR ===\n${stderr}`);
  return {stdout, stderr};
}
