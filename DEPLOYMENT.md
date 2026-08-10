# NodeStatus VPS 部署方案

本文档用于部署当前项目组合：

- 后端：`nodestatus`
- 客户端节点：`client-go`
- 前端展示：`nezha-dash`

推荐结构是：后端和前端保持独立仓库，VPS 上用一个部署目录统一编排。不要把 `nodestatus`、`nezha-dash`、客户端节点代码强行合并到一个仓库。

## 1. 架构

示例域名：

- `status.example.com`：访问 `nezha-dash` 前端
- `node.example.com`：访问 `nodestatus` 后端、管理后台、client-go WebSocket 入口

服务关系：

```text
client-go  --->  https://node.example.com/connect
nezha-dash --->  http://nodestatus:35601/api/status
browser    --->  https://status.example.com
admin      --->  https://node.example.com/admin
```

注意：`client-go -server https://node.example.com` 会自动连接 `wss://node.example.com/connect`，所以 Nginx 必须把 `node.example.com` 的根路径完整反代到 `nodestatus`，不能只挂到 `/nodestatus` 这类路径前缀下。

## 2. VPS 初始化

以 Debian/Ubuntu 为例：

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

sudo mkdir -p /opt/monitor
sudo chown -R $USER:$USER /opt/monitor
cd /opt/monitor
```

## 3. 拉取代码

NodeStatus 使用当前仓库：

```bash
git clone https://github.com/Sheldonsix/nodestatus.git
```

`nezha-dash` 必须使用包含 NodeStatus 适配的分支。当前本地分支是 `feature/adapt-nodestatus`，建议先推到你自己的 fork，再在 VPS 拉取：

```bash
git clone -b feature/adapt-nodestatus https://github.com/Sheldonsix/nezha-dash.git
```

如果你的 fork 地址不同，替换上面的 URL。

## 4. Docker 镜像选择

有两种部署方式。

### 方式 A：VPS 本地构建

适合首次部署或不想维护镜像仓库：

```yaml
build:
  context: ./nodestatus
image: sheldonsix/nodestatus:local
```

这里的 `image: sheldonsix/nodestatus:local` 只是给本机构建出来的镜像起名，不会从 Docker Hub 拉取。

### 方式 B：发布自己的镜像

适合生产环境。先把镜像推到 Docker Hub：

```bash
cd /opt/monitor/nodestatus
docker login
docker build -t sheldonsix/nodestatus:latest .
docker push sheldonsix/nodestatus:latest
```

之后 `docker-compose.yml` 可以写成：

```yaml
image: sheldonsix/nodestatus:latest
```

不能直接使用：

```yaml
image: cokemine/nodestatus
```

原因是它是上游镜像，不包含当前仓库新增的 `client-go`、历史数据接口、带宽图表等改动。

## 5. Docker Compose

在 `/opt/monitor/docker-compose.yml` 写入：

```yaml
services:
  nodestatus:
    build:
      context: ./nodestatus
      args:
        USE_CHINA_MIRROR: 0
    image: sheldonsix/nodestatus:local
    container_name: nodestatus
    restart: unless-stopped
    environment:
      PORT: 35601
      DATABASE: file:/data/db.sqlite
      VERBOSE: "false"
      PING_INTERVAL: 30
      RECONNECT_TIMEOUT: 120
      TZ: Asia/Shanghai

      USE_PUSH: "false"
      USE_IPC: "true"
      USE_WEB: "true"
      USE_EVENT: "true"

      WEB_THEME: hotaru-theme
      WEB_TITLE: Server Status
      WEB_SUBTITLE: "Servers' Probes Set up with NodeStatus"
      WEB_HEADTITLE: NodeStatus
      WEB_USERNAME: admin
      WEB_PASSWORD: "${NODESTATUS_WEB_PASSWORD}"
      WEB_SECRET: "${NODESTATUS_WEB_SECRET}"

      PUSH_DELAY: 15
      TGBOT_TOKEN: ""
      TGBOT_CHATID: ""
      TGBOT_PROXY: ""
      TGBOT_WEBHOOK: ""
    volumes:
      - ./data/nodestatus:/data
      - /tmp:/tmp:rw
    ports:
      - "127.0.0.1:35601:35601"

  nezha-dash:
    build:
      context: ./nezha-dash
    image: sheldonsix/nezha-dash:local
    container_name: nezha-dash
    restart: unless-stopped
    depends_on:
      - nodestatus
    environment:
      DefaultLocale: zh
      NEXT_PUBLIC_NodeStatus: "true"
      NodeStatusBaseUrl: http://nodestatus:35601
      NEXT_PUBLIC_NezhaFetchInterval: 5000
      NEXT_PUBLIC_ShowFlag: "true"
      NEXT_PUBLIC_ShowTag: "true"
      NEXT_PUBLIC_ShowNetTransfer: "true"
      NEXT_PUBLIC_ShowIpInfo: "false"
      NEXT_PUBLIC_CustomTitle: "Server Status"
      NEXT_PUBLIC_CustomDescription: "NodeStatus Dashboard"
    ports:
      - "127.0.0.1:3040:3000"
