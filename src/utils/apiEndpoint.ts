export const LEGACY_API_ORIGIN = 'https://resumeai.404.pub';

export function validateApiEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请先在网站配置中填写你信任的 HTTPS API URL。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('API URL 必须使用 HTTPS，且不能包含账号、密码或片段。');
  }
  return url.href;
}
