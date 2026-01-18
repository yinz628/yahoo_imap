# 实现计划: 邮件连接稳定性改进

## 概述

本实现计划将在现有连接机制基础上，通过统一的机制和提供商特定的配置参数，显著提升所有邮件提供商（Yahoo、Gmail 等）的连接稳定性。实现采用增量式方案，分三个阶段进行。

## 任务

### 阶段 1: 基础增强（高优先级）

- [x] 1. 实现提供商特定的超时配置
  - 在 `src/connector.ts` 中扩展 `ConnectionOptions` 接口，添加 `retryDelayMax` 和 `operationTimeout` 字段
  - 创建 `ProviderConnectionOptions` 接口定义提供商配置结构
  - 实现 `PROVIDER_CONNECTION_OPTIONS` 常量，包含 Yahoo、Gmail 和默认配置
  - 修改 `IMAPConnector` 构造函数，接受 `provider` 参数并使用对应配置
  - 更新 `src/types.ts` 中的类型定义（如需要）
  - _需求: 1.1, 1.2, 1.4, 1.5, 1.6_

- [x] 1.1 编写提供商配置的属性测试
  - **属性 1: Gmail 超时大于 Yahoo 超时**
  - **验证: 需求 1.1**

- [x] 2. 实现指数退避重试策略
  - 在 `IMAPConnector` 类中添加 `calculateRetryDelay(attempt: number)` 私有方法
  - 实现指数退避算法：`min(baseDelay * 2^(attempt-1), maxDelay)`
  - 修改 `connect()` 方法中的重试逻辑，使用 `calculateRetryDelay()` 计算延迟
  - 确保延迟不超过 `retryDelayMax` 配置值
  - _需求: 2.1, 2.5, 2.7_

- [x] 2.1 编写指数退避的属性测试
  - **属性 2: 重试延迟指数增长**
  - **验证: 需求 2.1**

- [x] 3. 实现错误分类系统
  - [x] 3.1 创建错误分类器
    - 创建新文件 `src/error-classifier.ts`
    - 定义 `ErrorType` 枚举（AUTHENTICATION, NETWORK, TIMEOUT, RATE_LIMIT, SERVER_ERROR, UNKNOWN）
    - 定义 `RecoveryStrategy` 接口
    - 实现 `ErrorClassifier` 类及其方法：
      - `classify(error: Error): ErrorType` - 根据错误消息分类
      - `getRecoveryStrategy(errorType: ErrorType, attempt: number): RecoveryStrategy` - 获取恢复策略
      - 私有方法：`isAuthError()`, `isRateLimitError()`, `isTimeoutError()`, `isNetworkError()`, `isServerError()`
    - _需求: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 3.2 编写错误分类的单元测试
    - 测试各种错误消息的正确分类
    - 测试每种错误类型的恢复策略
    - _需求: 10.1-10.8_

  - [x] 3.3 编写错误分类的属性测试
    - **属性 3: 认证错误不重试**
    - **属性 5: 错误分类完整性**
    - **属性 6: 速率限制延迟**
    - **验证: 需求 2.4, 10.1-10.8, 2.5, 7.2**

- [x] 4. 集成错误分类到连接流程
  - 在 `IMAPConnector` 类中添加 `errorClassifier` 私有属性
  - 在构造函数中初始化 `ErrorClassifier` 实例
  - 修改 `connect()` 方法，使用错误分类器处理连接失败：
    - 捕获错误后调用 `classify()` 分类错误
    - 调用 `getRecoveryStrategy()` 获取恢复策略
    - 根据策略决定是否重试、延迟时间和最大尝试次数
    - 提供用户友好的错误消息
  - _需求: 2.1, 2.4, 2.5, 2.6, 10.7, 10.8_

- [x] 5. 更新服务器端连接调用
  - 修改 `src/server.ts` 中的 `/api/connect` 端点
  - 从邮箱地址检测提供商类型（Gmail、Yahoo 或其他）
  - 创建 `IMAPConnector` 时传递正确的 `provider` 参数
  - 确保会话中保存 `provider` 信息供后续使用
  - _需求: 1.1, 7.1_

- [x] 6. 更新前端超时配置
  - 修改 `public/index.html` 中的 `connect()` 函数
  - 根据邮箱地址检测提供商类型
  - 为不同提供商设置不同的前端超时时间：
    - Gmail: 90秒
    - Yahoo: 45秒
    - 其他: 60秒
  - _需求: 1.1, 6.1, 6.3_

- [x] 7. 检查点 - 阶段 1 完成
  - 确保所有测试通过
  - 验证 Gmail 和 Yahoo 连接使用正确的配置
  - 验证错误分类和恢复策略正常工作
  - 如有问题，询问用户

### 阶段 2: 连接管理增强（中优先级）