```

如果你已经按“方式 B”发布了自己的镜像，可以把 `nodestatus` 服务里的 `build` 删除，并改成：

```yaml
image: sheldonsix/nodestatus:latest
```

## 6. 环境变量

在 `/opt/monitor/.env` 写入：

```env
NODESTATUS_WEB_PASSWORD=换成强密码
NODESTATUS_WEB_SECRET=换成随机字符串
```

生成随机 secret：

```bash
openssl rand -hex 32
```

## 7. 启动服务

```bash
cd /opt/monitor
docker compose build
docker compose up -d
docker compose ps
```

检查后端：

```bash
curl http://127.0.0.1:35601/api/status
```

检查前端：

```bash
curl http://127.0.0.1:3040/api/health
```

## 8. Nginx 反向代理

创建 `/etc/nginx/sites-available/monitor.conf`：

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 80;
  server_name status.example.com;

  location / {
    proxy_pass http://127.0.0.1:3040;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

server {
  listen 80;
  server_name node.example.com;

  location / {
    proxy_pass http://127.0.0.1:35601;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/monitor.conf /etc/nginx/sites-enabled/monitor.conf
sudo nginx -t
sudo systemctl reload nginx
```

申请 HTTPS 证书：

```bash
sudo certbot --nginx -d status.example.com -d node.example.com
```

验证：

```bash
curl https://node.example.com/api/status
curl https://status.example.com/api/health
```

## 9. 添加节点

访问：

```text
https://node.example.com/admin
```

登录信息：

- 用户名：`admin`
- 密码：`.env` 中的 `NODESTATUS_WEB_PASSWORD`

在管理后台添加节点，例如：

- `username`: `vps-1`
- `password`: 给这个节点单独设置一个强密码
- `name`: `VPS 1`
- `region`: 节点地区
- `type`: 节点类型，可选填

## 10. 部署 client-go

GitHub Release 会自动发布 `client-go` 的 Linux/OpenWrt 多架构二进制。推荐直接使用一键安装脚本，它会自动识别架构并配置自启动：

```bash
wget -O /tmp/nodestatus-client-install.sh https://raw.githubusercontent.com/Sheldonsix/nodestatus/master/scripts/install-client-go.sh
sh /tmp/nodestatus-client-install.sh --dsn 'wss://vps-1:节点密码@node.example.com'
```

也可以使用拆分参数：

```bash
sh /tmp/nodestatus-client-install.sh \
  --server https://node.example.com \
  --username vps-1 \
  --password '节点密码' \
  --custom vps-1
```

指定版本或架构：

```bash
sh /tmp/nodestatus-client-install.sh --version v1.2.3 --target linux-amd64 --dsn 'wss://vps-1:节点密码@node.example.com'
```

常用 target：

```text
linux-amd64
linux-386
linux-arm64
linux-armv7
linux-armv6
linux-armv5
openwrt-mips
openwrt-mipsle
openwrt-mips64
openwrt-mips64le
```

需要本机编译时再使用 Go 1.26+：

```bash
git clone https://github.com/Sheldonsix/nodestatus.git /opt/nodestatus
cd /opt/nodestatus/client-go
go build -ldflags="-s -w -X main.version=$(git rev-parse --short HEAD)" -o nodestatus-client .
sudo install -m 0755 nodestatus-client /usr/local/bin/nodestatus-client
```

## 11. client-go 服务管理

Linux/systemd：

```bash
sudo systemctl status nodestatus-client-go
sudo systemctl restart nodestatus-client-go
journalctl -u nodestatus-client-go -f
```

OpenWrt/procd：

```bash
/etc/init.d/nodestatus-client-go status
/etc/init.d/nodestatus-client-go restart
logread -f
```

配置文件：

```text
/etc/nodestatus-client-go/client.env
```

## 12. 升级

本地构建模式：

```bash
cd /opt/monitor/nodestatus
git pull

cd /opt/monitor/nezha-dash
git pull

cd /opt/monitor
docker compose build
docker compose up -d
```

镜像发布模式：

```bash
cd /opt/monitor
docker compose pull
docker compose up -d
```

更新 client-go：

```bash
wget -O /tmp/nodestatus-client-install.sh https://raw.githubusercontent.com/Sheldonsix/nodestatus/master/scripts/install-client-go.sh
sh /tmp/nodestatus-client-install.sh --dsn 'wss://vps-1:节点密码@node.example.com'
```

## 13. 备份和恢复

默认 SQLite 数据库位置：

```text
/opt/monitor/data/nodestatus/db.sqlite
```

备份：

```bash
mkdir -p /opt/monitor/backup
cp /opt/monitor/data/nodestatus/db.sqlite /opt/monitor/backup/db.sqlite.$(date +%F-%H%M%S)
```

恢复：

```bash
cd /opt/monitor
docker compose stop nodestatus
cp /opt/monitor/backup/db.sqlite.YYYY-MM-DD-HHMMSS /opt/monitor/data/nodestatus/db.sqlite
docker compose up -d nodestatus
```

## 14. 常见问题

### client-go 连不上

检查后端域名：

```bash
curl https://node.example.com/api/status
```

检查 Nginx 是否支持 WebSocket upgrade。`node.example.com` 的反代必须包含：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

### 管理后台打不开

检查：

```bash
docker logs nodestatus --tail=100
```

如果日志提示 `No web password specified`，说明 `.env` 中缺少：

```env
NODESTATUS_WEB_PASSWORD=...
```

### nezha-dash 没有数据

进入容器网络检查：

```bash
docker exec -it nezha-dash sh
wget -qO- http://nodestatus:35601/api/status
```

确认 `docker-compose.yml` 中：

```yaml
NEXT_PUBLIC_NodeStatus: "true"
NodeStatusBaseUrl: http://nodestatus:35601
```

### 不要用上游镜像

不要部署：

```yaml
image: cokemine/nodestatus
```

它不包含当前项目的自定义改动。需要直接构建当前仓库，或发布自己的镜像后使用：

```yaml
image: sheldonsix/nodestatus:latest
```
