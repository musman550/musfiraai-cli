#!/usr/bin/env node
/**
 * musfiraai-cli — request free tools, automations & n8n workflows from your terminal.
 * https://musfiraai.com
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const pkg = require('../package.json');

const API = {
  request: 'https://vfumvywhiwrgmankfqbg.supabase.co/functions/v1/request-tool',
  status: 'https://vfumvywhiwrgmankfqbg.supabase.co/functions/v1/request-status'
};
const STORAGE_URL = 'https://vfumvywhiwrgmankfqbg.supabase.co/storage/v1/object/tool-request-uploads';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmdW12eXdoaXdyZ21hbmtmcWJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4MTMzNDksImV4cCI6MjEwMTM4OTM0OX0.8hR2JthBtUGil31imgvwHFXoQcMxEB_qX2n2-fA_ZdU';

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  gold: '\x1b[38;5;220m', green: '\x1b[38;5;42m', red: '\x1b[38;5;203m', cyan: '\x1b[38;5;80m'
};
const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

// ---------------------------------------------------------------------------
// config + history (stored under ~/.musfiraai/)
// ---------------------------------------------------------------------------
const CONFIG_DIR = path.join(os.homedir(), '.musfiraai');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const HISTORY_PATH = path.join(CONFIG_DIR, 'history.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}
function saveConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); }
  catch { return []; }
}
function appendHistory(entry) {
  ensureConfigDir();
  const h = loadHistory();
  h.unshift(entry);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(h.slice(0, 100), null, 2));
}

// ---------------------------------------------------------------------------
// i18n — English / Roman Urdu
// ---------------------------------------------------------------------------
const STRINGS = {
  en: {
    tagline: '— free tools, automations & n8n workflows, on request',
    askName: 'Your name: ',
    askEmail: 'Your email: ',
    askType: 'What do you need?',
    chooseType: (n) => `  Choose 1-${n}: `,
    askDesc: 'Describe it (as much detail as you have): ',
    askFile: 'Attach a file/screenshot? path, or leave blank to skip: ',
    sending: 'Sending request...',
    received: 'Request received.',
    ref: 'Reference ID:',
    track: 'Track it any time with:',
    saveDefault: 'Save this name/email as default for next time? (y/n): ',
    nameRequired: 'Name is required.',
    emailInvalid: "That email doesn't look valid.",
    invalidChoice: 'Invalid choice.',
    descRequired: 'Description is required.',
    lookingUp: 'Looking up your requests...',
    noRequests: 'No requests found for this email.',
    fileNotFound: (p) => `File not found: ${p}`,
    fileTooBig: 'File must be under 8MB.',
    uploadFailed: 'File upload failed — continuing without it.'
  },
  ur: {
    tagline: '— free tools, automations aur n8n workflows, request pe',
    askName: 'Aapka naam: ',
    askEmail: 'Aapka email: ',
    askType: 'Aapko kya chahiye?',
    chooseType: (n) => `  1-${n} mein se choose karein: `,
    askDesc: 'Describe karein (jitni detail ho sakay): ',
    askFile: 'File/screenshot attach karni hai? path likhein, ya khaali chhodein: ',
    sending: 'Request bheji ja rahi hai...',
    received: 'Request mil gayi.',
    ref: 'Reference ID:',
    track: 'Track karne ke liye:',
    saveDefault: 'Naam/email agli baar ke liye save kar dein? (y/n): ',
    nameRequired: 'Naam zaroori hai.',
    emailInvalid: 'Ye email sahi nahi lagta.',
    invalidChoice: 'Ghalat choice.',
    descRequired: 'Description zaroori hai.',
    lookingUp: 'Aapki requests dhoondi ja rahi hain...',
    noRequests: 'Is email ke liye koi request nahi mili.',
    fileNotFound: (p) => `File nahi mili: ${p}`,
    fileTooBig: 'File 8MB se kam honi chahiye.',
    uploadFailed: 'File upload nahi ho saki — uske bina continue kar rahe hain.'
  }
};

function getLang(flags) {
  return flags.lang === 'ur' || process.env.MUSFIRAAI_LANG === 'ur' ? 'ur' : 'en';
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
let _rl = null;
let _pipedLines = null;
let _pipedIdx = 0;

function loadPipedLines() {
  if (_pipedLines !== null) return _pipedLines;
  try {
    const data = fs.readFileSync(0, 'utf8'); // fd 0 = stdin, synchronous full read
    _pipedLines = data.split('\n');
  } catch {
    _pipedLines = [];
  }
  return _pipedLines;
}

function ask(question) {
  if (!process.stdin.isTTY) {
    // non-interactive stdin (piped/redirected): read all lines upfront, consume in order
    process.stdout.write(question);
    const lines = loadPipedLines();
    const line = _pipedIdx < lines.length ? lines[_pipedIdx++] : '';
    process.stdout.write(line + '\n');
    return Promise.resolve(line.trim());
  }
  if (!_rl) _rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => _rl.question(question, (a) => resolve(a.trim())));
}
function closeAsk() {
  if (_rl) { _rl.close(); _rl = null; }
}

function failValidation(flags, message) {
  if (flags.json) console.log(JSON.stringify({ success: false, error: message }));
  else console.log(c('red', message));
  process.exitCode = 1;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPES = ['tool', 'automation', 'n8n_workflow', 'agent', 'other'];
const TYPE_LABELS = { tool: 'Custom Tool', automation: 'Automation', n8n_workflow: 'n8n Workflow', agent: 'AI Agent', other: 'Other' };
const TYPE_DESCRIPTIONS = {
  tool: 'A standalone script, scraper, dashboard, or utility built for one job.',
  automation: 'A workflow that runs on its own — schedule, webhook, or trigger based.',
  n8n_workflow: 'A ready or custom node chain built specifically for n8n.',
  agent: 'A chat, support, sales, or voice AI agent wired into your workflow.',
  other: "Anything that doesn't fit the above — describe it and we'll scope it."
};

async function parseJsonSafe(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Server returned an unexpected response (HTTP ${res.status}). Check your internet connection and try again.`); }
}

async function fetchWithRetry(url, opts, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, opts);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error(`Network error after ${attempts} attempts: ${lastErr.message}`);
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
      else { flags[key] = true; }
    } else {
      flags._.push(argv[i]);
    }
  }
  return flags;
}

function printBanner() {
  console.log(`
${c('gold', c('bold', '  __  __           __ _           _    ___ '))}
${c('gold', c('bold', ' |  \\/  |_  _ ___ / _(_)_ _ __ _ /_\\  |_ _|'))}
${c('gold', c('bold', ' | |\\/| | || (_-<  _| | \'_/ _\` / _ \\  | | '))}
${c('gold', c('bold', ' |_|  |_|\\_,_/__/_| |_|_| \\__,_/_/ \\_\\|___|'))}
`);
}

function printTagline(lang) {
  console.log(c('dim', `  ${STRINGS[lang].tagline}`) + '\n');
}

// ---------------------------------------------------------------------------
// update notifier (best-effort, silent on any failure, never blocks exit)
// ---------------------------------------------------------------------------
async function checkForUpdate() {
  try {
    const res = await fetch('https://registry.npmjs.org/musfiraai-cli/latest', { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && data.version !== pkg.version) {
      console.log(c('dim', `  (v${data.version} is available — updating in the background, ready next run)\n`));
    }
  } catch { /* silent — never block the CLI on this */ }
}

