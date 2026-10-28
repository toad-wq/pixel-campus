# 像素校园 · 延边大学（延吉校区）

用代码把延边大学延吉校区画成一张「星露谷风」像素地图：道路、建筑、绿地全部由程序生成，可缩放浏览。

## 预览

![preview](docs/preview.png)

## 特性

- 按《延边大学建筑分布图》还原道路与建筑
- 星露谷像素风：草地噪点、花丛、树、瓦楞屋顶、铺装碎石
- 分块烘焙渲染（4×3 块，256×256），运行时只做 `drawImage`
- 响应式布局，适配手机屏幕
- 缩放 100% ~ 400%
- 纯前端，无后端依赖

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:5173/

## 目录结构

```
src/
  pixel.js     像素绘制库（颜色打包 / setPixel / 帧缓冲）
  mapdata.js   类别网格数据（由建筑分布图生成）
  ground.js    地面渲染（草地 / 铺装 / 绿地 / 建筑）
  chunk.js     分块烘焙与缓存
  main.js      页面装配与交互
tools/         生成预览图的脚本
docs/          预览图
public/        静态资源
```

## 数据是怎么来的

1. 以《延边大学（延吉校区）建筑分布图》为源图
2. 按颜色分类：白色→铺装/道路、绿色→绿地、米黄→教学楼、蓝→宿舍
3. 降采样成 256×179 的类别网格（`src/mapdata.js`）
4. 渲染时逐格绘制星露谷风材质

想重新生成预览图：

```bash
node tools/render-preview.mjs
```

## 参与贡献

1. Fork 本仓库
2. 新建分支：`git checkout -b feature/your-feature`
3. 提交：`git commit -m "feat: 你的改动"`
4. Push 并开 Pull Request

欢迎提 Issue 讨论想法。

## License

MIT
