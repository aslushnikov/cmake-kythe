#!/usr/bin/env node

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
const readFileAsync = util.promisify(fs.readFile);
const existsAsync = util.promisify(fs.exists);

const RED_COLOR = '\x1b[31m';
const GREEN_COLOR = '\x1b[32m';
const YELLOW_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

if (process.argv.length !== 3) {
  console.log('ERROR: must have a single argument pointing to project config');
  return 1;
}

(async() => {
  const config = await readConfig(process.argv[2]);
  if (await existsAsync(config.OUTPUT_DIRECTORY)) {
    const text = await question(`Output directory ${config.OUTPUT_DIRECTORY} exists - ${RED_COLOR}DELETE?${RESET_COLOR} (Y/n) `);
    const answer = text.trim().toLowerCase();
    if (answer === 'y') {
      await rmAsync(config.OUTPUT_DIRECTORY);
    } else if (answer === 'n') {
      console.log(`OK - ${YELLOW_COLOR}just serving${RESET_COLOR} then.`);
      await serve(config);
      return null;
    } else {
      console.log('ERROR: did not understand your answer!');
      return null;
    }
  }
  await mkdirAsync(config.OUTPUT_DIRECTORY);
  const compile_commands = require(config.COMPILE_COMMANDS_PATH);
  const lastCommandIndex = findLastIndex(compile_commands, entry => entry.file.includes(config.SUBTREE));
  const commands = compile_commands.slice(0, lastCommandIndex + 1);
  console.log(`Processing ${commands.length} out of ${compile_commands.length} commands`);
  if (!commands.length) {
    console.log('ERROR: NO COMMANDS TO PROCESS!');
    return 1;
  }

  const t = Date.now();
  await run_cxx_extractor(config, commands);
  await run_cxx_indexer(config);
  await write_serving_table_from_entries(config);
  printDuration('Total time: ', Date.now() - t);

  await serve(config);
})();

async function serve(config) {
  console.log(`Serving on ${config.KYTHE_WEB_UI_PORT}`);
  await spawnAsyncOrDie(config.KYTHE_HTTP_SERVER, '--public_resources', config.KYTHE_WEB_UI, '--listen', config.KYTHE_WEB_UI_PORT, '--serving_table', config.KYTHE_SERVING_TABLE);
}

async function run_cxx_extractor(config, commands) {
  const t = Date.now();
  await rmAsync(config.KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY);
  await mkdirAsync(config.KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY);

  let commandIndex = 0;
  const progressBar = new ProgressBar(`Running cxx_extractor with ${config.PARALLEL} workers [:bar] :current/:total :percent :etas `, {
    complete: '.',
    incomplete: ' ',
    width: 20,
    total: commands.length,
  });
  await Promise.all([...Array(config.PARALLEL)].map(cxx_extractor));
  printDuration('CXX_EXTRACTION: ', Date.now() - t);

  async function cxx_extractor() {
    if (commandIndex >= commands.length)
      return;
    const entry = commands[commandIndex++];
    const args = entry.command.trim().replace(/\\"/g, '"').replace(/""/g, '').split(' ').slice(1);
    await spawnAsyncOrDie(config.KYTHE_EXTRACTOR_PATH, ...args, {
      cwd: entry.directory,
      env: {
        KYTHE_ROOT_DIRECTORY: config.KYTHE_ROOT_DIRECTORY,
        KYTHE_OUTPUT_DIRECTORY: config.KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY,
      }
    });
    progressBar.tick(1);
    await cxx_extractor();
  }
}

async function run_cxx_indexer(config) {
  const t = Date.now();
  const kzipFiles = (await readdirAsync(config.KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY)).filter(entry => entry.endsWith('.kzip'));
  console.log('Writing indexes...');
  await spawnAsyncOrDie('/bin/sh', path.join(__dirname, 'run_kythe_indexer.sh'), config.KYTHE_INDEXER_PATH, config.KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY, config.KYTHE_WRITE_ENTRIES_PATH, config.GRAPH_STORE_PATH, {
    stdio: 'inherit',
  });
  printDuration('CXX_INDEXER: ', Date.now() - t);
}

async function write_serving_table_from_entries(config) {
  const t = Date.now();
  console.log('Writing serving table...');
  await spawnAsyncOrDie(config.KYTHE_WRITE_TABLES_PATH, '--graphstore', config.GRAPH_STORE_PATH, '--out', config.KYTHE_SERVING_TABLE, '--num_workers', config.PARALLEL + '');
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

async function readConfig(jsonPath) {
  const json = JSON.parse(await readFileAsync(jsonPath));
  if (!json.output_directory)
    throw new Error('ERROR: no output directory in the json config');
  const config = {
    KYTHE_EXTRACTOR_PATH: path.join(json.kythe_path, 'extractors/cxx_extractor'),
    KYTHE_INDEXER_PATH: path.join(json.kythe_path, 'indexers/cxx_indexer'),
    KYTHE_WRITE_ENTRIES_PATH: path.join(json.kythe_path, 'tools/write_entries'),
    KYTHE_WRITE_TABLES_PATH: path.join(json.kythe_path, 'tools/write_tables'),
    KYTHE_HTTP_SERVER: path.join(json.kythe_path, 'tools/http_server'),
    KYTHE_WEB_UI: path.join(json.kythe_path, 'web/ui'),
    KYTHE_WEB_UI_PORT: json.kythe_web_ui_port || 'localhost:8080',

    SUBTREE: json.subtree || '',

    PARALLEL: json.parallel || require('os').cpus().length,
    KYTHE_ROOT_DIRECTORY: json.project_directory,
    COMPILE_COMMANDS_PATH: json.cmake_compilation_database,

    OUTPUT_DIRECTORY: json.output_directory,
    KYTHE_CXX_EXTRACT_OUTPUT_DIRECTORY: path.join(json.output_directory, 'kzips'),
    GRAPH_STORE_PATH: path.join(json.output_directory, 'graphstore'),
    KYTHE_SERVING_TABLE: path.join(json.output_directory, 'serving'),
  };
  return config;
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
