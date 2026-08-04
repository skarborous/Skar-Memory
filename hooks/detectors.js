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

/** Strip quoted runs so && inside python -c / here-strings is not treated as PS separator. */
function stripQuotedShellSegments(command) {
  let out = String(command || '');
  out = out.replace(/'(?:''|[^'])*'/g, '');
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '');
  return out;
}

function hasPowerShellAndOperator(command) {
  return /(^|\s)&&(\s|$)/.test(stripQuotedShellSegments(command));
}

/** Parse lean-ctx / shell failure markers when Cursor omits exit_code. */
function parseLeanCtxExit(text) {
  const hay = String(text || '');
  let m = hay.match(/\bEXIT\s+(\d+)\s*[—\-–:]\s*([^\n\r]+)/i);
  if (m) return { code: Number(m[1]), message: String(m[2] || '').trim() };
  m = hay.match(/\[exit:(\d+)\]/i);
  if (m) return { code: Number(m[1]), message: '' };
  m = hay.match(/Command failed with exit code\s+(\d+)/i);
  if (m) return { code: Number(m[1]), message: '' };
  return null;
}

function looksLikeExecutionFailure(text) {
  const hay = String(text || '');
  if (parseLeanCtxExit(hay)) return true;
  return /CommandNotFoundException|is not recognized as the name|FullyQualifiedErrorId|token '&&' is not a valid|lean-ctx replace mode is active|ctx_shell detected a|command not found|Missing file specification after redirection|Python was not found|App execution aliases|MCP error\s*-?\d+|Invalid arguments:|ERROR:\s|refusing to scan|privacy-protected|\[BLOCKED\]|\bCONFLICT\b|old_string not found|old_text not found|Tool execution error/i.test(hay);
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
    // MCP schema reject: {"error":"MCP error -32602: task is required"}
    test: /MCP error\s*-?32602:\s*([\w'"\[\].]+)\s+is required|ERROR:\s*(?:'([^']+)'\s+parameter\s+is required|([\w'"\[\].]+)\s+is required)|Invalid arguments:[\s\S]*?\b([A-Za-z_][\w]*)\s*:\s*Required\b|\b(task|pattern|query|path|server|toolName|toolname|name|id|command)\s+is required\b/i,
    build(m) {
      const raw = String(m[1] || m[2] || m[3] || m[4] || m[5] || 'param').replace(/['"]/g, '');
      const param = raw.toLowerCase().replace(/[^a-z0-9_+.-]/g, '').slice(0, 40) || 'param';
      const hints = {
        task: 'ctx_compose needs task="...". Call GetMcpTools(server="user-lean-ctx", toolName="ctx_compose") if unsure.',
        pattern: 'ctx_search / ctx_glob need pattern="...". Do not omit it.',
        query: 'This lean-ctx tool needs query="...".',
        path: 'Pass an explicit project path= (not home / drive root).',
        server: 'CallMcpTool needs server="...". Discover with GetMcpTools first.',
        toolname: 'CallMcpTool needs toolName="...". Discover with GetMcpTools first.',
        name: 'Pass name= (or handle) for this lean-ctx action.',
        id: 'Pass id= / handle (e.g. @F1). Use ctx_expand(action="list") if needed.',
        command: 'ctx_shell needs command="...".',
      };
      return {
        key: 'lean-ctx-required:' + param,
        lesson: 'lean-ctx/MCP rejected missing required param `' + param + '`. ' +
          (hints[param] || 'Call GetMcpTools for the tool schema, then retry with required fields. Do not repeat the empty call.'),
      };
    },
  },
  {
    test: /MCP error\s*-?\d+/i,
    build(m) {
      const code = (String(m[0]).match(/-?\d+/) || ['unknown'])[0];
      return {
        key: 'lean-ctx-mcp:' + code,
        lesson: 'MCP tool call failed (' + code + '). Read the error, call GetMcpTools for the schema, fix args — do not retry the same invalid call.',
      };
    },
  },
  {
    test: /refusing to scan|privacy-protected directory/i,
    build() {
      return {
        key: 'lean-ctx-path-scope',
        lesson: 'lean-ctx refuses home/drive-root scans. Pass path= to a specific project directory (e.g. Documents/GitHub/<repo>).',
      };
    },
  },
  {
    test: /\[BLOCKED\]/i,
    build() {
      return {
        key: 'lean-ctx-shell-blocked',
        lesson: 'ctx_shell permanently blocked this command class. Escalate to ctx_execute(language="shell") or use a different tool — do not retry ctx_shell.',
      };
    },
  },
  {
    test: /\bCONFLICT\b|old_string not found|old_text not found|preimage mismatch/i,
    build() {
      return {
        key: 'lean-ctx-patch-stale',
        lesson: 'lean-ctx patch/edit stale (CONFLICT / old_string not found). Re-read with ctx_read, then retry with fresh anchors/text — do not reuse the failed patch.',
      };
    },
  },
  {
    // lean-ctx formats: EXIT 9009 — Python was not found … App execution aliases
    test: /EXIT\s+9009\b[\s\S]*Python was not found|Python was not found[\s\S]*App execution aliases/i,
    build() {
      return {
        key: 'win-python-store-alias',
        lesson: 'Windows App Execution Alias for python (exit 9009). Use `py -3`, full path to python.exe, or disable python/python3 aliases under Settings > Apps > Advanced app settings > App execution aliases.',
      };
    },
  },
  {
    test: /EXIT\s+9009\b/i,
    build(_m, command) {
      const cmd = commandHead(command);
      return {
        key: 'missing-binary:' + cmd,
        lesson: cmd + ' not found (Windows exit 9009). Install it, use full path, or disable App execution aliases if it is a Store stub.',
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
  stripQuotedShellSegments,
  hasPowerShellAndOperator,
  parseLeanCtxExit,
  looksLikeExecutionFailure,
  isJunkFailureText,
  isPromotableSignature,
  UNIX_EQUIVALENTS,
  SHADOWED_ALIASES,
};
