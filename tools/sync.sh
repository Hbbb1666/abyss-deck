#!/bin/sh
# 手机端 ↔ 线上仓库 同步工具
#
# 背景：这台手机上 git 的「读」是通的（fetch / ls-remote），
# 但「写」（push）会被网络掐断（GnuTLS recv error -110），
# 而且 github.com 的连通性时好时坏。所以：
#   · 拉取：优先 git fetch；失败就退到 codeload tarball（这条一直很稳）
#   · 推送：手机端不做，改动通过 tools/handoff.sh 打成补丁交给桌面端
#
# 用法：
#   sh tools/sync.sh pull     拉取线上最新（自动选路径）
#   sh tools/sync.sh status   看本地与线上的差异
set -e
REPO="${REPO:-Hbbb1666/abyss-deck}"
BRANCH="${BRANCH:-main}"
cd "$(dirname "$0")/.."

pull_git() {
  echo "→ 尝试 git fetch（浅拉取）"
  git -c http.version=HTTP/1.1 fetch --depth 1 origin "$BRANCH" 2>&1 | tail -2
}

pull_tarball() {
  echo "→ git 不通，改用 codeload tarball"
  TMP=$(mktemp -d)
  URL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
  curl -sL --max-time 180 -o "$TMP/repo.tgz" "$URL"
  [ -s "$TMP/repo.tgz" ] || { echo "❌ 下载失败"; rm -rf "$TMP"; exit 1; }
  tar xzf "$TMP/repo.tgz" -C "$TMP"
  SRC=$(find "$TMP" -maxdepth 1 -type d -name '*-*' | head -1)
  # 覆盖工作区，保留构建产物与本地日志
  (cd "$SRC" && tar cf - .) | tar xf - --overwrite
  rm -rf "$TMP"
  echo "→ 已用 tarball 覆盖工作区"
}

case "${1:-pull}" in
  pull)
    if ! pull_git; then pull_tarball; fi
    if [ -n "$(git rev-parse --short FETCH_HEAD 2>/dev/null)" ]; then
      echo "→ 对齐到 $(git rev-parse --short FETCH_HEAD)"
      git reset --hard FETCH_HEAD -q
    fi
    echo "✅ 当前 HEAD: $(git log -1 --format='%h %s' | cut -c1-72)"
    echo "   接下来：node tools/build.mjs && node tools/test.mjs"
    ;;
  status)
    git fetch --depth 1 -q origin "$BRANCH" 2>/dev/null || true
    echo "本地: $(git log -1 --format='%h %s' 2>/dev/null | cut -c1-60)"
    echo "线上: $(git log -1 --format='%h %s' FETCH_HEAD 2>/dev/null | cut -c1-60)"
    echo "--- 差异 ---"
    git diff --stat HEAD FETCH_HEAD 2>/dev/null | tail -20
    echo "--- 未提交改动 ---"
    git status --short | head -20
    ;;
  *) echo "用法: sh tools/sync.sh [pull|status]";;
esac
