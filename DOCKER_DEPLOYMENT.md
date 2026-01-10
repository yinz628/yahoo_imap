# Docker 部署指南 (Debian)

## 快速部署

### 方式一：使用部署脚本（推荐）

```bash
# 1. 将项目文件传输到 Debian 服务器
scp -r ./* user@your-server:/path/to/app/

# 2. SSH 登录服务器
ssh user@your-server

# 3. 进入项目目录
cd /path/to/app

# 4. 运行部署脚本
chmod +x deploy.sh
./deploy.sh
```

### 方式二：手动部署

```bash
# 1. 安装 Docker（如果未安装）
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin

# 2. 启动 Docker 服务
sudo systemctl start docker
sudo systemctl enable docker

# 3. 创建必要目录
mkdir -p data logs

# 4. 复制环境配置
cp .env.example .env

# 5. 构建并启动
docker compose up -d --build
```

## 访问服务

- 地址: `http://your-server-ip:8001`
- 默认账号: `admin`
- 默认密码: `nature123`

## 常用命令

```bash
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 重新构建并启动
docker compose up -d --build

# 进入容器
docker compose exec yahoo-mail-extractor sh
```

## 数据持久化

以下目录会被持久化到宿主机：

- `./data/` - 用户数据（邮箱配置、提取规则等）
- `./logs/` - 服务器日志

## 端口配置

默认端口为 3000，可通过 `.env` 文件修改：

```bash
# .env
PORT=8080
```

## 防火墙配置

```bash
# 开放端口
sudo ufw allow 8001/tcp

# 或使用 iptables
sudo iptables -A INPUT -p tcp --dport 8001 -j ACCEPT
```

## 使用 Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker compose logs

# 检查端口占用
sudo netstat -tlnp | grep 8001
```

### 健康检查失败

```bash
# 手动测试健康接口
curl http://localhost:8001/health
```

### 权限问题

```bash
# 确保 data 和 logs 目录有正确权限
sudo chown -R 1000:1000 data logs
```
❌ 清空失败: Unexpected token '<', "<html> <h"... is not valid JSON