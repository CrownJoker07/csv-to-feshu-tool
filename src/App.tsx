import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import './App.css'
import { cleanCsvRows, parseCsvFile, rowsToTsv } from './utils/csv'

type ParsedItem = {
  id: string
  file: File
  rawRows: string[][]
  cleanedRows: string[][]
  originalRowCount: number
  removedRowCount: number
  error?: string
  copiedAt?: number
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
              const cleaned = cleanCsvRows(rawRows)
              return {
                id,
                file,
                rawRows,
                cleanedRows: cleaned.rows,
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
    [],
  )

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
        setItems((prev) =>
          prev.map((x) => (x.id === id ? { ...x, copiedAt: Date.now() } : x)),
        )
        setGlobalMsg(`已复制：${item.file.name}`)
        window.setTimeout(() => setGlobalMsg(null), 1200)
      } catch {
        setGlobalMsg('复制失败：请尝试使用 Chrome/Edge，或在 localhost 运行')
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
                </div>
              </div>

              {item.error ? (
                <div className="error">解析失败：{item.error}</div>
              ) : null}

              {!item.error && rowCount > 0 ? (
                <pre className="preview">
                  {rowsToTsv(item.cleanedRows.slice(0, 8))}
                  {rowCount > 8 ? '\n…（仅预览前 8 行）' : ''}
                </pre>
              ) : null}
            </div>
          )
        })}
      </section>
    </div>
  )
}
