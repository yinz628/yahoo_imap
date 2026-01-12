# 项目结构

```
├── src/                    # TypeScript 源码
│   ├── index.ts           # 库入口（重新导出）
│   ├── types.ts           # 核心类型定义
│   ├── server.ts          # Express REST API 服务器
│   ├── cli.ts             # Commander CLI 命令行接口
│   ├── auth.ts            # 用户认证与会话管理
│   ├── storage.ts         # 文件存储（数据持久化）
│   ├── connector.ts       # IMAP 连接管理
│   ├── fetcher.ts         # 邮件获取逻辑
│   ├── parser.ts          # 邮件解析（mailparser）
│   ├── extractor.ts       # 正则提取引擎
│   ├── config.ts          # 配置管理
│   ├── errors.ts          # 自定义错误类型
│   ├── patterns.ts        # 内置提取规则
│   ├── regex-generator.ts # 正则生成辅助
│   ├── rule-validator.ts  # 提取规则验证
│   └── exporters/         # 导出格式处理器
│       ├── index.ts       # 导出器重新导出
│       ├── csv.ts         # CSV 导出
│       ├── excel.ts       # Excel 导出
│       └── sqlite.ts      # SQLite 导出
├── public/                # 静态 Web UI 文件
│   └── index.html         # 单页前端
├── data/                  # 运行时数据（内容被 gitignore）
│   ├── users.json         # 用户账户
│   └── users/             # 按用户隔离的数据目录
│       └── {userId}/
│           ├── mailboxes.json  # 保存的邮箱凭据
│           └── patterns.json   # 保存的提取规则
├── dist/                  # 编译后的 JavaScript 输出
└── logs/                  # 服务器日志（使用 --log 参数时）
```

## 架构模式

- **模块化设计**：每个关注点独立文件（auth、storage、connector 等）
- **基于类的服务**：`IMAPConnector`、`EmailFetcher`、`EmailParser`、`RegexExtractor`、导出器
- **文件存储**：JSON 文件存储在 `data/` 目录，按用户隔离
- **REST API**：Express 路由在 `server.ts`，带认证中间件
- **错误处理**：自定义错误类（`AuthError`、`StorageError`、`ValidationError`、`ConnectionError`）

## 测试

- 测试文件与源码同目录：`*.test.ts`
- 属性测试：`*.property.test.ts`
- 测试顺序执行（禁用文件并行）以避免数据文件冲突

## 文件命名

- 源文件：kebab-case（如 `email-search.ts`）
- 测试文件：`{name}.test.ts` 或 `{name}.property.test.ts`
- 导入时使用 `.js` 扩展名（ESM 要求）
