import Papa from 'papaparse'
import type { CsvConfig, CsvRemoveRule } from './csvConfig'

export type CsvCleanResult = {
  headerIndex: number
  originalRowCount: number
  cleanedRowCount: number
  removedRowCount: number
  rows: string[][]
  removedRows: string[][]
  removedByTimeRows: string[][]
  removedByCustomRows: string[][]
}

const DEFAULT_FOOTER_KEYWORDS = [
  '合计',
  '总计',
  '汇总',
  '说明',
  '注释',
  '数据来源',
  '更新时间',
] as const

function normalizeCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  // 去掉 UTF-8 BOM（经常出现在第一格）
  return String(v).replace(/^\uFEFF/, '')
}

function trimCell(v: string): string {
  return v.trim()
}

function rowIsEmpty(row: string[]): boolean {
  return row.every((c) => trimCell(c) === '')
}

function padRow(row: string[], len: number): string[] {
  if (row.length >= len) return row.slice(0, len)
  return [...row, ...Array.from({ length: len - row.length }, () => '')]
}

function sameRow(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (trimCell(a[i]) !== trimCell(b[i])) return false
  }
  return true
}

function hitFooterKeywords(row: string[], keywords: readonly string[]): boolean {
  for (const cell of row) {
    const s = trimCell(cell)
    if (!s) continue
    for (const kw of keywords) {
      if (s.includes(kw)) return true
    }
  }
  return false
}

function normalizeOutputRow(row: string[]): string[] {
  return row.map(trimCell)
}

export type EventTimeFilterMode = 'excludeMatch' | 'includeMatch'

export type EventTimeFilter = {
  enabled: boolean
  startDate?: string // yyyy-mm-dd
  endDate?: string // yyyy-mm-dd
  mode: EventTimeFilterMode
}

export type CleanCsvOptions = {
  eventTimeFilter?: EventTimeFilter
  csvConfig?: CsvConfig
}

function findEventTimeColIndex(headerRow: string[], names: readonly string[]): number {
  const set = new Set(names.map((x) => trimCell(x)).filter(Boolean))
  if (set.size === 0) set.add('事件时间')
  return headerRow.findIndex((c) => set.has(trimCell(c)))
}

function dateToStartMs(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0)
  const t = dt.getTime()
  return Number.isFinite(t) ? t : null
}

function dateToEndMs(dateStr: string): number | null {
  const start = dateToStartMs(dateStr)
  if (start === null) return null
  return start + 24 * 60 * 60 * 1000 - 1
}

function parseEventTimeMs(cell: string): number | null {
  const s = trimCell(cell)
  if (!s) return null
  const normalized = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s
  const t = Date.parse(normalized)
  return Number.isFinite(t) ? t : null
}

function matchTimeRange(
  eventTimeMs: number | null,
  startMs: number | null,
  endMs: number | null,
): boolean {
  if (eventTimeMs === null) return false
  if (startMs !== null && eventTimeMs < startMs) return false
  if (endMs !== null && eventTimeMs > endMs) return false
  return true
}

type CompiledRemoveRule = {
  name: string
  test: (row: string[]) => boolean
}

function resolveColumnIndices(
  headerRow: string[],
  column: CsvRemoveRule['column'],
): number[] | '*' | null {
  if (column === '*') return '*'
  if (typeof column === 'number') {
    const idx = Math.floor(column) - 1
    return idx >= 0 ? [idx] : null
  }
  const target = trimCell(column)
  if (!target) return null

  // 1) 精确匹配（trim 后完全相等）
  const exactIdx = headerRow.findIndex((c) => trimCell(c) === target)
  if (exactIdx >= 0) return [exactIdx]

  // 2) 兜底：唯一的“包含匹配”（避免多个列都匹配导致误删）
  const hits: number[] = []
  for (let i = 0; i < headerRow.length; i += 1) {
    const h = trimCell(headerRow[i])
    if (!h) continue
    if (h.includes(target) || target.includes(h)) hits.push(i)
  }
  if (hits.length === 1) return hits
  return null
}

function compileRemoveRules(
  headerRow: string[],
  rules: CsvRemoveRule[] | undefined,
): CompiledRemoveRule[] {
  if (!rules?.length) return []

  const compiled: CompiledRemoveRule[] = []
  for (const rule of rules) {
    if (rule.enabled === false) continue

    const indices = resolveColumnIndices(headerRow, rule.column)
    if (indices === null) continue

    const contains = rule.contains ?? true
    const ci = rule.caseInsensitive ?? false

    if (rule.matchType === 'regex') {
      const pattern = rule.pattern ?? ''
      if (!pattern) continue
      let flags = rule.flags ?? ''
      if (ci && !flags.includes('i')) flags += 'i'
      let re: RegExp
      try {
        re = new RegExp(pattern, flags)
      } catch {
        continue
      }

      compiled.push({
        name: rule.name,
        test: (row) => {
          const testCell = (s: string) => re.test(s)
          if (indices === '*') return row.some((c) => testCell(c))
          return indices.some((i) => testCell(row[i] ?? ''))
        },
      })
      continue
    }

    if (rule.matchType === 'keywords') {
      const keywordsRaw = rule.keywords ?? []
      const keywords = keywordsRaw
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
      if (!keywords.length) continue

      const norm = (s: string) => (ci ? s.toLowerCase() : s)
      const kwNorm = keywords.map(norm)

      const matchCell = (cell: string) => {
        const s = norm(trimCell(cell))
        if (!s) return false
        return contains
          ? kwNorm.some((k) => s.includes(k))
          : kwNorm.some((k) => s === k)
      }

      compiled.push({
        name: rule.name,
        test: (row) => {
          if (indices === '*') return row.some(matchCell)
          return indices.some((i) => matchCell(row[i] ?? ''))
        },
      })
      continue
    }
  }

  return compiled
}

