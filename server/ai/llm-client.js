// ===== LLM API 调用客户端 =====
// 调用 DeepSeek / OpenAI 兼容 API 进行 AI 分析
// 支持 JSON Mode (response_format) 确保结构化输出

import aiConfig from './config.js';

/**
 * 调用 LLM API
 * @param {string} prompt - 完整 prompt 文本
 * @param {object} [options] - 可选覆盖配置
 * @returns {Promise<object>} 解析后的 JSON 对象
 */
export async function callLLM(prompt, options = {}) {
  const cfg = aiConfig.get();
  if (!cfg.apiKey) {
    throw new Error('AI_API_KEY 未配置，请在 .env 中设置 AI_API_KEY');
  }

  const model = options.model || cfg.model;
  const maxTokens = options.maxTokens || cfg.maxTokens;
  const temperature = options.temperature ?? cfg.temperature;
  const timeout = options.timeout || cfg.timeout;

  const url = `${cfg.apiBase}/chat/completions`.replace(/\/+chat/, '/chat');

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: '你是顶级的足球比赛数据分析师。始终以 JSON 格式输出分析结果。',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature,
  };

  // 对兼容 OpenAI 格式的 API 启用 JSON mode
  if (cfg.apiBase.includes('deepseek') || cfg.apiBase.includes('openai') || cfg.apiBase.includes('agnes')) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM API 错误 (${response.status}): ${err.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM 返回空内容');

    // 尝试解析 JSON
    try {
      return JSON.parse(content);
    } catch {
      // 如果返回内容包裹了 markdown 代码块，尝试提取
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) return JSON.parse(jsonMatch[1]);
      throw new Error(`LLM 返回非 JSON: ${content.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 快速测试 LLM 是否可访问
 */
export async function testConnection() {
  try {
    const result = await callLLM(
      '分析一场足球比赛并返回JSON: {"test": true}',
      { maxTokens: 100, temperature: 0 }
    );
    return { reachable: true, result };
  } catch (e) {
    return { reachable: false, error: e.message };
  }
}
