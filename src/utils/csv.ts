import Papa from 'papaparse'

export type CsvCleanResult = {
  headerIndex: number
  originalRowCount: number
  cleanedRowCount: number
  removedRowCount: number
  rows: string[][]
  removedRows: string[][]
  removedByTimeRows: string[][]
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

function hitFooterKeywords(row: string[]): boolean {
  for (const cell of row) {
    const s = trimCell(cell)
    if (!s) continue
    for (const kw of DEFAULT_FOOTER_KEYWORDS) {
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
}

function findEventTimeColIndex(headerRow: string[]): number {
  return headerRow.findIndex((c) => trimCell(c) === '事件时间')
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
    }
  }

  const header = rawRows[headerIndex]
  const tableLen = Math.max(header.length, maxLen)
  const headerNorm = padRow(header, tableLen).map(trimCell)

  const cleanedBase: string[][] = []
  const removedByRulesRows: string[][] = []
  for (let i = 0; i < rawRows.length; i += 1) {
    const row = rawRows[i]
    if (rowIsEmpty(row)) continue

    // 表头行：保留（即使它命中关键词）
    if (i === headerIndex) {
      cleanedBase.push(normalizeOutputRow(padRow(row, tableLen)))
      continue
    }

    // 重复表头：删除（以 headerLen 为基准对齐）
    const rowPadded = padRow(row, tableLen)
    if (sameRow(rowPadded, headerNorm)) {
      removedByRulesRows.push(normalizeOutputRow(rowPadded))
      continue
    }

    // 表尾说明/合计：删除
    if (hitFooterKeywords(rowPadded)) {
      removedByRulesRows.push(normalizeOutputRow(rowPadded))
      continue
    }

    cleanedBase.push(normalizeOutputRow(rowPadded))
  }

  // 时间筛选：按列名“事件时间”
  const tf = options.eventTimeFilter
  const removedByTimeRows: string[][] = []
  let cleaned = cleanedBase

  if (tf?.enabled && cleanedBase.length > 1) {
    const headerRow = cleanedBase[0]
    const eventTimeIdx = findEventTimeColIndex(headerRow)
    if (eventTimeIdx >= 0) {
      const mode: EventTimeFilterMode = tf.mode ?? 'includeMatch'
      const startMs = tf.startDate ? dateToStartMs(tf.startDate) : null
      const endMs = tf.endDate ? dateToEndMs(tf.endDate) : null

      const keptData: string[][] = []
      for (const row of cleanedBase.slice(1)) {
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

      cleaned = [cleanedBase[0], ...keptData]
    }
  }

  const cleanedRowCount = cleaned.length
  const removedRowCount = Math.max(0, originalRowCount - cleanedRowCount)
  const removedRows = [...removedByRulesRows, ...removedByTimeRows]

  return {
    headerIndex,
    originalRowCount,
    cleanedRowCount,
    removedRowCount,
    rows: cleaned,
    removedRows,
    removedByTimeRows,
  }
}


