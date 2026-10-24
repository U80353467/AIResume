import { computed } from "vue";
import { useSettingsStore } from "../store/useSettingsStore";
import type { DialogueHistory } from "../types/aiDialogue";
import { WorkerPool } from "../worker/workerPool";
import { validateApiEndpoint } from '../utils/apiEndpoint';

//读取用户设置的API地址和API Key
const settingsStore = useSettingsStore();
const API_URL = computed(() => settingsStore.aliApiUrl);
const userApiKey = computed(() => settingsStore.aliApiKey);
const model = computed(() => settingsStore.modelName);
// 创建线程池，最多 4 个工作线程
const workerPool = new WorkerPool(4);
export async function sendToQwenAIDialogue(messages: DialogueHistory,
  onResponse: (responseText: string, isComplete: boolean) => void): Promise<void> {
  const endpoint = validateApiEndpoint(API_URL.value);
  if (!userApiKey.value.trim()) throw new Error('请先在网站配置中填写 API Key。');
  if (!model.value.trim()) throw new Error('请先填写模型名称。');
  await new Promise<void>((resolve) => {
    workerPool.execute(messages, userApiKey.value.trim(), model.value.trim(), endpoint, (text, complete) => {
      onResponse(text, complete);
      if (complete) resolve();
    });
  });
}
