// Tee the test browser's console into a log file, so a reproduction run can be
// read back afterwards.
//
//   node scripts/testBrowserConsole.mjs &        # writes tmp/test-browser.log
import {appendFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connect} from './testBrowser.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = process.env.WEBS_TEST_LOG || resolve(REPO, 'tmp/test-browser.log');

mkdirSync(dirname(LOG), {recursive: true});
const write = (line) => appendFileSync(LOG, line + '\n');

const {browser} = await connect();
const context = browser.contexts()[0];

const attach = (page) => {
  write(`=== attached to ${page.url()} ===`);
  page.on('console', (msg) => write(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => write(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => write(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`));
  page.on('framenavigated', (frame) => {
    if(frame !== page.mainFrame()) write(`=== subframe ${frame.url()} ===`);
  });
};

context.pages().forEach(attach);
context.on('page', attach);

write(`=== watching, log at ${LOG} ===`);
setInterval(() => {}, 1 << 30);
