const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// Keep the process alive on any stray error from spawned children or
// async cleanup. Without these guards a misbehaving doc could crash the
// service with exit status 1, which is what Render alerted on earlier.
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException (process kept alive):', err && err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('💥 unhandledRejection (process kept alive):', err && err.stack || err);
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const COMPILE_TIMEOUT_MS = 30000;

app.get('/', (req, res) => {
  res.json({
    status: 'LaTeX Compilation Service Running',
    version: '1.0.7',
    engine: 'xelatex',
    maxTimeout: `${COMPILE_TIMEOUT_MS / 1000}s`
  });
});

// Tail the last N bytes of a file (best-effort). Used to surface the
// LaTeX error log to clients without dumping multi-MB output.
async function tailFile(filePath, maxBytes = 4000) {
  try {
    const stat = await fsp.stat(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fh = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      await fh.read(buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

// Extract the most useful lines out of a LaTeX log (the lines starting
// with "!" are the actual error messages, plus a few surrounding lines).
function extractLatexError(log) {
  if (!log) return '';
  const lines = log.split(/\r?\n/);
  const errorLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('!')) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 4);
      errorLines.push(lines.slice(start, end).join('\n'));
    }
  }
  return errorLines.join('\n---\n') || lines.slice(-25).join('\n');
}

app.post('/compile', async (req, res) => {
  const reqId = crypto.randomBytes(4).toString('hex');
  let tmpDir;
  let child;
  let timeoutHandle;
  let settled = false;

  const safeRespond = (status, body) => {
    if (settled || res.headersSent) return;
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    res.status(status).json(body);
  };

  const sendPdf = (buffer) => {
    if (settled || res.headersSent) return;
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=document.pdf');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buffer);
  };

  const cleanup = async () => {
    if (tmpDir) {
      try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  };

  try {
    const { content } = req.body || {};

    if (!content || !content.trim()) {
      return safeRespond(400, { error: 'No content provided' });
    }

    console.log(`[${reqId}] 📝 Compile request — ${content.length} chars`);

    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tex-'));
    const inputPath = path.join(tmpDir, 'input.tex');
    const outputPath = path.join(tmpDir, 'input.pdf');
    const logPath = path.join(tmpDir, 'input.log');
    await fsp.writeFile(inputPath, content, 'utf8');

    // -interaction=nonstopmode: never drop to interactive ? prompt on error
    // -halt-on-error: exit on first error instead of cascading
    // -no-shell-escape: refuse to run shell commands embedded in the doc (safety)
    // -output-directory: keep generated files inside our scratch dir
    const args = [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-no-shell-escape',
      '-output-directory', tmpDir,
      inputPath,
    ];

    console.log(`[${reqId}] ⚙️  xelatex ${args.join(' ')}`);

    child = spawn('xelatex', args, {
      cwd: tmpDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    child.stdout.on('data', () => { /* discard; we read the PDF from disk */ });
    child.stderr.on('data', (d) => { stderrBuf += d.toString('utf8'); });

    child.on('error', (err) => {
      console.error(`[${reqId}] ❌ spawn error:`, err.message);
      safeRespond(500, { error: 'Failed to spawn compiler', details: err.message });
      cleanup();
    });

    child.on('exit', async (code, signal) => {
      console.log(`[${reqId}] xelatex exited code=${code} signal=${signal}`);

      try {
        if (signal) {
          safeRespond(504, {
            error: 'Compilation killed',
            details: `Signal: ${signal}`,
            hint: 'Document too complex or hit memory limit.'
          });
          return;
        }

        if (code !== 0) {
          const log = await tailFile(logPath);
          const errSummary = extractLatexError(log) || stderrBuf.slice(-2000) || 'Unknown error';
          console.error(`[${reqId}] ❌ LaTeX error:\n${errSummary.slice(0, 1500)}`);
          safeRespond(500, {
            error: 'LaTeX compilation failed',
            details: errSummary.slice(0, 4000),
            hint: 'Check for undefined commands, missing packages, or syntax errors.'
          });
          return;
        }

        // Success path — read the PDF off disk
        if (!fs.existsSync(outputPath)) {
          safeRespond(500, {
            error: 'Compiler exited 0 but produced no PDF',
            hint: 'This usually means the document had no \\begin{document}.'
          });
          return;
        }
        const pdf = await fsp.readFile(outputPath);
        if (pdf.length === 0) {
          safeRespond(500, { error: 'Generated empty PDF' });
          return;
        }
        console.log(`[${reqId}] ✅ PDF ready — ${pdf.length} bytes`);
        sendPdf(pdf);
      } finally {
        cleanup();
      }
    });

    timeoutHandle = setTimeout(() => {
      console.error(`[${reqId}] ❌ Timeout after ${COMPILE_TIMEOUT_MS}ms`);
      try { child && child.kill('SIGKILL'); } catch {}
      safeRespond(504, {
        error: 'Compilation timeout',
        hint: `xelatex did not finish within ${COMPILE_TIMEOUT_MS / 1000}s.`
      });
    }, COMPILE_TIMEOUT_MS);

    // If the client disconnects, kill the child so we don't leak
    res.on('close', () => {
      if (!settled && child) {
        console.warn(`[${reqId}] ⚠️  client disconnected — killing child`);
        try { child.kill('SIGTERM'); } catch {}
      }
    });

  } catch (error) {
    console.error('❌ Server error:', error);
    safeRespond(500, { error: 'Internal server error', details: error.message });
    cleanup();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 LaTeX Compilation Service');
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Engine: xelatex (direct spawn, ${COMPILE_TIMEOUT_MS / 1000}s timeout)`);
});
