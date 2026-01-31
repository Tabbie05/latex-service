const express = require('express');
const cors = require('cors');
const latex = require('node-latex');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'LaTeX Compilation Service Running',
    version: '1.0.2',
    engine: 'pdflatex',
    maxTimeout: '120s'
  });
});

// Compile endpoint
app.post('/compile', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'No content provided' });
    }

    console.log('📝 Starting compilation...');
    console.log('📄 Content length:', content.length, 'characters');

    // Create stream from content
    const input = Readable.from([content]);
    
    // Options for pdflatex
    const options = {
      cmd: 'pdflatex',
      passes: 1,
      errorLogs: true,
      inputs: process.env.TEXINPUTS || ''
    };

    console.log('⚙️  Spawning pdflatex process...');

    const pdf = latex(input, options);
    const chunks = [];
    let hasError = false;
    let errorMessage = '';

    // Collect PDF data
    pdf.on('data', chunk => {
      chunks.push(chunk);
    });
    
    // Handle completion
    pdf.on('end', () => {
      if (hasError) {
        console.error('❌ Compilation failed with errors');
        return res.status(500).json({ 
          error: 'LaTeX compilation failed',
          details: errorMessage
        });
      }

      const pdfBuffer = Buffer.concat(chunks);
      
      if (pdfBuffer.length === 0) {
        console.error('❌ Empty PDF generated');
        return res.status(500).json({ 
          error: 'Generated empty PDF',
          hint: 'Check LaTeX syntax and package availability'
        });
      }
      
      console.log('✅ SUCCESS! PDF size:', pdfBuffer.length, 'bytes');
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename=document.pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(pdfBuffer);
    });

    // Handle errors
    pdf.on('error', err => {
      hasError = true;
      errorMessage = err.message;
      console.error('❌ LaTeX error:', err.message);
      
      // Only send response if headers not sent
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'LaTeX compilation failed',
          details: err.message,
          hint: 'Check for missing packages or syntax errors'
        });
      }
    });

    // Timeout after 90 seconds
    setTimeout(() => {
      if (!res.headersSent) {
        console.error('❌ Compilation timeout after 90 seconds');
        pdf.destroy();
        res.status(504).json({ 
          error: 'Compilation timeout',
          hint: 'Document too complex or server overloaded'
        });
      }
    }, 90000);

  } catch (error) {
    console.error('❌ Server error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        details: error.message 
      });
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 LaTeX Compilation Service');
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/`);
  console.log(`📍 Compile: http://localhost:${PORT}/compile`);
});