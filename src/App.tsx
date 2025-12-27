import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import './App.css'
import {
  cleanCsvRows,
  parseCsvFile,
  rowsToTsv,
} from './utils/csv'
import { fetchCsvConfig, type CsvConfig } from './utils/csvConfig'

type ParsedItem = {
  id: string
  file: File
  rawRows: string[][]
  cleanedRows: string[][]
  removedRows: string[][]
  removedByTimeCount: number
  removedByCustomCount: number
  originalRowCount: number
  removedRowCount: number
  error?: string
  copiedAt?: number
  noticeText?: string
  noticeKind?: 'success' | 'error'
  noticeAt?: number
}

async function copyText(text: string): Promise<void> {
  // 优先使用现代 Clipboard API（在 localhost 通常可用）
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  // 降级：execCommand
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', 'true')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  if (!ok) throw new Error('copy_failed')
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

export default function App() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  // 用于“取消/忽略”正在进行的解析：清空列表时递增版本号，旧版本解析结束后不再写入 items
  const parseSeqRef = useRef(0)
  const parsingCountRef = useRef(0)
  const [items, setItems] = useState<ParsedItem[]>([])
  const [isParsing, setIsParsing] = useState(false)
  const [globalMsg, setGlobalMsg] = useState<string | null>(null)
  const [timeFilterEnabled, setTimeFilterEnabled] = useState(false)
  const [timeFilterStart, setTimeFilterStart] = useState('')
  const [timeFilterEnd, setTimeFilterEnd] = useState('')
  const [csvConfig, setCsvConfig] = useState<CsvConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCsvConfig().then(({ config, error }) => {
      if (cancelled) return
      setCsvConfig(config)
      if (error) setGlobalMsg(`csvConfig.json 加载失败，已使用默认配置：${error}`)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const ok = items.filter((x) => !x.error).length
    const failed = items.filter((x) => x.error).length
    return { total: items.length, ok, failed }
  }, [items])

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const mySeq = (parseSeqRef.current += 1)
      parsingCountRef.current += 1
      setIsParsing(true)

      const files = Array.from(fileList).filter((f) => {
        const nameOk = f.name.toLowerCase().endsWith('.csv')
        const typeOk = (f.type || '').toLowerCase().includes('csv')
        return nameOk || typeOk
      })

      if (files.length === 0) {
        setGlobalMsg('未检测到 CSV 文件（请拖入 .csv）')
        parsingCountRef.current = Math.max(0, parsingCountRef.current - 1)
        setIsParsing(parsingCountRef.current > 0)
        return
      }

      setGlobalMsg(null)
      try {
        const parsed = await Promise.all(
          files.map(async (file) => {
            const id =
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`

            try {
              const rawRows = await parseCsvFile(file)
              const cleaned = cleanCsvRows(rawRows, {
                eventTimeFilter: {
                  enabled: timeFilterEnabled,
                  startDate: timeFilterStart || undefined,
                  endDate: timeFilterEnd || undefined,
                  mode: 'includeMatch',
                },
                csvConfig: csvConfig ?? undefined,
              })
              return {
                id,
                file,
                rawRows,
                cleanedRows: cleaned.rows,
                removedRows: cleaned.removedRows,
                removedByTimeCount: cleaned.removedByTimeRows.length,
                removedByCustomCount: cleaned.removedByCustomRows.length,
                originalRowCount: cleaned.originalRowCount,
                removedRowCount: cleaned.removedRowCount,
              } satisfies ParsedItem
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              return {
                id,
                file,
                rawRows: [],
                cleanedRows: [],
                removedRows: [],
                removedByTimeCount: 0,
                removedByCustomCount: 0,
                originalRowCount: 0,
                removedRowCount: 0,
                error: msg,
              } satisfies ParsedItem
            }
          }),
        )

        // 如果期间用户点了“清空列表”（或触发了新的解析批次），忽略本次结果
        if (mySeq === parseSeqRef.current) {
          setItems((prev) => [...prev, ...parsed])
        }
      } finally {
        parsingCountRef.current = Math.max(0, parsingCountRef.current - 1)
        setIsParsing(parsingCountRef.current > 0)
      }
    },
    [csvConfig, timeFilterEnabled, timeFilterEnd, timeFilterStart],
  )

  // 时间筛选变化时：基于 rawRows 重新计算剔除结果（不需要重新解析文件）
  const recomputeByFilters = useCallback(() => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.error) return it
        const cleaned = cleanCsvRows(it.rawRows, {
          eventTimeFilter: {
            enabled: timeFilterEnabled,
            startDate: timeFilterStart || undefined,
            endDate: timeFilterEnd || undefined,
            mode: 'includeMatch',
          },
          csvConfig: csvConfig ?? undefined,
        })
        return {
          ...it,
          cleanedRows: cleaned.rows,
          removedRows: cleaned.removedRows,
          removedByTimeCount: cleaned.removedByTimeRows.length,
          removedByCustomCount: cleaned.removedByCustomRows.length,
          originalRowCount: cleaned.originalRowCount,
          removedRowCount: cleaned.removedRowCount,
        }
      }),
    )
  }, [csvConfig, timeFilterEnabled, timeFilterEnd, timeFilterStart])

  // 配置文件加载完成后，重算一次
  useEffect(() => {
    if (csvConfig) recomputeByFilters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvConfig])

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
    },
    [addFiles],
  )

  const onPickFiles = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const fl = e.target.files
      if (fl?.length) addFiles(fl)
      // 允许重复选择同一个文件也能触发 change
      e.target.value = ''
    },
    [addFiles],
  )

  const onCopy = useCallback(
    async (id: string) => {
      const item = items.find((x) => x.id === id)
      if (!item || item.error) return

      const tsv = rowsToTsv(item.cleanedRows)
      try {
        await copyText(tsv)
        const noticeAt = Date.now()
        setItems((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  copiedAt: noticeAt,
                  noticeText: '已复制',
                  noticeKind: 'success',
                  noticeAt,
                }
              : x,
          ),
        )
        window.setTimeout(() => {
          setItems((prev) =>
            prev.map((x) =>
              x.id === id && x.noticeAt === noticeAt
                ? { ...x, noticeText: undefined, noticeKind: undefined, noticeAt: undefined }
                : x,
            ),
          )
        }, 1600)
      } catch {
        const noticeAt = Date.now()
        setItems((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  noticeText: '复制失败：请尝试使用 Chrome/Edge，或在 localhost 运行',
                  noticeKind: 'error',
                  noticeAt,
                }
              : x,
          ),
        )
        window.setTimeout(() => {
          setItems((prev) =>
            prev.map((x) =>
              x.id === id && x.noticeAt === noticeAt
                ? { ...x, noticeText: undefined, noticeKind: undefined, noticeAt: undefined }
                : x,
            ),
          )
        }, 2200)
      }
    },
    [items],
  )

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1 className="title">CSV 批量拖拽 & 一键复制 TSV</h1>
          <div className="subTitle">
            拖入多个 CSV 后，每个文件都能单独“复制TSV”粘贴到表格
          </div>
        </div>

        <div className="headerRight">
          <button
            className="btn"
            onClick={() => {
              // 让正在解析的批次结果失效（避免解析结束又把列表加回来）
              parseSeqRef.current += 1
              setItems([])
              setGlobalMsg(null)
            }}
            disabled={items.length === 0}
          >
            清空列表
          </button>
        </div>
      </header>

      <section
        className={`dropZone ${isParsing ? 'isParsing' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={onDrop}
        onClick={onPickFiles}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,text/csv"
          onChange={onInputChange}
          style={{ display: 'none' }}
        />
        <div className="dropTitle">拖拽多个 CSV 到这里，或点击选择文件</div>
        <div className="dropHint">
          {isParsing
            ? '解析中…'
            : `当前：${stats.total} 个文件（成功 ${stats.ok} / 失败 ${stats.failed}）`}
        </div>
      </section>

      <section className="filters">
        <div className="filtersRow">
          <label className="chk">
            <input
              type="checkbox"
              checked={timeFilterEnabled}
              onChange={(e) => {
                setTimeFilterEnabled(e.target.checked)
                window.setTimeout(recomputeByFilters, 0)
              }}
            />
            <span>启用事件时间筛选</span>
          </label>

          <label className="field">
            <span className="fieldLabel">开始</span>
            <input
              className="input"
              type="date"
              value={timeFilterStart}
              onChange={(e) => {
                setTimeFilterStart(e.target.value)
                window.setTimeout(recomputeByFilters, 0)
              }}
              disabled={!timeFilterEnabled}
            />
          </label>

          <label className="field">
            <span className="fieldLabel">结束</span>
            <input
              className="input"
              type="date"
              value={timeFilterEnd}
              onChange={(e) => {
                setTimeFilterEnd(e.target.value)
                window.setTimeout(recomputeByFilters, 0)
              }}
              disabled={!timeFilterEnabled}
            />
          </label>
        </div>

        <div className="filtersHint">
          按列名“事件时间”筛选；如果某行事件时间无法解析，则默认不命中筛选。
        </div>
      </section>

      {globalMsg ? <div className="toast">{globalMsg}</div> : null}

      <section className="list">
        {items.map((item) => {
          const rowCount = item.cleanedRows.length
          const colCount = item.cleanedRows.reduce(
            (m, r) => Math.max(m, r.length),
            0,
          )
          const copiedRecently = item.copiedAt
            ? Date.now() - item.copiedAt < 1200
            : false

          return (
            <div className="card" key={item.id}>
              {item.noticeText ? (
                <div className={`cardToast ${item.noticeKind ?? ''}`}>
                  {item.noticeText}
                </div>
              ) : null}

              <div className="cardTop">
                <div className="cardTopRow">
                  <div className="cardTitle">{item.file.name}</div>

                  {!item.error ? (
                    <button
                      className="btn primary"
                      onClick={() => onCopy(item.id)}
                    >
                      {copiedRecently ? '已复制' : '复制TSV'}
                    </button>
                  ) : null}
                </div>

                <div className="cardMeta">
                  {formatBytes(item.file.size)} · 原始 {item.originalRowCount} 行 ·
                  删除 {item.removedRowCount} 行 · 保留 {rowCount} 行 · {colCount}{' '}
                  列
                  {timeFilterEnabled && item.removedByTimeCount > 0
                    ? ` · 时间筛选删除 ${item.removedByTimeCount} 行`
                    : ''}
                  {item.removedByCustomCount > 0
                    ? ` · 自定义剔除 ${item.removedByCustomCount} 行`
                    : ''}
                </div>
              </div>

              {item.error ? (
                <div className="error">解析失败：{item.error}</div>
              ) : null}

              {!item.error && rowCount > 0 ? (
                <>
                  <div className="sectionTitle">剔除后内容</div>
                  {item.cleanedRows.length > 0 ? (
                    <div className="tableHeader">
                      {rowsToTsv([item.cleanedRows[0]])}
                    </div>
                  ) : null}
                  <pre className="preview">
                    {rowsToTsv(item.cleanedRows.slice(1))}
                  </pre>

                  {item.removedRows.length > 0 ? (
                    <>
                      <div className="sectionTitle danger">
                        被删除内容（{item.removedRows.length} 行）
                      </div>
                      {item.cleanedRows.length > 0 ? (
                        <div className="tableHeader">
                          {rowsToTsv([item.cleanedRows[0]])}
                        </div>
                      ) : null}
                      <pre className="preview removedPreview">
                        {rowsToTsv(item.removedRows)}
                      </pre>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          )
        })}
      </section>
    </div>
  )
}
