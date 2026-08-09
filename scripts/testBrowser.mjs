// Attach to the browser started by scripts/test-browser.sh.
//
//   import {connect, sleep} from './scripts/testBrowser.mjs';
//   const {browser, page} = await connect();
//
// Playwright resolves from this repo's node_modules — the standalone
// `playwright` package is not installed and its browsers were never
// downloaded, so CDP against the system chromium is the route.
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(REPO + '/package.json');
const {chromium} = require('@playwright/test');

const PORT = process.env.WEBS_TEST_CDP_PORT || '9222';
const ORIGIN = process.env.WEBS_TEST_ORIGIN || 'http://localhost:8081';

export async function connect() {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  const page = browser.contexts()[0].pages().find((p) => p.url().startsWith(ORIGIN));
  if(!page) throw new Error(`no tab open on ${ORIGIN}`);
  return {browser, page};
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
