// Readbit setup + deploy. Run by deploy.bat — safe to run again any time to update.
//   deploy.bat                  update the app (catalog refreshes itself once a month)
//   deploy.bat refresh          also download a fresh book catalog now
//   deploy.bat passphrase       choose a new passphrase
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CFG = join(ROOT, 'wrangler.jsonc');
const STATE = join(ROOT, 'setup', 'state.json');
const args = process.argv.slice(2).map(a => a.toLowerCase());
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async q => (await rl.question(q)).trim();
const say = (...a) => console.log(...a);
const env = { ...process.env };

function run(args, { capture = false, input } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT, env, shell: true, encoding: 'utf8', input,
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
function die(msg) { say('\n❌ ' + msg + '\n'); rl.close(); process.exit(1); }

// Hidden typing. The normal prompt reader is closed first, otherwise it also reads (and shows) the keys.
let rlClosed = false;
async function askHidden(q) {
  if (!rlClosed) { rl.close(); rlClosed = true; }
  const stdin = process.stdin;
  process.stdout.write(q);
  return new Promise(resolve => {
    let s = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const on = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { stdin.off('data', on); if (stdin.isTTY) stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); return resolve(s); }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') { if (s) { s = s.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch < ' ') continue;
        s += ch; process.stdout.write('*');
      }
    };
    stdin.on('data', on);
  });
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

say('\n=== Readbit setup ===\n');

// 1. Tools
if (!existsSync(join(ROOT, 'node_modules', 'wrangler')) || !existsSync(join(ROOT, 'node_modules', 'unbzip2-stream'))) {
  say('Installing tools (one time, about a minute)...');
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, shell: true, stdio: 'inherit' });
  if (r.status !== 0) die('Install failed. Check your internet and run deploy.bat again.');
}

// 2. Cloudflare account
let who = run(['whoami', '--json'], { capture: true });
if (!who.ok || state.relogin) {
  say('\nA browser window will open. Log in to the Cloudflare account you want Readbit on, then click Allow.\nTip: use a personal account, not a work/business one.\n');
  await ask('Press Enter to open the browser...');
  if (!run(['login']).ok) die('Login did not finish. Run deploy.bat again.');
  who = run(['whoami', '--json'], { capture: true });
  if (!who.ok) die('Still not logged in. Run deploy.bat again.');
}
let info = {};
try { info = JSON.parse(who.out.slice(who.out.indexOf('{'))); } catch {}
const accounts = info.accounts || [];
if (!accounts.length) die("Couldn't read your Cloudflare accounts. Run deploy.bat again.");
let acct = accounts.find(a => a.id === state.accountId);
if (!acct) {
  say('\nLogged in as: ' + (info.email || 'unknown'));
  accounts.forEach((a, i) => say(`  ${i + 1}) ${a.name}`));
  const pick = accounts.length === 1 ? 1 : Number(await ask('Which account should Readbit use? '));
  acct = accounts[pick - 1];
  if (!acct) die('Not a valid choice.');
  if ((await ask(`Use "${acct.name}" for Readbit? (y/n) `)).toLowerCase() !== 'y') {
    say('\nOK — logging you out so you can log in with a different account.');
    run(['logout']); state.relogin = true; save();
    die('Run deploy.bat again and log in with the account you want.');
  }
}
state.accountId = acct.id; delete state.relogin; save();
env.CLOUDFLARE_ACCOUNT_ID = acct.id;
say(`✓ Cloudflare account: ${acct.name}`);

// 3. Database (your shelves, progress, highlights)
if (!state.dbId) {
  say('\nCreating the Readbit database...');
  const r = run(['d1', 'create', 'readbit'], { capture: true });
  let m = r.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) {
    const l = run(['d1', 'list', '--json'], { capture: true });
    try { const db = JSON.parse(l.out.slice(l.out.indexOf('['))).find(d => d.name === 'readbit'); if (db) m = [db.uuid]; } catch {}
  }
  if (!m) { say(r.out); die('Could not create the database.'); }
  state.dbId = m[0]; save();
}
writeFileSync(CFG, readFileSync(CFG, 'utf8').replace(/"database_id":\s*"[^"]*"/, `"database_id": "${state.dbId}"`));
if (!run(['d1', 'execute', 'readbit', '--remote', '--file=schema.sql', '--yes'], { capture: true }).ok) die('Could not create the tables. Run deploy.bat again.');
say('✓ Database ready');

// 4. Book catalog from Project Gutenberg
const booksFile = join(ROOT, 'public', 'catalog', 'books.json');
const age = existsSync(booksFile) ? (Date.now() - statSync(booksFile).mtimeMs) / 864e5 : Infinity;
if (age > 30 || args.includes('refresh')) {
  say('\nBuilding the book catalog...');
  const { build } = await import('./build-catalog.mjs');
  try { const r = await build({ refresh: args.includes('refresh') }); say(`✓ Catalog: ${r.count.toLocaleString()} books`); }
  catch (e) {
    if (existsSync(booksFile)) say('⚠ Could not refresh the catalog (' + e.message + '). Keeping the current one.');
    else die('Could not build the catalog: ' + e.message + '\n   Check your internet and run deploy.bat again.');
  }
} else say(`✓ Catalog is ${Math.floor(age)} day(s) old (refreshes monthly; "deploy.bat refresh" to do it now)`);

// 5. Stamp the app version so phones pick up the update
const sw = join(ROOT, 'public', 'sw.js');
writeFileSync(sw, readFileSync(sw, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}';`));

// 6. Publish
say('\nPublishing Readbit...');
const d = run(['deploy'], { capture: true });
if (!d.ok) { say(d.out); die('Deploy failed. Run deploy.bat again.'); }
const url = (d.out.match(/https:\/\/readbit\.[a-z0-9-]+\.workers\.dev/i) || [])[0] || state.url;
if (url) { state.url = url; save(); writeFileSync(join(ROOT, 'READBIT-LINK.txt'), url + '\n'); }

// 7. Passphrase (stored on Cloudflare only as a salted hash)
if (!state.passSet || args.includes('passphrase')) {
  say('\nChoose the passphrase you will type once on each phone or computer.');
  say('Tip: a few words are easy to remember, e.g. "river mill quiet tide".');
  let p1 = '';
  for (;;) {
    p1 = await askHidden('Passphrase: ');
    if (p1.length < 8) { say('Use at least 8 characters.'); continue; }
    const p2 = await askHidden('Type it again: ');
    if (p1 === p2) break;
    say("They didn't match — try again.");
  }
  const salt = randomBytes(16), iter = 100000;
  const hash = pbkdf2Sync(p1.normalize('NFKC'), salt, iter, 32, 'sha256');
  const secret = `pbkdf2$${iter}$${salt.toString('base64')}$${hash.toString('base64')}`;
  const r = run(['secret', 'put', 'PASS_HASH'], { input: secret + '\n' });
  if (!r.ok) { say(r.out); die('Saving the passphrase failed. Run deploy.bat again.'); }
  state.passSet = true; save();
  say('✓ Passphrase saved');
}

say('\n✅ Readbit is live: ' + (url || '(see the Cloudflare dashboard > Workers)'));
say('\nNext:');
say('  • It opens in your browser now. Sign in with your passphrase.');
say('  • On your Android phone: open the same link in Chrome > menu ⋮ > "Add to Home screen" / "Install app".');
say('  • To update later, just run deploy.bat again.\n');
if (url && process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
if (!rlClosed) rl.close();
process.exit(0);
