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
    version: '1.0.0'
  });
});

app.post('/compile', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'No content provided' });
    }

    console.log('📝 Compiling LaTeX, length:', content.length);

    const input = Readable.from([content]);
    const options = {
      cmd: 'pdflatex',
      passes: 2
    };

    const pdf = latex(input, options);
    const chunks = [];

    pdf.on('data', chunk => chunks.push(chunk));
    
    pdf.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      console.log('✅ Success! PDF size:', pdfBuffer.length);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.send(pdfBuffer);
    });

    pdf.on('error', err => {
      console.error('❌ Error:', err.message);
      res.status(500).json({ error: err.message });
    });

  } catch (error) {
    console.error('❌ Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LaTeX service on port ${PORT}`);
});