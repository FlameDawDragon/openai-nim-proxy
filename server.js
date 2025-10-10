// server.js - OpenAI to Hugging Face DeepSeek V3 Abliterated Proxy (Uncensored for Janitor AI)
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Hugging Face API configuration
const HF_API_BASE = process.env.HF_API_BASE || 'https://api-inference.huggingface.co/models/huihui-ai/DeepSeek-V3-abliterated';
const HF_API_KEY = process.env.HF_API_KEY;

// 🔥 REASONING DISPLAY TOGGLE - Shows/hides reasoning in output
const SHOW_REASONING = false; // Set to true to show reasoning with <think> tags

// 🔥 THINKING MODE TOGGLE - Enables thinking for specific models that support it
const ENABLE_THINKING_MODE = true; // Set to true to enable chat_template_kwargs thinking parameter

// Model mapping (adjust based on available HF models; default to uncensored DeepSeek)
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'huihui-ai/DeepSeek-V3-abliterated',
  'gpt-4': 'huihui-ai/DeepSeek-V3-abliterated',
  'gpt-4-turbo': 'huihui-ai/DeepSeek-V3-abliterated',
  'gpt-4o': 'huihui-ai/DeepSeek-V3-abliterated',
  'claude-3-opus': 'huihui-ai/DeepSeek-V3-abliterated',
  'claude-3-sonnet': 'huihui-ai/DeepSeek-V3-abliterated',
  'gemini-pro': 'huihui-ai/DeepSeek-V3-abliterated'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'OpenAI to HF DeepSeek V3 Abliterated Proxy', 
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
    owned_by: 'hf-deepseek-proxy'
  }));
  
  res.json({
    object: 'list',
    data: models
  });
});

// Chat completions endpoint (main proxy - non-streaming for stability)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;
    
    // Smart model selection with fallback
    let hfModel = MODEL_MAPPING[model];
    if (!hfModel) {
      hfModel = 'huihui-ai/DeepSeek-V3-abliterated'; // Default to uncensored variant
    }
    
    // Transform OpenAI request to HF format
    const effectiveMaxTokens = max_tokens === 0 || !max_tokens ? 800 : Math.min(max_tokens, 800);
    const hfRequest = {
      inputs: messages.map(m => `${m.role}: ${m.content}`).join('\n\n') + '\n\nassistant:', // Simple prompt format for HF
      parameters: {
        temperature: temperature || 1.15,
        max_new_tokens: effectiveMaxTokens,
        do_sample: true
      }
    };
    
    // Make request to HF API
    const response = await axios.post(`${HF_API_BASE}/v1/chat/completions`, hfRequest, {
      headers: {
        'Authorization': `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30s for full response
    });
    
    // Transform HF response to OpenAI format
    const generatedText = response.data[0].generated_text.trim(); // Extract generated content
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: generatedText
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
    
    res.json(openaiResponse);
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

app.listen(PORT, () => {
  console.log(`OpenAI to HF DeepSeek V3 Abliterated Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Reasoning display: ${SHOW_REASONING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Thinking mode: ${ENABLE_THINKING_MODE ? 'ENABLED' : 'DISABLED'}`);
});
