import { resumeTemplate } from '../data/resumeDataTemplate';
import { normalizeSectionOrder } from '../constants/sectionOrder';
import type { ResumeState, SectionKey } from '../types/resume';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('简历字段格式不正确');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maxLength = 20000): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('简历文本格式或长度不正确');
  return value;
}

// Reconstruct known fields instead of merging arbitrary imported objects into Pinia.
export function normalizeResumeData(value: unknown): ResumeState {
  const input = record(value);
  const personal = record(input.personalInfo);
  const result = JSON.parse(JSON.stringify(resumeTemplate)) as ResumeState;
  for (const key of Object.keys(resumeTemplate.personalInfo) as (keyof ResumeState['personalInfo'])[]) {
    result.personalInfo[key] = text(personal[key], key === 'avatar' ? 3 * 1024 * 1024 : 20000);
  }

  const usedIds = new Set<number>();
  for (const section of ['education', 'workExperience', 'skills', 'projects', 'honors'] as const) {
    const source = input[section] ?? [];
    if (!Array.isArray(source) || source.length > 100) throw new Error('每个简历模块最多允许 100 条记录');
    const rows = source.map(value => {
      const sourceRow = record(value);
      const id = sourceRow.id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 1e9 || usedIds.has(id)) {
        throw new Error('简历记录 ID 无效或重复');
      }
      usedIds.add(id);
      const row: Record<string, string | number> = { id };
      for (const key of Object.keys(resumeTemplate[section][0])) {
        if (key !== 'id') row[key] = text(sourceRow[key]);
      }
      return row;
    });
    (result as unknown as Record<string, unknown>)[section] = rows;
  }

  result.summary = text(input.summary);
  result.sectionOrder = normalizeSectionOrder(Array.isArray(input.sectionOrder) ? input.sectionOrder as SectionKey[] : []);
  if (input.resumeSetting !== undefined) {
    const settings = record(input.resumeSetting);
    for (const key of ['themeColor1', 'themeColor2'] as const) {
      if (settings[key] !== undefined) {
        const color = text(settings[key]);
        if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('主题颜色格式不正确');
        result.resumeSetting[key] = color;
      }
    }
    if (settings.currentTemplate !== undefined) result.resumeSetting.currentTemplate = text(settings.currentTemplate, 100);
    const ranges = {
      fontSize: [8, 48], sectionSpacing: [0, 100], paragraphSpacing: [0, 100],
      padding_left_right: [0, 65], padding_top_bottom: [0, 65],
    } as const;
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
      if (settings[key] === undefined) continue;
      const value = settings[key];
      const [min, max] = ranges[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new Error('简历布局参数超出范围');
      }
      result.resumeSetting[key] = value;
    }
  }
  result.currentId = Math.max(0, ...usedIds) + 1;
  result.isFirstVisit = false;
  return result;
}
