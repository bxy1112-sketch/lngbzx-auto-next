# 公共 Userscript 分发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布一个任何人安装 Tampermonkey 后均可点击安装、并能自动更新的公开 userscript 地址。

**Architecture:** 公开仓库根目录中的 `lngbzx-auto-next.user.js` 是唯一正式发布文件。README 和 userscript 元数据共同指向稳定的 HTTPS 原始文件地址；契约测试防止版本、域名和链接漂移。

**Tech Stack:** Tampermonkey userscript metadata、Node.js 内置测试运行器、Git、公开 HTTPS 源码托管。

**Spec:** `docs/superpowers/specs/2026-09-02-public-userscript-distribution-design.md`

## Global Constraints

- 公开版本只处理真实媒体播放与自然结束，不伪造进度或绕过平台校验。
- 正式安装文件名固定为 `lngbzx-auto-next.user.js`。
- 分发 URL 必须是无需登录可访问的 HTTPS 稳定地址。
- 本次分发版本为 `3.0.2`。
- `@downloadURL`、`@updateURL` 和 README 一键安装链接必须一致。

---

### Task 1: 分发契约测试

**Files:**
- Create: `test/distribution.test.cjs`
- Read: `lngbzx-auto-next.user.js`
- Read: `README.md`

**Interfaces:**
- Consumes: userscript 元数据头和 README Markdown。
- Produces: 对版本、目标域名、HTTPS 安装地址及链接一致性的自动化契约。

- [ ] **Step 1: 写入失败测试**

测试解析 `// ==UserScript==` 到 `// ==/UserScript==`，要求 `@version 3.0.2`，并要求 `@downloadURL`、`@updateURL` 都存在、相等、为 HTTPS 且以 `/lngbzx-auto-next.user.js` 结束；README 必须包含同一地址。

- [ ] **Step 2: 运行测试并确认因缺少公开元数据而失败**

Run: `node --test test/distribution.test.cjs`

Expected: FAIL，指出缺少 `@downloadURL` 或版本仍为 `3.0.1`。

- [ ] **Step 3: 不修改生产文件，提交测试红灯证据到执行记录**

记录失败断言文本，作为下一任务的输入。

### Task 2: 正式脚本分发元数据

**Files:**
- Modify: `lngbzx-auto-next.user.js:1-12`

**Interfaces:**
- Consumes: Task 1 的元数据契约及最终公开仓库原始文件 URL。
- Produces: 可一键安装并自动更新的版本 `3.0.2` userscript。

- [ ] **Step 1: 将版本提升为 3.0.2**

修改 `@version`，不触碰脚本运行逻辑。

- [ ] **Step 2: 添加稳定更新地址**

在元数据块加入值完全相同的 `@downloadURL` 与 `@updateURL`，使用最终公开仓库的 HTTPS 原始文件地址。

- [ ] **Step 3: 运行分发测试确认转绿**

Run: `node --test test/distribution.test.cjs`

Expected: PASS。

### Task 3: 公开安装说明

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 2 的正式安装 URL。
- Produces: 可直接转发给接收者的安装和使用说明。

- [ ] **Step 1: 在 README 顶部加入一键安装链接**

链接文字固定为“点此一键安装脚本”，目标与 `@downloadURL` 完全一致。

- [ ] **Step 2: 将复制粘贴流程改成三步安装流程**

明确先安装 Tampermonkey、停用同站点旧脚本、点击安装链接；保留精确“我的课程”入口和右下角启动按钮说明。

- [ ] **Step 3: 再次运行分发测试**

Run: `node --test test/distribution.test.cjs`

Expected: PASS，README 与脚本地址一致。

### Task 4: 完整本地验证

**Files:**
- Verify: `lngbzx-auto-next.user.js`
- Verify: `test/auto-next.test.cjs`
- Verify: `test/distribution.test.cjs`

**Interfaces:**
- Consumes: Tasks 1-3 的发布候选文件。
- Produces: 语法和完整回归证据。

- [ ] **Step 1: 验证 JavaScript 语法**

Run: `node --check lngbzx-auto-next.user.js`

Expected: exit 0，无语法错误。

- [ ] **Step 2: 运行全部测试**

Run: `node --test test/*.test.cjs`

Expected: exit 0，0 failures。

- [ ] **Step 3: 检查只改动了分发相关内容**

Run: `git diff --check && git diff -- lngbzx-auto-next.user.js README.md test/distribution.test.cjs`

Expected: 无空白错误；userscript 正文运行逻辑无变化。

### Task 5: 公开发布与远端验证

**Files:**
- Publish: repository contents

**Interfaces:**
- Consumes: Task 4 验证通过的版本 `3.0.2`。
- Produces: 无需登录的公开仓库页和稳定一键安装 URL。

- [ ] **Step 1: 创建公开仓库并发布文件**

仓库公开可见，根目录包含 `lngbzx-auto-next.user.js` 与 `README.md`。

- [ ] **Step 2: 从匿名公开地址下载正式脚本**

Run: `curl --fail --location 'https://raw.githubusercontent.com/bxy1112-sketch/lngbzx-auto-next/main/lngbzx-auto-next.user.js' --output /tmp/lngbzx-auto-next.remote.user.js`

Expected: exit 0。

- [ ] **Step 3: 校验远端与本地发布文件一致**

Run: `cmp lngbzx-auto-next.user.js /tmp/lngbzx-auto-next.remote.user.js`

Expected: exit 0。

- [ ] **Step 4: 用浏览器打开正式安装 URL 验证安装确认页**

Expected: Tampermonkey 显示脚本名称、版本 `3.0.2`、匹配域名和“安装”操作。
