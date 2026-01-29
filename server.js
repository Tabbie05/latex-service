const express = require('express');
const cors = require('cors');
const latex = require('node-latex');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ 
    status: 'LaTeX Compilation Service Running',
    version: '1.0.1'
  });
});

app.post('/compile', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'No content provided' });
    }

    console.log('📝 Compiling LaTeX, length:', content.length);

    // Create a NEW stream for each compilation
    const input = Readable.from([content]);
    
    // Use SINGLE pass to avoid stream reuse error
    const options = {
      cmd: 'pdflatex',
      passes: 1  // ✅ CHANGED FROM 2 TO 1 - fixes the stream error
    };

    const pdf = latex(input, options);
    const chunks = [];

    pdf.on('data', chunk => {
      chunks.push(chunk);
    });
    
    pdf.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      
      if (pdfBuffer.length === 0) {
        console.error('❌ Empty PDF generated');
        return res.status(500).json({ error: 'Generated empty PDF' });
      }
      
      console.log('✅ Success! PDF size:', pdfBuffer.length, 'bytes');
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename=document.pdf');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(pdfBuffer);
    });

    pdf.on('error', err => {
      console.error('❌ LaTeX compilation error:', err.message);
      res.status(500).json({ 
        error: 'LaTeX compilation failed',
        details: err.message 
      });
    });

  } catch (error) {
    console.error('❌ Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LaTeX service running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/`);
  console.log(`📍 Compile endpoint: http://localhost:${PORT}/compile`);
});