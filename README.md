# LukeWrt

在线定制 OpenWrt 固件：选型号、选软件包，云端用官方 ImageBuilder 现做现下。

- 前端：OpenWrt Firmware Selector（GPL-2.0）
- 接口：兼容 OpenWrt ASU 的 Cloudflare Worker
- 构建：GitHub Actions + 官方 `ghcr.io/openwrt/imagebuilder` 容器
- 存储：Cloudflare R2
