self.onmessage = async (event) => {
  const { taskId, messages, userApiKey, model, API_URL } = event.data;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 90000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let currentText = '';
  let responseBytes = 0;
  const finish = (result: string) => self.postMessage({ taskId, isComplete: true, result });
  try {
    const url = new URL(API_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('API URL 必须使用 HTTPS');
    const body = JSON.stringify({ model, messages, stream: true });
    if (new TextEncoder().encode(body).byteLength > 256 * 1024) throw new Error('对话内容过长，请开启新对话');
    const response = await fetch(url.href, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userApiKey}`, 'Content-Type': 'application/json' },
      body, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: abortController.signal,
    });
    if (response.status === 401) throw new Error('认证失败，请检查 API Key');
    if (!response.ok) throw new Error(`请求失败，状态码：${response.status}`);
    if (!response.body) throw new Error('服务器未返回数据');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const processLine = (line: string): boolean => {
      if (!line.startsWith('data:')) return false;
      const data = line.slice(5).trim();
      if (!data) return false;
      if (data === '[DONE]') return true;
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error('AI 服务返回错误，请检查模型和配置');
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        currentText += delta;
        self.postMessage({ taskId, isComplete: false, result: currentText });
      }
      return false;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        responseBytes += value.byteLength;
        if (responseBytes > 2 * 1024 * 1024) throw new Error('AI 响应内容超过限制');
      }
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        if (processLine(line)) {
          finish(currentText);
          return;
        }
      }
      if (done) {
        if (pending.trim()) processLine(pending);
        finish(currentText);
        return;
      }
    }
  } catch (error) {
    finish(abortController.signal.aborted ? '请求超时，请稍后重试' : error instanceof Error ? error.message : '请求失败，请稍后重试');
  } finally {
    clearTimeout(timer);
    abortController.abort();
    await reader?.cancel().catch(() => {});
  }
};