- [x] 8. 实现 Keep-Alive 保活机制
  - [x] 8.1 添加 Keep-Alive 基础设施
    - 在 `IMAPConnector` 类中添加私有属性：
      - `keepAliveTimer?: NodeJS.Timeout`
      - `keepAliveInterval: number`
    - 在构造函数中根据提供商设置 `keepAliveInterval`（从 `idleTimeout` 配置读取）
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.8_

  - [x] 8.2 实现 Keep-Alive 方法
    - 实现 `startKeepAlive()` 方法：
      - 清除现有定时器
      - 创建定时器定期发送 NOOP 命令
      - 更新 `lastActivity` 时间戳
      - 处理 Keep-Alive 失败（标记连接不健康）
    - 实现 `stopKeepAlive()` 方法清除定时器
    - 修改 `disconnect()` 方法，在断开前停止 Keep-Alive
    - _需求: 4.1, 4.2, 4.5, 4.7_

  - [x] 8.3 集成 Keep-Alive 到连接流程
    - 修改 `connect()` 方法，连接成功后调用 `startKeepAlive()`
    - 确保重连时正确重启 Keep-Alive
    - _需求: 4.1, 4.6_

  - [x] 8.4 编写 Keep-Alive 的属性测试
    - **属性 4: Keep-Alive 定期执行**
    - **属性 8: 连接成功后启动 Keep-Alive**
    - **验证: 需求 4.4**

- [x] 9. 实现提取过程指数退避重连
  - 修改 `src/server.ts` 中的 `/api/extract` 端点
  - 创建 `reconnect(attempt: number)` 辅助函数：
    - 使用指数退避计算延迟：`min(baseDelay * 2^(attempt-1), maxDelay)`
    - 先尝试干净断开连接
    - 等待计算的延迟时间
    - 尝试重新连接
    - 返回连接是否成功
  - 在批量处理循环中使用新的 `reconnect()` 函数
  - 确保重连次数不超过 `maxReconnectAttempts`
  - _需求: 2.1, 2.7_

- [x] 9.1 编写批量重连的属性测试
  - **属性 7: 批量重连指数退避**
  - **验证: 需求 2.1**

- [x] 10. 实现渐进式连接反馈
  - [x] 10.1 添加渐进式反馈定时器
    - 修改 `public/index.html` 中的 `connect()` 函数
    - 检测提供商类型（Gmail、Yahoo 或其他）
    - 添加 10秒反馈定时器：显示"连接较慢，请稍候..."
    - 添加 30秒反馈定时器：根据提供商显示特定消息
    - 确保连接完成或失败时清除所有定时器
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.7_

  - [x] 10.2 显示连接耗时
    - 记录连接开始时间
    - 连接成功后计算并显示耗时
    - 格式：`✅ 连接成功！(耗时 X.X 秒)`
    - _需求: 6.5_

  - [x] 10.3 改进超时错误消息
    - 根据提供商类型显示不同的超时消息
    - 提供具体的故障排查建议
    - _需求: 6.6, 6.7_

- [x] 11. 检查点 - 阶段 2 完成
  - 确保所有测试通过
  - 验证 Keep-Alive 机制正常工作
  - 验证提取过程重连使用指数退避
  - 验证前端渐进式反馈正常显示
  - 如有问题，询问用户

### 阶段 3: 文档和验证（必需）

- [x] 12. 更新类型定义和文档
  - 更新 `src/types.ts` 中的接口文档
  - 为新增的配置选项添加 JSDoc 注释
  - 确保所有公共 API 都有清晰的文档
  - _需求: 所有_

- [x] 13. 集成测试
  - [x] 13.1 测试 Gmail 完整连接流程
    - 测试连接、Keep-Alive、提取、断开的完整流程
    - 验证超时配置和重试策略
    - _需求: 1.1, 2.2, 4.3_

  - [x] 13.2 测试 Yahoo 完整连接流程
    - 测试连接、Keep-Alive、提取、断开的完整流程
    - 验证超时配置和重试策略
    - _需求: 1.2, 2.3, 4.4_

  - [x] 13.3 测试错误恢复场景
    - 模拟各种错误类型
    - 验证错误分类和恢复策略
    - 验证重试和重连行为
    - _需求: 10.1-10.8_

- [x] 14. 最终检查点
  - 运行完整测试套件
  - 验证所有需求都已实现
  - 检查向后兼容性
  - 验证性能影响在可接受范围内
  - 如有问题，询问用户

## 注意事项

- 所有测试任务都是必需的，确保代码质量和正确性
- 每个任务都引用了相关的需求编号，便于追溯
- 实现过程中保持向后兼容，不破坏现有功能
- 优先实现阶段 1 和阶段 2，阶段 3 的高级特性（连接池、断路器、诊断工具）可根据实际需求决定是否实施
