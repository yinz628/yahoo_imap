# 技术栈

## 运行时与语言

- Node.js + TypeScript（ES2022 目标）
- ES Modules（`"type": "module"`）
- 严格模式 TypeScript 配置

## 核心依赖

- `express` (v5) - REST API 服务器
- `imapflow` - IMAP 客户端，用于邮件获取
- `mailparser` - 邮件解析
- `bcrypt` - 密码哈希（用户认证）
- `better-sqlite3` - SQLite 导出
- `exceljs` - Excel 导出
- `commander` - CLI 命令行接口
- `uuid` - ID 生成
- `cors` - CORS 中间件

## 开发依赖

- `vitest` - 测试框架
- `fast-check` - 属性测试
- `supertest` - HTTP 测试

## 构建与命令

```bash
# 编译 TypeScript 到 dist/
npm run build

# 运行测试（单次执行，非 watch 模式）
npm test

# 运行测试（watch 模式）
npm run test:watch

# 启动 CLI
npm start

# 启动 Web 服务器
npm run web

# 启动 Web 服务器（带文件日志）
npm run web:log
```

## TypeScript 配置

- 输出目录：`dist/`
- 源码目录：`src/`
- 模块系统：NodeNext (ESM)
- 严格模式启用
- 生成 source maps 和类型声明文件

## 环境变量

- `PORT` - 服务器端口（默认：8001）
- `NODE_ENV` - 运行环境

## Docker 支持

- 提供 Dockerfile 和 docker-compose.yml
- 健康检查端点：`/health`
