'use strict';

// PowerShell replacements for Unix tools that do not exist on Windows.
const UNIX_EQUIVALENTS = {
  ls: 'Get-ChildItem', cat: 'Get-Content', grep: 'Select-String',
  rm: 'Remove-Item', cp: 'Copy-Item', mv: 'Move-Item', touch: 'New-Item',
  which: 'Get-Command', head: 'Select-Object -First N', tail: 'Get-Content -Tail N',
  pwd: 'Get-Location', echo: 'Write-Host', ps: 'Get-Process', kill: 'Stop-Process',
  find: 'Get-ChildItem -Recurse', xargs: 'ForEach-Object', tee: 'Tee-Object',
  sort: 'Sort-Object', uniq: 'Get-Unique', wc: 'Measure-Object',
  jq: 'ConvertFrom-Json', sed: 'PowerShell -replace', awk: 'PowerShell string ops',
  export: 'assign $env:NAME', source: 'dot-source the script',
  chmod: 'not applicable on Windows', chown: 'not applicable on Windows',
  ln: 'New-Item -ItemType SymbolicLink', df: 'Get-PSDrive', du: 'Measure-Object on Get-ChildItem',
};

// PowerShell aliases that shadow real executables and break Unix-style flags.
const SHADOWED_ALIASES = {
  curl: 'curl.exe',
  wget: 'Invoke-WebRequest or wget.exe',
  diff: 'git diff or Compare-Object',
};

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// Each detector turns raw failure output into a stable key plus a one-line
// lesson. Key stability matters: repeats must collapse onto the same entry.
const DETECTORS = [
  {
    test: /The term '([^']+)' is not recognized as the name of a cmdlet/i,
    build(m) {
      const cmd = String(m[1]).toLowerCase();
      if (UNIX_EQUIVALENTS[cmd]) {
        return {
          key: 'ps-unix-tool:' + cmd,
          lesson: 'Shell is PowerShell: ' + cmd + ' does not exist. Use ' + UNIX_EQUIVALENTS[cmd] + '.',
        };
      }
      return {
        key: 'missing-binary:' + cmd,
        lesson: cmd + ' is not installed or not on PATH. Do not retry it; use an installed alternative.',
      };
    },
  },
  {
    test: /ObjectNotFound:\s*\(([\w.-]+):String\)[^\n]*CommandNotFoundException/i,
    build(m) {
      const cmd = String(m[1]).toLowerCase();
      if (SHADOWED_ALIASES[cmd]) {
        return {
          key: 'ps-alias:' + cmd,
          lesson: cmd + ' is a PowerShell alias, not the Unix tool. Use ' + SHADOWED_ALIASES[cmd] + '.',
        };
      }
      if (UNIX_EQUIVALENTS[cmd]) {
        return {
          key: 'ps-unix-tool:' + cmd,
          lesson: 'Shell is PowerShell: ' + cmd + ' does not exist. Use ' + UNIX_EQUIVALENTS[cmd] + '.',
        };
      }
      return {
        key: 'missing-binary:' + cmd,
        lesson: cmd + ' is not available in this shell. Do not retry it.',
      };
    },
  },
  {
    test: /token '&&' is not a valid statement separator/i,
    build() {
      return {
        key: 'ps-no-and-operator',
        lesson: 'PowerShell 5.1 rejects && as a separator. Use ; or separate commands.',
      };
    },
  },
  {
    test: /Cannot bind parameter 'Encoding'[\s\S]*?utf8NoBOM/i,
    build() {
      return {
        key: 'ps-encoding-utf8nobom',
        lesson: 'PowerShell 5.1 has no utf8NoBOM encoding. Use [System.IO.File]::WriteAllText for BOM-free files.',
      };
    },
  },
  {
    test: /Missing an argument for parameter 'SessionVariable'/i,
    build() {
      return {
        key: 'ps-curl-alias',
        lesson: 'In PowerShell curl aliases Invoke-WebRequest and rejects Unix flags. Call curl.exe instead.',
      };
    },
  },
  {
    test: /ctx_shell detected a (file-write command|file download)/i,
    build() {
      return {
        key: 'ctx-shell-no-writes',
        lesson: 'ctx_shell blocks shell file writes and downloads. Create or edit files with ctx_edit instead.',
      };
    },
  },
  {
    test: /lean-ctx replace mode is active|Use the equivalent ctx_\* tool/i,
    build() {
      return {
        key: 'lean-ctx-shadow-mode',
        lesson: 'lean-ctx shadow mode denies native Grep/Glob/Write. Use ctx_search, ctx_glob, ctx_edit.',
      };
    },
  },
];

// Falls back to the first meaningful error line so novel failures still count.
function genericSignature(command, text) {
  const line = normalize(text).slice(0, 200);
  if (!line) return null;
  const head = normalize(command).split(/[\s;|]/)[0].toLowerCase().slice(0, 40);
  const fingerprint = line.replace(/["'`][^"'`]*["'`]/g, '?').replace(/\d+/g, 'N').slice(0, 120);
  return {
    key: 'generic:' + head + ':' + fingerprint,
    lesson: head + ' keeps failing with: ' + line.slice(0, 140),
  };
}

function detect(command, text) {
  const haystack = String(text || '');
  if (!haystack.trim()) return null;
  for (const detector of DETECTORS) {
    const match = haystack.match(detector.test);
    if (!match) continue;
    const built = detector.build(match);
    if (built) return built;
  }
  return genericSignature(command, haystack);
}

module.exports = { detect, normalize };
