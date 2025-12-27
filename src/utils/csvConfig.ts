export type CsvRemoveRule = {
  name: string
  enabled?: boolean
  /**
   * 列定位：
   * - string: 列名（必须与表头一致）
   * - number: 第 N 列（从 1 开始）
   * - "*": 任意列（整行任意单元格命中即剔除）
   */
  column: string | number | '*'
  matchType: 'regex' | 'keywords'
  // regex
  pattern?: string
  flags?: string
  // keywords
  keywords?: string[]
  // common
  contains?: boolean
  caseInsensitive?: boolean
}

export type CsvConfig = {
  version: 1
  eventTimeColumnNames?: string[]
  removeEmptyRows?: boolean
  removeDuplicateHeaderRows?: boolean
  removeFooterKeywordRows?: boolean
  footerKeywords?: string[]
  removeRules?: CsvRemoveRule[]
}

export const DEFAULT_CSV_CONFIG: CsvConfig = {
  version: 1,
  eventTimeColumnNames: ['事件时间'],
  removeEmptyRows: true,
  removeDuplicateHeaderRows: true,
  removeFooterKeywordRows: true,
  footerKeywords: ['合计', '总计', '汇总', '说明', '注释', '数据来源', '更新时间'],
  removeRules: [],
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x) => typeof x === 'string').map((x) => x.trim())
  return out.length ? out : undefined
}

function asRules(v: unknown): CsvRemoveRule[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: CsvRemoveRule[] = []
  for (const item of v) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? item.name : ''
    const columnRaw = item.column
    const column: CsvRemoveRule['column'] =
      columnRaw === '*'
        ? '*'
        : typeof columnRaw === 'string'
          ? columnRaw
          : typeof columnRaw === 'number'
            ? columnRaw
            : ''
    const matchType = item.matchType === 'regex' || item.matchType === 'keywords'
      ? item.matchType
      : null
    if (!name || !matchType || !column) continue

    out.push({
      name,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      column,
      matchType,
      pattern: typeof item.pattern === 'string' ? item.pattern : undefined,
      flags: typeof item.flags === 'string' ? item.flags : undefined,
      keywords: Array.isArray(item.keywords)
        ? item.keywords.filter((x) => typeof x === 'string')
        : undefined,
      contains: typeof item.contains === 'boolean' ? item.contains : undefined,
      caseInsensitive:
        typeof item.caseInsensitive === 'boolean' ? item.caseInsensitive : undefined,
    })
  }
  return out
}

export function parseCsvConfig(raw: unknown): CsvConfig {
  if (!isRecord(raw)) return DEFAULT_CSV_CONFIG
  const version = raw.version === 1 ? 1 : 1

  return {
    version,
    eventTimeColumnNames: asStringArray(raw.eventTimeColumnNames) ?? DEFAULT_CSV_CONFIG.eventTimeColumnNames,
    removeEmptyRows: asBoolean(raw.removeEmptyRows, DEFAULT_CSV_CONFIG.removeEmptyRows!),
    removeDuplicateHeaderRows: asBoolean(
      raw.removeDuplicateHeaderRows,
      DEFAULT_CSV_CONFIG.removeDuplicateHeaderRows!,
    ),
    removeFooterKeywordRows: asBoolean(
      raw.removeFooterKeywordRows,
      DEFAULT_CSV_CONFIG.removeFooterKeywordRows!,
    ),
    footerKeywords: asStringArray(raw.footerKeywords) ?? DEFAULT_CSV_CONFIG.footerKeywords,
    removeRules: asRules(raw.removeRules) ?? DEFAULT_CSV_CONFIG.removeRules,
  }
}

export async function fetchCsvConfig(): Promise<{ config: CsvConfig; error?: string }> {
  try {
    const res = await fetch('/csvConfig.json', { cache: 'no-store' })
    if (!res.ok) {
      // 没有配置文件就用默认
      return { config: DEFAULT_CSV_CONFIG }
    }
    const json = (await res.json()) as unknown
    return { config: parseCsvConfig(json) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { config: DEFAULT_CSV_CONFIG, error: msg }
  }
}


