# 公共一键安装与自动更新设计

## 目标

把现有 `lngbzx-auto-next.user.js` 作为公开 Tampermonkey 用户脚本分发。接收者只需先安装 Tampermonkey，再点击一个稳定链接即可进入原生安装确认页；未来发布更高版本时，Tampermonkey 可从同一地址检查更新。

## 已批准的公开范围

- 脚本源码、README、测试和使用说明可以公开。
- 不包含账号、Cookie、课程记录、网站请求数据或任何个人信息。
- 公开版本继续坚持真实播放、真实结束后推进、自动静音，不伪造进度，不规避平台校验。

## 分发架构

GitHub 公开仓库 `bxy1112-sketch/lngbzx-auto-next` 是唯一发布源，默认分支根目录保留固定文件名 `lngbzx-auto-next.user.js`。脚本元数据中的 `@downloadURL` 与 `@updateURL` 均指向 `https://raw.githubusercontent.com/bxy1112-sketch/lngbzx-auto-next/main/lngbzx-auto-next.user.js`。README 顶部提供醒目的“一键安装”链接，并说明首次安装、升级、停用旧脚本和故障恢复流程。

安装链路：

1. 用户安装并启用 Tampermonkey。
2. 用户打开稳定的 `.user.js` 地址。
3. Tampermonkey 显示脚本名称、版本、权限和匹配站点。
4. 用户点击“安装”。
5. 后续版本通过 `@version` 递增和 `@updateURL` 被 Tampermonkey 识别。

## 文件职责

- `lngbzx-auto-next.user.js`：正式可安装脚本；只新增公开分发元数据，不改变本次任务之外的学习行为。
- `README.md`：公开首页、安装链接、三步使用说明、安全边界和故障恢复。
- `test/distribution.test.cjs`：校验 userscript 头部、固定文件名、HTTPS 更新地址、版本格式、匹配域名以及 README 安装链接一致性。
- `docs/superpowers/specs/...`：本设计依据。
- `docs/superpowers/plans/...`：可复核的实施步骤。

## 版本与更新策略

- 保留当前功能版本 `3.0.1`；仅分发元数据变化时升级为 `3.0.2`。
- 任何后续发布必须递增 `@version`，否则已安装用户不会收到更新。
- `@downloadURL` 与 `@updateURL` 必须使用固定文件名且不能包含提交哈希。
- 发布前必须验证原始地址返回完整 userscript，且首行是 `// ==UserScript==`。
- 发生错误时可通过仓库历史回滚公开文件，但不得降低版本号；回滚内容应以新的更高版本发布。

## 使用体验

README 的分享说明采用最短路径：

1. 安装 Tampermonkey。
2. 点击“一键安装脚本”。
3. 打开“我的课程”精确入口，点击右下角“开始连续学习”。

同时明确提醒停用同站点旧脚本，避免多个脚本互相抢占标签页。

## 验收标准

- 公共安装 URL 无需登录即可访问。
- 安装 URL 以 `.user.js` 结尾或由浏览器正确交给 Tampermonkey。
- 安装确认页显示版本 `3.0.2`、目标域名和预期权限。
- `@downloadURL`、`@updateURL` 与 README 的一键安装链接指向同一正式文件。
- `node --check lngbzx-auto-next.user.js` 通过。
- 原有完整测试和新增分发测试全部通过。
- 从公开地址重新获取的字节与本地发布文件一致。

## 非目标

- 不提供隐藏源码、加密或混淆。
- 不自动安装浏览器扩展，也不代替接收者点击 Tampermonkey 的最终“安装”按钮。
- 不增加绕过检测、伪造学习进度、自动答题或服务器接口调用。
