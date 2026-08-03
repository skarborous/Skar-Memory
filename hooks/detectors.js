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

function commandHead(command) {
  return normalize(command).split(/[\s;|&]+/)[0].toLowerCase().replace(/^['"]|['"]$/g, '').slice(0, 40) || 'unknown';
}

// ONLY named detectors are promotable — never invent generic fingerprints.
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
  {
    test: /\bcommand not found\b/i,
    build(_m, command) {
      const cmd = commandHead(command);
      if (UNIX_EQUIVALENTS[cmd] && process.platform === 'win32') {
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
    test: /Missing file specification after redirection operator/i,
    build() {
      return {
        key: 'ps-no-heredoc',
        lesson: "PowerShell rejects bash heredoc (<<). Use a here-string (@'...'@ / @\"...\"@) or write a temp file.",
      };
    },
  },
];

function isJunkFailureText(text) {
  const hay = String(text || '');
  if (!hay.trim()) return true;

  if (/BLOCKED by learned constraint/i.test(hay)) return true;
  if (/Learned constraints \(auto-captured/i.test(hay)) return true;
  if (/Durable memory \(MCP/i.test(hay)) return true;

  if (/Co-authored-by: Cursor|LF will be replaced by CRLF/i.test(hay)) return true;
  if (/Lines Words Characters Property/i.test(hay)) return true;
  if (/stargazersCount|"fullName":/i.test(hay)) return true;

  if (/npm notice run /i.test(hay)
    && !/CommandNotFoundException|is not recognized as the name|command not found/i.test(hay)) {
    return true;
  }

  if (/CMake (Warning|Error)|Selecting Windows SDK version/i.test(hay)
    && !/CommandNotFoundException|is not recognized as the name|command not found/i.test(hay)) {
    return true;
  }

  if (/Unexpected token ['"]?\}['"]? in expression|toBeInTheDocument|\bVitest\b|\bJest\b/i.test(hay)
    && !/CommandNotFoundException|is not recognized as the name/i.test(hay)) {
    return true;
  }

  if (/\/api\/[\w-]+|\/dashboard\/[\w-]+/.test(hay) && /[├└│]|Error: Upstream timed out/i.test(hay)) {
    return true;
  }

  if (/api[_-]?key|password|secret|bearer |Authorization:|sk-[a-zA-Z0-9]{10,}|OPENAI_API_KEY|SONARQUBE_TOKEN|VANTAGE_API_BASIC/i.test(hay)) {
    return true;
  }

  return false;
}

function isPromotableSignature(signature) {
  if (!signature || !signature.key || !signature.lesson) return false;
  const key = String(signature.key);
  if (key.indexOf('generic:') === 0 || key.indexOf('generic-exit:') === 0) return false;
  // Named keys: ps-no-and-operator OR namespace:detail
  if (/^[a-z][a-z0-9_-]*$/i.test(key)) return true;
  if (/^[a-z0-9][a-z0-9_-]*:[a-z0-9._+:-]+$/i.test(key)) return true;
  return false;
}

function detect(command, text) {
  const haystack = String(text || '');
  if (!haystack.trim()) return null;
  if (isJunkFailureText(haystack)) return null;

  for (const detector of DETECTORS) {
    const match = haystack.match(detector.test);
    if (!match) continue;
    const built = detector.build.length >= 2
      ? detector.build(match, command, haystack)
      : detector.build(match);
    if (built && isPromotableSignature(built)) return built;
  }
  // No generic fallback — unknown failures stay unrecorded.
  return null;
}

module.exports = {
  detect,
  normalize,
  commandHead,
  isJunkFailureText,
  isPromotableSignature,
  UNIX_EQUIVALENTS,
  SHADOWED_ALIASES,
};
