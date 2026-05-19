const express = require('express');
const cors = require('cors');
const latex = require('node-latex');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3001;

// Keep the process alive on any stray error. node-latex spawns child
// processes that can emit errors on streams we don't always own; without
// these guards the whole service exits with status 1 on a bad doc.
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException (process kept alive):', err && err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('💥 unhandledRejection (process kept alive):', err && err.stack || err);
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'LaTeX Compilation Service Running',
    version: '1.0.6',
    engine: 'xelatex',
    maxTimeout: '120s'
  });
});

app.post('/compile', async (req, res) => {
  let pdf;
  let timeoutHandle;
  let settled = false;

  const safeRespond = (status, body) => {
    if (settled || res.headersSent) return;
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    res.status(status).json(body);
  };

  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return safeRespond(400, { error: 'No content provided' });
    }

    console.log('📝 Starting compilation…');
    console.log('📄 Content length:', content.length, 'characters');

    const input = Readable.from([content]);
    input.on('error', (err) => {
      console.error('❌ Input stream error:', err.message);
      safeRespond(500, { error: 'Input stream error', details: err.message });
    });

    const options = {
      cmd: 'xelatex',
      passes: 1,
      errorLogs: true,
      inputs: process.env.TEXINPUTS || '',
      // -interaction=nonstopmode: never drop to interactive ? prompt on error.
      // -halt-on-error: exit immediately on the first error rather than continuing
      //   and accumulating cascade failures. Without these, an undefined command
      //   (e.g. \faExternalLinkAlt) hangs the child until our 90s timeout.
      args: ['-interaction=nonstopmode', '-halt-on-error']
    };

    console.log('⚙️  Spawning xelatex process…');

    try {
      pdf = latex(input, options);
    } catch (err) {
      console.error('❌ Failed to spawn xelatex:', err.message);
      return safeRespond(500, { error: 'Failed to spawn compiler', details: err.message });
    }

    const chunks = [];

    pdf.on('data', (chunk) => chunks.push(chunk));

    pdf.on('error', (err) => {
      const msg = err && err.message ? err.message : String(err);
      console.error('❌ LaTeX error:', msg);
      safeRespond(500, {
        error: 'LaTeX compilation failed',
        details: msg,
        hint: 'Check for undefined commands, missing packages, or syntax errors.'
      });
      // Drain any remaining bytes silently so the underlying child closes
      try { pdf.resume(); } catch (_) { /* noop */ }
    });

    pdf.on('end', () => {
      if (settled) return;
      const pdfBuffer = Buffer.concat(chunks);

      if (pdfBuffer.length === 0) {
        return safeRespond(500, {
          error: 'Generated empty PDF',
          hint: 'Check LaTeX syntax and package availability'
        });
      }

      console.log('✅ SUCCESS! PDF size:', pdfBuffer.length, 'bytes');
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename=document.pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(pdfBuffer);
    });

    timeoutHandle = setTimeout(() => {
      console.error('❌ Compilation timeout after 90 seconds');
      try { pdf && pdf.destroy(); } catch (_) { /* noop */ }
      safeRespond(504, {
        error: 'Compilation timeout',
        hint: 'Document too complex or server overloaded'
      });
    }, 90000);

  } catch (error) {
    console.error('❌ Server error:', error);
    safeRespond(500, { error: 'Internal server error', details: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 LaTeX Compilation Service');
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/`);
  console.log(`📍 Compile: http://localhost:${PORT}/compile`);
});
