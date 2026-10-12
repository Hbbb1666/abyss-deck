#!/bin/sh
# 把手机端的改动打包成补丁，交给桌面端 apply + 推送
#
#   sh tools/handoff.sh           生成补丁到 dist/handoff-<时间>.patch
#
# 另一条路：给容器一个 GitHub fine-grained token（只需 repo 内容读写权限），
#   手机端就能直接 push，不必走补丁。用完请立刻在 GitHub 设置里撤销该 token。
#
# 桌面端拿到补丁后：
#   git checkout main && git pull
#   git apply --check dist/handoff-xxx.patch && git apply dist/handoff-xxx.patch
#   npm run build && npm test && git push
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
OUT="dist/handoff-$(date +%Y%m%d-%H%M%S).patch"

# sw.js 的 VERSION 是构建期自动盖章的，跨机器必然不同 —— 不进补丁，免得每次冲突
git diff -- . ':(exclude)sw.js' > "$OUT"
git diff --stat -- . ':(exclude)sw.js' | tail -25

if [ ! -s "$OUT" ]; then echo "（没有改动）"; rm -f "$OUT"; exit 0; fi
echo
echo "✅ 补丁: $OUT"
echo "   桌面端: git apply $OUT && npm run build && npm test && git push"
