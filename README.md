# 教学工作台

个人专属教学工作台网站：课表（含单双周/分段周次）、日历（带教学周数）、教学计划、科研成果集中管理。纯静态、零依赖、零构建，**改数据文件即改内容，推送即自动部署**。

## 一、项目结构

```
├── index.html                  # 站点入口（唯一 HTML）
├── assets/
│   ├── css/style.css           # 样式（浅/暗主题变量）
│   └── js/app.js               # 全部前端逻辑（原生 ES Module）
├── data/                       # ← 你日常只需要编辑这个目录
│   ├── index.json              # 站点信息 + 学期列表 + 当前学期
│   ├── about.json              # 个人简介（关于页）
│   ├── publications.json       # 科研成果
│   └── semesters/
│       ├── 2026-2027-1/        # ← 学期编码 = 学年-学期（校历式）
│       │   ├── semester.json   #   校历：第1周日期、总周数、节假日、事件
│       │   ├── courses.json    #   课表
│       │   └── teachingPlans.json  # 教学计划
│       └── 2025-2026-2/
├── vercel.json                 # Vercel 配置（数据文件不缓存）
└── deploy/
    ├── nginx.conf              # 自托管 nginx 配置
    ├── webhook.py              # GitHub Webhook 自动拉取（零依赖）
    └── webhook.service         # systemd 常驻服务
```

## 二、本地预览

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 双击 index.html 无法加载数据（file:// 下浏览器拦截 fetch），必须走 http 访问。

## 三、日常数据更新（核心）

所有更新都是：**改 JSON → git push → 自动部署**，不需要碰任何代码。

### 1. 科研成果（data/publications.json）

新增一条：在 `items` 数组里加一个对象即可，前端自动按类型分组、按年份倒序。

```json
{ "type": "论文", "title": "论文题目", "year": 2026,
  "level": "省级期刊", "role": "第一作者", "note": "", "url": "" }
```

| 字段 | 说明 |
|------|------|
| `type` | 必填，从 `types` 数组里取：论文 / 教材 / 课题 / 获奖 |
| `title` | 必填，成果名称 |
| `year` | 必填，年份（用于分组排序） |
| `level` | 选填，级别（国家级 / 省级 / 校级 / 期刊名） |
| `role` | 选填，角色（主持 / 副主编 / 指导教师…） |
| `status` | 选填，在研课题写 `"在研"`，会显示高亮标签 |
| `publisher` | 选填，出版社 |
| `note` / `url` | 选填，备注 / 外链 |

新增分类（如"专利"）：往 `types` 数组加 `"专利"` 即可，页面自动多出该筛选标签。

### 2. 课表（data/semesters/<学期>/courses.json）

- `day`：1=周一 … 7=周日；`periods`：节次数组（1-10 节）。
- `weeks` 三种写法，覆盖单双周与分段周次：

```json
{ "type": "range",  "from": 1,  "to": 16 }                          // 1-16周
{ "type": "parity", "from": 2,  "to": 16, "parity": "even" }        // 2-16周双周
{ "type": "list",   "list": [1, 3, 5, 7] }                          // 指定周
```

同一门课多个教学班（如 6C01/6H34）就写多个 course 对象，`colorKey` 相同则颜色一致（可选 indigo/teal/orange/rose/cyan/violet）。

### 3. 新学期（每学期 5 分钟完成）

1. 复制现有学期目录改名，如 `data/semesters/2026-2027-2/`；
2. 改 `semester.json`：**`week1Start` 填校历第 1 周的周一日期**，`totalWeeks`、`semesterEnd`、节假日照校历更新；
3. 改 `courses.json` 为新课表；
4. 改 `data/index.json`：`semesters` 数组加新学期，`currentSemester` 改为新学期 id。

### 4. 教学计划（teachingPlans.json）

章节 `status` 三种值：`done`（已完成）/ `doing`（进行中）/ `todo`（未开始），改状态即可推进进度条。

### 5. 节假日与临时停课（semester.json）

`holidays` 加 `{ "date": "2026-10-01", "name": "国庆节" }`，当天自动不排课并在日历标红；`events` 可标运动会等活动区间。

## 四、部署

### 方式 A：GitHub + Vercel（推荐，零服务器）

1. 推送到 GitHub 仓库；
2. Vercel → Add New Project → 导入仓库 → 直接 Deploy（识别为静态站，无需配置构建）；
3. 之后每次 `git push` 自动更新线上。

### 方式 B：自托管（nginx + Webhook 自动拉取）

1. 服务器克隆仓库到 `/var/www/teaching-workbench`；
2. 修改 `deploy/webhook.py` 中的 `SECRET` 与 `REPO_DIR`，启动：
   ```bash
   sudo cp deploy/webhook.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now webhook
   ```
3. 参考 `deploy/nginx.conf` 配置站点（含 `/hooks/deploy` 反代）；
4. GitHub 仓库 → Settings → Webhooks → 添加：
   - Payload URL：`http://你的域名/hooks/deploy`
   - Content type：`application/json`；Secret：与 `SECRET` 一致；事件：仅 push
   
完成后，本地 `git push` → GitHub 通知服务器 → 自动 `git pull` → 网站即时更新。

## 五、配色说明

参考千问 AI 平台的浅色设计语言：近白背景 `#f7f8fa`、纯白卡片、克制的靛紫强调色 `#615ced`、中性灰文字层级，无装饰图标。暗色主题一键切换（顶栏"暗色"按钮，跟随系统自动首选项）。