export function rowsToTsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          // 1) 统一换行，避免粘贴到表格时错行
          // 2) TSV 中单元格包含 \t 会导致错列，所以替换成空格
          return normalizeCell(cell)
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\t/g, ' ')
        })
        .join('\t'),
    )
    .join('\n')
}

export function parseCsvFile(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: false,
      complete: (results) => {
        const data = results.data as unknown[]
        // papaparse 的 data 每一行通常是数组；也可能出现非数组（极少）
        const rows = data
          .filter((row) => Array.isArray(row))
          .map((row) => (row as unknown[]).map(normalizeCell))
        resolve(rows)
      },
      error: (err) => reject(err),
    })
  })
}

export function cleanCsvRows(
  rawRows: string[][],
  options: CleanCsvOptions = {},
): CsvCleanResult {
  const originalRowCount = rawRows.length
  const cfg = options.csvConfig
  const footerKeywords = (cfg?.footerKeywords?.length
    ? cfg.footerKeywords
    : DEFAULT_FOOTER_KEYWORDS) as readonly string[]
  const removeEmptyRows = cfg?.removeEmptyRows ?? true
  const removeDuplicateHeaderRows = cfg?.removeDuplicateHeaderRows ?? true
  const removeFooterKeywordRows = cfg?.removeFooterKeywordRows ?? true

  const maxLen = rawRows.reduce((m, r) => Math.max(m, r.length), 0)

  // 先找表头：默认取第一条“非空行”
  let headerIndex = -1
  for (let i = 0; i < rawRows.length; i += 1) {
    if (!rowIsEmpty(rawRows[i])) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    return {
      headerIndex: -1,
      originalRowCount,
      cleanedRowCount: 0,
      removedRowCount: originalRowCount,
      rows: [],
      removedRows: [],
      removedByTimeRows: [],
      removedByCustomRows: [],
    }
  }

  const header = rawRows[headerIndex]
  const tableLen = Math.max(header.length, maxLen)
  const headerNorm = padRow(header, tableLen).map(trimCell)

  const cleanedBase: string[][] = []
  const removedByRulesRows: string[][] = []
  for (let i = 0; i < rawRows.length; i += 1) {
    const row = rawRows[i]
    if (removeEmptyRows && rowIsEmpty(row)) continue

    // 表头行：保留（即使它命中关键词）
    if (i === headerIndex) {
      cleanedBase.push(normalizeOutputRow(padRow(row, tableLen)))
      continue
    }

    // 重复表头：删除（以 headerLen 为基准对齐）
    const rowPadded = padRow(row, tableLen)
    if (removeDuplicateHeaderRows && sameRow(rowPadded, headerNorm)) {
      removedByRulesRows.push(normalizeOutputRow(rowPadded))
      continue
    }

    // 表尾说明/合计：删除
    if (removeFooterKeywordRows && hitFooterKeywords(rowPadded, footerKeywords)) {
      removedByRulesRows.push(normalizeOutputRow(rowPadded))
      continue
    }

    cleanedBase.push(normalizeOutputRow(rowPadded))
  }

  // 自定义剔除：csvConfig.json 的 removeRules（命中即算被删除）
  const removedByCustomRows: string[][] = []
  let cleanedAfterCustom = cleanedBase
  if (cleanedBase.length > 1 && cfg?.removeRules?.length) {
    const headerRow = cleanedBase[0]
    const data = cleanedBase.slice(1)
    const compiledRules = compileRemoveRules(headerRow, cfg.removeRules)
    if (compiledRules.length) {
      const kept: string[][] = []
      for (const row of data) {
        const hit = compiledRules.some((r) => r.test(row))
        if (hit) removedByCustomRows.push(row)
        else kept.push(row)
      }
      cleanedAfterCustom = [headerRow, ...kept]
    }
  }

  // 时间筛选：按列名“事件时间”
  const tf = options.eventTimeFilter
  const removedByTimeRows: string[][] = []
  let cleaned = cleanedAfterCustom

  const eventTimeNames = (cfg?.eventTimeColumnNames?.length
    ? cfg.eventTimeColumnNames
    : ['事件时间']) as readonly string[]

  if (tf?.enabled && cleanedAfterCustom.length > 1) {
    const headerRow = cleanedAfterCustom[0]
    const eventTimeIdx = findEventTimeColIndex(headerRow, eventTimeNames)
    if (eventTimeIdx >= 0) {
      const mode: EventTimeFilterMode = tf.mode ?? 'includeMatch'
      const startMs = tf.startDate ? dateToStartMs(tf.startDate) : null
      const endMs = tf.endDate ? dateToEndMs(tf.endDate) : null

      const keptData: string[][] = []
      for (const row of cleanedAfterCustom.slice(1)) {
        const tMs = parseEventTimeMs(row[eventTimeIdx] ?? '')
        const match = matchTimeRange(tMs, startMs, endMs)
        const shouldRemove =
          mode === 'excludeMatch'
            ? match
            : mode === 'includeMatch'
              ? !match
              : false

        if (shouldRemove) removedByTimeRows.push(row)
        else keptData.push(row)
      }

      cleaned = [cleanedAfterCustom[0], ...keptData]
    }
  }

  const cleanedRowCount = cleaned.length
  const removedRowCount = Math.max(0, originalRowCount - cleanedRowCount)
  const removedRows = [
    ...removedByRulesRows,
    ...removedByCustomRows,
    ...removedByTimeRows,
  ]

  return {
    headerIndex,
    originalRowCount,
    cleanedRowCount,
    removedRowCount,
    rows: cleaned,
    removedRows,
    removedByTimeRows,
    removedByCustomRows,
  }
}


