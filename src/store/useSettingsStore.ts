import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { LEGACY_API_ORIGIN } from '../utils/apiEndpoint';

// Remove credentials persisted by older releases before Pinia hydrates settings.
try {
  const saved = JSON.parse(localStorage.getItem('settings') || '{}');
  const migrated: Record<string, string | boolean> = {};
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const key of ['theme', 'modelName', 'aliApiUrl']) {
      if (typeof saved[key] === 'string') migrated[key] = saved[key];
    }
    if (typeof saved.isDark === 'boolean') migrated.isDark = saved.isDark;
    if (typeof migrated.aliApiUrl === 'string') {
      try {
        if (new URL(migrated.aliApiUrl).origin === LEGACY_API_ORIGIN) migrated.aliApiUrl = '';
      } catch {
        migrated.aliApiUrl = '';
      }
    }
  }
  localStorage.setItem('settings', JSON.stringify(migrated));
} catch {
  localStorage.removeItem('settings');
}

export const useSettingsStore = defineStore(
  'settings',
  () => {
    // 是否为暗黑模式
    const isDark = ref<boolean>(localStorage.getItem('theme') === 'dark');
    // 主题颜色
    const theme = ref<string>(isDark.value ? '#9c87fe' : '#672DEA');
    // 阿里云apikey
    const aliApiKey = ref<string>('');
    // 阿里云调用接口
    const aliApiUrl = ref<string>(import.meta.env.VITE_API_URL?.trim() || '');
    //模型名称
    const modelName = ref<string>('qwen-turbo');
    // 切换主题
    const toggleTheme = () => {
      isDark.value = !isDark.value;
      theme.value = isDark.value ? '#9c87fe' : '#672DEA';
      localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', isDark.value);
    };

    // 初始化主题
    const initTheme = () => {
      isDark.value = localStorage.getItem('theme') === 'dark';
      theme.value = isDark.value ? '#9c87fe' : '#672DEA';
      document.documentElement.classList.toggle('dark', isDark.value);
    };

    // 监听 isDark 变化，自动更新主题颜色和 class
    watch(isDark, (value) => {
      theme.value = value ? '#9c87fe' : '#672DEA';
      document.documentElement.classList.toggle('dark', value);
    });

    return {
      isDark,
      theme,
      toggleTheme,
      initTheme,
      aliApiKey,
      aliApiUrl,
      modelName
    };
  },
  {
    persist: { pick: ['isDark', 'theme', 'aliApiUrl', 'modelName'] },
  }
);
