# Changelog

## 0.1.2

- README 补上「审查」面板截图（npm 页面现在也能直接看到面板长什么样）。
- 新增本文件，回溯记录 0.1.0 / 0.1.1 的内容。
- 发布方式切到 **Trusted Publishing**：从本版本起由 GitHub Actions 用 OIDC 凭据发布，仓库里不再保存任何 npm token；工作流在该版本已存在时会跳过发布步骤，补 tag 不会让流水线报红。

## 0.1.1

- 安装段改成对用户可用的两种装法：`dsh plugin --profile <你的 profile> add dsh-warden`（npm 上的预构建版）与 `github:dingchenhui0618-arch/dsh-warden`（从源码直装）。原来那条写的是本机绝对路径加 `--profile web`，对别人没有意义。

## 0.1.0

首个版本：

- 两层审查门：先用本地正则筛（破坏性命令、敏感路径写入），命中者再交给审查模型按自然语言规则判定。
- 只放行或拦截，**永不返回 `ask`**；任何失败路径都放行，审查层坏掉不会把正常工作卡死。
- `$DSH_HOME/adversary.md` 存在时完全覆盖内置规则，按 mtime 自动重载，改完点面板上的「重载规则」即可，不用重启。
- 审计：每次**送审**追加一行 JSON 到 `$DSH_HOME/warden-audit.jsonl`；未送审的普通调用只进内存环形缓冲，不落盘。
- 对话视图「审查」面板：计数、最近 60 条判定、当前规则来自内置还是文件及其预览。
