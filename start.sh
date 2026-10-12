#!/bin/sh
# 启动本地服务器，然后用手机浏览器打开 http://127.0.0.1:8765
cd "$(dirname "$0")"
echo "深渊牌局服务启动中…  打开 http://127.0.0.1:8765"
exec node server.mjs
