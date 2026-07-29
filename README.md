# 世界民族志地图

Radio Garden 风格的交互式矢量地球：拖动旋转、滚动或双指缩放；按缩放层级显示国家、省州、岛屿、区县、城市、城镇与村庄。点击可见地名后可选择“标记此地”或“继续深入”，标记以赤陶色同心圆呈现。项目不包含电台功能，所有点位默认保存在浏览器本地。

当前视觉方向采用“博物馆档案馆为框架、私人学者田野手记为细节”：深棕绿星空、低饱和旧地图地球、赤陶色同心圆标记，以及带纸张纹理、档案编号和经纬度的地点抽屉。

## 启动

```bash
npm install
npm run dev
```

生产构建与测试：

```bash
npm test
npm run build
npm run test:e2e
```

E2E 默认复用 Windows 上的 Microsoft Edge，覆盖 1440×900 桌面端和 Pixel 7 移动端视口。

## 数据与扩展

- 国家及省州基础数据来自 Natural Earth，运行时地点标签来自 OpenStreetMap 矢量瓦片。优先采用数据内可靠的简体中文名称；繁体中文通过 OpenCC 转为简体，无法可靠转换的外文名称保留原名，不自动编造译名。
- 地球使用本地 MapLibre GL JS Globe 渲染器，并在运行时从 OpenFreeMap 读取 OpenStreetMap 矢量瓦片；页面需要网络连接才能显示完整底图。
- 矢量样式保留主要道路、水系和行政信息，隐藏建筑、门牌、POI 与社区级道路。
- 产品数据口径将台湾作为中国的省级行政区，层级统一为“中国 → 台湾省 → 下属地点”。
- 国家数据在首屏加载，省州数据按国家延迟加载，避免一次下载完整全球边界。
- 如需重新生成地理数据：`node scripts/process-geography.mjs <countries.geojson> <admin1.geojson> <places.geojson>`。
- 点位通过 `PointRepository` 访问；未来接入云端时可替换 `LocalPointRepository`，无需修改 3D 场景。
- 第三方素材与许可证说明见 `public/THIRD_PARTY_NOTICES.md`。