// Silently self-updates in a detached background process: checks the npm registry
// for a newer version and, if found, runs "npm install -g musfiraai-cli@latest".
// Runs after the current command has already printed its result, so it never
// adds latency to what the user is doing right now — the new version is simply
// ready the *next* time they run "musfiraai", with zero action on their part.
function selfUpdateInBackground() {
  if (process.env.MUSFIRAAI_NO_UPDATE) return;
  try {
    const { spawn } = require('child_process');
    const script = `
      const https = require('https');
      const { execSync } = require('child_process');
      https.get('https://registry.npmjs.org/musfiraai-cli/latest', { timeout: 4000 }, (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const latest = JSON.parse(data).version;
            if (latest && latest !== ${JSON.stringify(pkg.version)}) {
              execSync('npm install -g musfiraai-cli@latest', { stdio: 'ignore' });
            }
          } catch (e) {}
        });
      }).on('error', () => {});
    `;
    const child = spawn(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
  } catch { /* self-update must never break normal CLI use */ }
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function uploadAttachment(filePath, lang) {
  if (!fs.existsSync(filePath)) throw new Error(STRINGS[lang].fileNotFound(filePath));
  const stat = fs.statSync(filePath);
  if (stat.size > 8 * 1024 * 1024) throw new Error(STRINGS[lang].fileTooBig);

  const buffer = fs.readFileSync(filePath);
  const safeName = path.basename(filePath).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const objectPath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const res = await fetchWithRetry(`${STORAGE_URL}/${objectPath}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/octet-stream' },
    body: buffer
  });
  if (!res.ok) throw new Error(STRINGS[lang].uploadFailed);
  return objectPath;
}

async function cmdRequest(flags) {
  const lang = getLang(flags);
  const S = STRINGS[lang];
  const cfg = loadConfig();
  const nonInteractive = !!(flags.name && flags.email && flags.type && flags.description);

  if (!flags.json) { printBanner(); printTagline(lang); }

  let name = flags.name || cfg.name;
  let email = flags.email || cfg.email;
  let tool_type = flags.type;
  let description = flags.description;
  let filePath = flags.file;

  if (flags.json) {
    // non-interactive contract: never prompt, fail fast with clean JSON
    if (!name) return failValidation(flags, S.nameRequired);
    if (!EMAIL_RE.test(email || '')) return failValidation(flags, S.emailInvalid);
    if (!TYPES.includes(tool_type)) return failValidation(flags, S.invalidChoice);
    if (!description) return failValidation(flags, S.descRequired);
  } else {
    if (!name) { name = await ask(`${c('cyan', '?')} ${S.askName}`); }
    if (!name) return failValidation(flags, S.nameRequired);

    if (!email) { email = await ask(`${c('cyan', '?')} ${S.askEmail}`); }
    if (!EMAIL_RE.test(email)) return failValidation(flags, S.emailInvalid);

    if (!tool_type) {
      console.log(`${c('cyan', '?')} ${S.askType}`);
      TYPES.forEach((t, i) => console.log(`   ${i + 1}. ${TYPE_LABELS[t]}`));
      const choice = await ask(S.chooseType(TYPES.length));
      tool_type = TYPES[parseInt(choice, 10) - 1];
    }
    if (!TYPES.includes(tool_type)) return failValidation(flags, S.invalidChoice);

    if (!description) { description = await ask(`${c('cyan', '?')} ${S.askDesc}`); }
    if (!description) return failValidation(flags, S.descRequired);
  }

  if (filePath === undefined && !nonInteractive) {
    filePath = await ask(`${c('cyan', '?')} ${S.askFile}`);
  }
  if (filePath && /^(skip|no|none|n\/a|-)$/i.test(filePath.trim())) {
    filePath = '';
  }

  let attachment_url;
  if (filePath) {
    try { attachment_url = await uploadAttachment(filePath, lang); }
    catch (err) { if (!flags.json) console.log(c('red', `  ${err.message}`)); }
  }

  if (!nonInteractive && !cfg.email) {
    const save = await ask(`${c('cyan', '?')} ${S.saveDefault}`);
    if (/^(y|yes)$/i.test(save.trim())) saveConfig({ ...cfg, name, email });
  }

  if (!flags.json) process.stdout.write(c('dim', `\n${S.sending}`));

  try {
    const payload = { name, email, tool_type, description };
    if (attachment_url) payload.attachment_url = attachment_url;

    const res = await fetchWithRetry(API.request, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || 'Request failed.');

    appendHistory({ id: data.id, name, email, tool_type, description, created_at: new Date().toISOString() });

    if (flags.json) {
      console.log(JSON.stringify({ success: true, id: data.id }));
    } else {
      console.log(`\r${c('green', '✓')} ${S.received}                     `);
      console.log(c('dim', `  ${S.ref} ${data.id}`));
      console.log(c('dim', `  ${S.track} musfiraai status ${email}\n`));
    }
  } catch (err) {
    if (flags.json) console.log(JSON.stringify({ success: false, error: err.message }));
    else console.log(`\r${c('red', '✖')} ${err.message}                     \n`);
    process.exitCode = 1;
  }
}

async function cmdStatus(flags) {
  const lang = getLang(flags);
  const S = STRINGS[lang];
  let email = flags._[0] || flags.email;

  if (!flags.json) { printBanner(); printTagline(lang); }
  if (!email && !flags.json) email = await ask(`${c('cyan', '?')} ${S.askEmail}`);
  if (!EMAIL_RE.test(email || '')) {
    failValidation(flags, S.emailInvalid);
    return;
  }

  if (!flags.json) process.stdout.write(c('dim', S.lookingUp));

  try {
    const res = await fetchWithRetry(API.status, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || 'Lookup failed.');

    if (flags.json) { console.log(JSON.stringify(data)); return; }

    console.log(`\r${' '.repeat(30)}\r`);
    if (!data.requests || !data.requests.length) { console.log(c('dim', `${S.noRequests}\n`)); return; }

    const STATUS_COLOR = { pending: 'gold', in_progress: 'cyan', done: 'green', rejected: 'red' };
    data.requests.forEach((r) => {
      const date = new Date(r.created_at).toLocaleDateString();
      const status = c(STATUS_COLOR[r.status] || 'dim', r.status.toUpperCase().replace('_', ' '));
      console.log(`${status}  ${c('dim', date)}  ${TYPE_LABELS[r.tool_type] || r.tool_type}`);
      console.log(c('dim', `  ${r.description.slice(0, 90)}${r.description.length > 90 ? '...' : ''}`));
      console.log('');
    });
  } catch (err) {
    if (flags.json) console.log(JSON.stringify({ success: false, error: err.message }));
    else console.log(`\r${c('red', '✖')} ${err.message}                     \n`);
    process.exitCode = 1;
  }
}

function cmdHistory(flags) {
  const h = loadHistory();
  if (flags.json) { console.log(JSON.stringify(h)); return; }
  printBanner();
  if (!h.length) { console.log(c('dim', 'No requests made from this machine yet.\n')); return; }
  h.forEach((r) => {
    console.log(`${c('gold', r.id)}  ${c('dim', new Date(r.created_at).toLocaleString())}`);
    console.log(`  ${TYPE_LABELS[r.tool_type] || r.tool_type} — ${r.description.slice(0, 80)}`);
    console.log('');
  });
}

function cmdTypes() {
  printBanner();
  TYPES.forEach((t) => {
    console.log(`${c('gold', c('bold', TYPE_LABELS[t]))} ${c('dim', `(${t})`)}`);
    console.log(`  ${TYPE_DESCRIPTIONS[t]}\n`);
  });
}

function cmdConfig(flags) {
  const [sub, key, value] = flags._;
  if (sub === 'set' && key && value !== undefined) {
    const cfg = loadConfig();
    cfg[key] = value;
    saveConfig(cfg);
    console.log(c('green', `✓ ${key} saved.`));
    return;
  }
  if (sub === 'get' && key) {
    const cfg = loadConfig();
    console.log(cfg[key] !== undefined ? cfg[key] : c('dim', '(not set)'));
    return;
  }
  if (sub === 'clear') {
    saveConfig({});
    console.log(c('green', '✓ Config cleared.'));
    return;
  }
  console.log(`${c('bold', 'USAGE')}
  musfiraai config set <key> <value>   e.g. musfiraai config set email you@email.com
  musfiraai config get <key>
  musfiraai config clear
`);
}

function cmdCompletion(flags) {
  const shell = flags._[0] || 'bash';
  if (shell !== 'bash') { console.log(c('red', 'Only bash completion is available right now.')); return; }
  console.log(`# Add to ~/.bashrc:  eval "$(musfiraai completion bash)"
_musfiraai_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="request status history types config completion --help --version"
  COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
}
complete -F _musfiraai_completions musfiraai`);
}

function printHelp() {
  printBanner();
  console.log(`${c('bold', 'USAGE')}
  musfiraai request                    Start a new free build request (interactive)
  musfiraai request --name .. --email .. --type .. --description ..   (non-interactive)
  musfiraai status [email]             Check the status of your requests
  musfiraai history                    Show requests made from this machine
  musfiraai types                      List available request types
  musfiraai config set/get/clear       Manage saved defaults (name, email)
  musfiraai completion bash            Print a bash completion script
  musfiraai --help                     Show this help
  musfiraai --version                  Show version

${c('bold', 'FLAGS')}
  --json          Machine-readable output (request, status)
  --file <path>   Attach a file/screenshot to a request
  --lang ur       Roman Urdu prompts (or set MUSFIRAAI_LANG=ur)

${c('bold', 'EXAMPLES')}
  musfiraai request
  musfiraai request --lang ur
  musfiraai request --name "Ali" --email ali@x.com --type automation --description "..." --json
  musfiraai status you@email.com
`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseFlags(rest);

  if (!cmd || cmd === '--help' || cmd === '-h') return printHelp();
  if (cmd === '--version' || cmd === '-v') return console.log(pkg.version);

  if (cmd !== 'completion') checkForUpdate(); // fire-and-forget, non-blocking

  if (cmd === 'request') return cmdRequest(flags);
  if (cmd === 'status') return cmdStatus(flags);
  if (cmd === 'history') return cmdHistory(flags);
  if (cmd === 'types') return cmdTypes();
  if (cmd === 'config') return cmdConfig(flags);
  if (cmd === 'completion') return cmdCompletion(flags);

  console.log(c('red', `Unknown command: ${cmd}\n`));
  printHelp();
  process.exitCode = 1;
}

main().finally(() => { closeAsk(); selfUpdateInBackground(); });
