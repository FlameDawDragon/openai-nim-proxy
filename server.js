// server.js - OpenAI to NVIDIA NIM API Proxy
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// 🔥 REASONING DISPLAY TOGGLE - Shows/hides reasoning in output
const SHOW_REASONING = false; // Set to true to show reasoning with <think> tags

// 🔥 THINKING MODE TOGGLE - Enables thinking for specific models that support it
const ENABLE_THINKING_MODE = false; // Set to true to enable chat_template_kwargs thinking parameter

// Model mapping (adjust based on available NIM models)
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy',
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

// List models endpoint (OpenAI compatible)
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy'
  }));

  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions endpoint (main proxy with streaming fix)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages' });
    }

    // Smart model selection with fallback
    let nimModel = MODEL_MAPPING[model] || model; // Use mapped or pass-through
    if (!nimModel) {
      const modelLower = model.toLowerCase();
      if (modelLower.includes('gpt-4') || modelLower.includes('claude-opus') || modelLower.includes('405b')) {
        nimModel = 'meta/llama-3.1-405b-instruct';
      } else if (modelLower.includes('claude') || modelLower.includes('gemini') || modelLower.includes('70b')) {
        nimModel = 'meta/llama-3.1-70b-instruct';
      } else {
        nimModel = 'meta/llama-3.1-8b-instruct';
      }
    }

    // Enforce reasonable max_tokens (cap if 0 or undefined)
    const effectiveMaxTokens = max_tokens === 0 || !max_tokens ? 500 : Math.min(max_tokens, 9024);

    // Transform OpenAI request to NIM format
    const nimRequest = {
      model: nimModel,
      messages,
      temperature: temperature || 0.6,
      max_tokens: effectiveMaxTokens,
      extra_body: ENABLE_THINKING_MODE ? { chat_template_kwargs: { thinking: true } } : undefined,
      stream: stream || false
    };

    // Make request to NVIDIA NIM API
    const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream', // Always stream for compatibility, even if client doesn't request it
      timeout: 30000 // 30s timeout to handle slow responses
    });

    if (stream) {
      // Set SSE headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders(); // Ensure headers are sent immediately

      // Stream chunks directly from NIM
      response.data.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        if (chunkStr.includes('[DONE]')) {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (chunkStr.trim()) {
          try {
            const data = JSON.parse(chunkStr);
            if (data.choices?.[0]?.delta) {
              let content = data.choices[0].delta.content || '';
              const reasoning = data.choices[0].delta.reasoning_content;

              if (SHOW_REASONING && reasoning) {
                content = reasoningStarted ? reasoning : `<think>\n${reasoning}\n</think>\n\n${content}`;
                reasoningStarted = !reasoningStarted; // Toggle for next chunk
              } else if (reasoning) {
                delete data.choices[0].delta.reasoning_content; // Strip if not showing
              }

              data.choices[0].delta.content = content || '';
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
          } catch (e) {
            // Ignore parse errors, send raw if malformed
            res.write(`data: ${chunkStr}\n\n`);
          }
        }
      });

      response.data.on('end', () => res.end());
      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
        res.end();
      });
    } else {
      // Non-streaming fallback (for completeness, though Janitor uses stream)
      let fullData = '';
      response.data.on('data', (chunk) => fullData += chunk.toString());
      response.data.on('end', () => {
        const data = JSON.parse(fullData);
        const openaiResponse = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: data.choices.map(choice => ({
            index: choice.index,
            message: {
              role: choice.message.role,
              content: SHOW_REASONING && choice.message.reasoning_content
                ? `<think>\n${choice.message.reasoning_content}\n</think>\n\n${choice.message.content || ''}`
                : choice.message.content || ''
            },
            finish_reason: choice.finish_reason
          })),
          usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
        res.json(openaiResponse);
      });
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(error.response?.status || 500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'invalid_request_error',
        code: error.response?.status || 500
      }
    });
  }
});

// Catch-all for unsupported endpoints
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenAI to NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Reasoning display: ${SHOW_REASONING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Thinking mode: ${ENABLE_THINKING_MODE ? 'ENABLED' : 'DISABLED'}`);
});
