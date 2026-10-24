<template>
  <div class="settings-container">
    <a-card class="settings-card" :bordered="false">
      <h2 class="title">必要设置</h2>

      <!-- 说明文字 -->
      <p class="tips">
        注意：此处调用接口使用的是 OpenAI 的接口格式
        （换言之，只要你的大模型接口厂商使用的是 OpenAI 格式，你填入都能正常调用接口）
        请填写你信任的服务地址、模型名称和 API Key。
      </p>
      <div class="input-group">
        <label for="model-name">大模型名称</label>
        <a-input id="model-name" v-model:value="settingsStore.modelName" placeholder="请输入模型名称" />
        <p class="tips">
          模型名称须与所用服务一致，例如 qwen-turbo。
          <a href="https://bailian.console.aliyun.com/#/model-market" target="_blank">
            查看阿里百炼模型大全
          </a>。
        </p>
      </div>

      <div class="input-group">
        <label for="api-key">API Key（使用大模型）</label>
        <a-input-password id="api-key" v-model:value="settingsStore.aliApiKey" placeholder="请输入 API Key"
          autocomplete="off" />
        <a-button type="link" @click="settingsStore.aliApiKey = ''">清除 API Key</a-button>
        <p class="tips">
          API Key 只保存在当前页面内存中，刷新或关闭页面后需要重新输入。
        </p>
      </div>

      <div class="input-group">
        <label for="api-url">API URL</label>
        <a-input id="api-url" v-model:value="settingsStore.aliApiUrl" placeholder="https://你的服务地址/v1/chat/completions" />
        <p class="tips">
          请使用你自己部署或信任的 HTTPS 服务，并确保它支持浏览器跨域请求。
          API Key 和提交给 AI 的简历内容会发送到这个地址。
          <a href="https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api" target="_blank">
            查看阿里百炼官方文档
          </a>。
        </p>
        <p class="tips" v-if="apiOrigin">请求接收方：{{ apiOrigin }}</p>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '../../store/useSettingsStore';
import { computed } from 'vue';
const settingsStore = useSettingsStore();
const apiOrigin = computed(() => {
  try { return new URL(settingsStore.aliApiUrl).origin; } catch { return ''; }
});
</script>

<style scoped>
.settings-container {
  display: flex;
  justify-content: center;
  padding: 40px 20px;
}

.settings-card {
  width: 100%;
  max-width: 600px;
  background: var(--card-color);
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 6px 15px rgba(0, 0, 0, 0.1);
  color: var(--text-color);
}

.title {
  font-size: 22px;
  font-weight: bold;
  margin-bottom: 24px;
  text-align: center;
  color: var(--primary-color);
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

label {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-color);
}

.tips {
  font-size: 13px;
  background: rgba(0, 0, 0, 0.05);
  padding: 10px;
  border-radius: 8px;
  color: var(--text-color-secondary);
  line-height: 1.5;
  text-align: justify;
}

.tips a {
  color: var(--primary-color);
  font-weight: 600;
  text-decoration: none;
  transition: color 0.3s;
}

.tips a:hover {
  color: var(--primary-color-hover);
  text-decoration: underline;
}
</style>
