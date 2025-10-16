const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Handle larger payloads if needed

const ELECTRONHUB_API_KEY = process.env.ELECTRONHUB_API_KEY;
if (!ELECTRONHUB_API_KEY) {
  throw new Error('ELECTRONHUB_API_KEY environment variable is required');
}

const BASE_URL = 'https://api.electronhub.ai/v1';

app.all('/v1/*', async (req, res) => {
  const path = req.originalUrl.replace('/v1', '');
  const targetUrl = `${BASE_URL}${path}`;

  try {
    const config = {
      method: req.method,
      url: targetUrl,
      headers: {
        'Authorization': `Bearer ${ELECTRONHUB_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': req.headers.accept || 'application/json',
      },
      data: req.body,
      params: req.query,
      validateStatus: () => true, // Allow all status codes to be handled manually
    };

    if (req.body && req.body.stream === true) {
      // Handle streaming response
      config.responseType = 'stream';
      const response = await axios(config);

      // Set status and headers from upstream
      res.status(response.status);
      Object.entries(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      // Pipe the stream
      response.data.pipe(res);

      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).send('Stream error occurred');
        }
      });
    } else {
      // Handle non-streaming response
      const response = await axios(config);

      // Set status and headers from upstream
      res.status(response.status);
      Object.entries(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      res.send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    const status = error.response ? error.response.status : 500;
    const message = error.response ? error.response.data : { error: 'Internal server error' };
    res.status(status).json(message);
  }
});

// Fallback for non-v1 routes
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
});
