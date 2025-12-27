# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

---

## CSV to 飞书表格（TSV）工具说明（本项目）

### 打包与运行（Windows 友好）
本项目读取 `public/csvConfig.json` 使用的是 `fetch('/csvConfig.json')`，因此**不能通过双击 `dist/index.html`（file://）直接运行**，需要用静态服务器启动。

#### 1) 生成打包产物（dist）
- pnpm：`pnpm build`
- npm：`npm run build`

打包后输出在 `dist/`。

#### 2) 运行打包后的 dist（推荐）
使用 Vite 自带的预览服务器（不会触发剪贴板复制）：
- pnpm：`pnpm preview`
- npm：`npm run preview`

#### 3) 如果你用 `npx serve dist`，需要关闭“复制到剪贴板”
在部分环境里（例如远程桌面、剪贴板被占用等），`serve` 会尝试复制地址到剪贴板，可能导致 `clipboardy` 报错退出。

可用下面命令避免该问题：
- `npx --yes serve dist -l 4173 --no-clipboard`

### 使用方式
- 拖拽多个 `.csv` 到页面（或点击选择）。
- 工具会自动清洗（剔除不需要的行），并为每个文件提供“复制TSV”按钮。
- 页面上支持“事件时间”筛选（启用后：**仅保留筛选范围内**，范围外进入“被删除内容”）。

### 自定义剔除规则（无 UI，使用 csvConfig.json）
你不需要在页面里配规则，直接修改 [`public/csvConfig.json`](public/csvConfig.json) 然后刷新页面即可生效。

#### 1) 配置文件位置
- 配置文件：`public/csvConfig.json`
- 修改后：刷新浏览器即可

#### 2) `removeRules` 规则字段（最常用）
`removeRules` 是一个数组；**任意规则命中，该行就会进入“被删除内容”**。

- `name`：规则名（必填）
- `enabled`：是否启用（可选，默认 true）
- `column`：列定位（必填）
  - 列名（string，必须与 CSV 表头一致）
  - 数字（number，第 N 列，从 1 开始）
  - `"*"`（任意列：整行任意单元格命中则剔除）
- `matchType`：匹配类型（必填）
  - `"regex"`：正则匹配（JS RegExp 语法）
  - `"keywords"`：关键词匹配
- 当 `matchType="regex"`：
  - `pattern`：正则表达式字符串（必填）
  - `flags`：正则 flags（可选，例如 `"i"`）
- 当 `matchType="keywords"`：
  - `keywords`：关键词数组（必填）
  - `contains`：关键词匹配方式（可选，默认 true）
    - `true`：包含匹配（`cell.includes(keyword)`）
    - `false`：整格匹配（`cell === keyword`）
  - `caseInsensitive`：忽略大小写（可选，默认 false）

#### 3) 内置清洗规则开关（可选）
- `removeEmptyRows`：是否删除空行（默认 true）
- `removeDuplicateHeaderRows`：是否删除重复表头（默认 true）
- `removeFooterKeywordRows`：是否删除表尾说明/合计行（默认 true）
- `footerKeywords`：表尾关键词列表（默认：合计/总计/汇总/说明/注释/数据来源/更新时间）

#### 4) 示例：删掉某列为 0 的行

```json
{
  "name": "剔除总次数为0的行",
  "enabled": true,
  "column": "payment_success.总次数",
  "matchType": "regex",
  "pattern": "^0$",
  "flags": ""
}
```

#### 5) 示例：删掉任意列包含“debug”的行

```json
{
  "name": "剔除debug行",
  "enabled": true,
  "column": "*",
  "matchType": "keywords",
  "keywords": ["debug"],
  "contains": true,
  "caseInsensitive": true
}
```
