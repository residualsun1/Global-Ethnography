# 民族志数据档案

[在线演示](https://global-ethnography.pages.dev/) · [GitHub 仓库](https://github.com/residualsun1/Global-Ethnography)

<p align="center">
  <img src="./public/assets/branding/project-icon.png" alt="民族志数据档案项目图标" width="180" />
</p>

一个以交互式地球与平面地图为入口的民族志个人知识档案。项目将作品、作者、田野地点、研究时间、研究轨迹和主题标签组织在同一套可视化界面中。

## 主要能力

- 在 3D 地球与 2D 地图之间切换，浏览国家、省州和地点。
- 按地点建立民族志档案，记录版本、作者、田野时间、出版信息、标签和 Markdown 阅读札记。
- 按研究者、国籍、时间和主题查看档案之间的关系。
- 私人档案保存在当前浏览器的 IndexedDB 中，不会自动上传。
- 支持 JSON 导出、合并导入、覆盖恢复以及清空前备份提醒。
- 首次访问会显示一份只读公开演示档案；演示数据与私人档案完全分离。

## 技术架构

| 层级 | 实现 |
| --- | --- |
| 应用 | React 19、TypeScript、Vite |
| 地图 | MapLibre GL JS，支持 Globe 与平面投影 |
| 本地持久化 | Dexie / IndexedDB |
| 地理数据 | Natural Earth、本地城市索引、OpenStreetMap / OpenFreeMap |
| 测试 | Vitest、Playwright |
| 部署形态 | 无服务器静态站点 |

运行时只有地图样式和瓦片依赖网络。档案数据默认不经过服务器，因此不同设备、浏览器配置或网站域名之间不会自动同步。

## 本地开发

需要 Node.js 22 和 npm 10 或更高版本。

```bash
npm ci
npm run dev
```

常用检查：

```bash
npm run build
npm test
npm run test:e2e
npm run check
```

端到端测试覆盖 1440×900 桌面视口与 Pixel 7 移动视口，包括地图视图切换、研究工具、演示档案和 JSON 备份恢复流程。

## 数据与隐私

- 公开演示内容位于 `src/demoArchives.ts`，应只包含经过核查、脱敏且版权明确的资料。
- 用户自行录入的档案位于浏览器 IndexedDB 数据库 `world-ethnographic-archive`。
- 清除浏览器网站数据、改用其他浏览器配置或改变访问域名，都可能使原有本地档案不可见。
- 重要档案应定期导出为 JSON，并将备份文件保存在浏览器之外。
- 本地上传的封面和作者图片会以 Data URL 写入 IndexedDB，建议控制图片体积。

## 地理数据口径

- 国家和省州基础边界来自 Natural Earth，运行时地图标签与瓦片来自 OpenStreetMap / OpenFreeMap。
- 优先使用数据源中的可靠简体中文名称；繁体中文通过 OpenCC 转换，无法可靠转换的外文名称保留原名。
- 国家数据随首屏加载，省州数据按国家延迟加载。
- 地理数据处理脚本：

```bash
node scripts/process-geography.mjs <countries.geojson> <admin1.geojson> <places.geojson>
```

地图和第三方素材的来源、版权及许可证信息见 [`public/THIRD_PARTY_NOTICES.md`](./public/THIRD_PARTY_NOTICES.md)。

## 部署

项目构建后生成 `dist` 目录，可部署到 Cloudflare Pages、Vercel、Netlify 或其他静态托管服务。

推荐配置：

```text
Build command: npm run build
Output directory: dist
Node version: 22
```

生产环境应保留 `public/_headers` 中的安全响应头，并在获得正式域名后将 Open Graph 图片地址更新为绝对 HTTPS 地址。
