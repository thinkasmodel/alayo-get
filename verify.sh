#!/usr/bin/env bash
# Alayo Get 验证契约。
#   bash verify.sh fast  —— 类型检查 + lint + 单元测试（改完代码就跑）
#   bash verify.sh full  —— fast + 生产构建 + manifest 约定检查（宣布完成前跑）
# 不用管道包裹任何把关命令：退出码必须来自命令本身。
set -euo pipefail
cd "$(dirname "$0")"

mode="${1:-fast}"
if [ "${mode}" != "fast" ] && [ "${mode}" != "full" ]; then
  echo "用法: bash verify.sh [fast|full]" >&2
  exit 2
fi

if [ ! -d node_modules ]; then
  npm ci
fi

echo "== typecheck"
npm run --silent typecheck
echo "== lint"
npm run --silent lint
echo "== test"
npm run --silent test

if [ "${mode}" = "full" ]; then
  echo "== build"
  npx wxt build
  echo "== manifest"
  node scripts/check-manifest.mjs
fi

echo "verify ${mode}: OK"
