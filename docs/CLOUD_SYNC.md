# 云端认证与同步部署

项目默认保持纯本地模式。只有同时设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY` 后，构建才会显示登录与同步入口。

## 1. 创建环境

至少准备两个 Supabase 项目：预发布和生产。不要让本地开发、预览部署直接连接生产数据库。

使用 Supabase CLI 将仓库链接到预发布项目，然后应用 `supabase/migrations` 中的迁移：

```bash
supabase login
supabase link --project-ref <staging-project-ref>
supabase db push
```

迁移会创建：

- `archives`：档案正文、地点快照、版本和单调同步序列；
- `editor_memberships`：受邀编辑者白名单；
- `processed_archive_mutations`：幂等请求记录；
- 私有 `archive-media` Storage bucket；
- 数据表和 Storage 的 RLS 策略；
- 负责乐观并发控制的 `apply_archive_mutation` RPC。

迁移不会创建或修改国家、行政区、城市或几何边界表。底图继续来自仓库中受完整性校验保护的只读静态资产。

## 2. 创建首位管理员

在 Supabase Dashboard 的 Authentication 中创建或邀请用户。用户产生后，在 SQL Editor 中执行：

```sql
insert into public.editor_memberships(user_id, role)
select id, 'admin'
from auth.users
where email = 'admin@example.com'
on conflict (user_id) do update set role = excluded.role;
```

保持公开注册关闭。以后每位编辑者都必须同时存在于 Auth 和 `editor_memberships`；只有 Auth 账号而没有成员记录时，数据库会拒绝写入。

## 3. 配置前端

复制 `.env.example` 为本机 `.env.local`，或在 Cloudflare Pages 中设置：

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
VITE_SUPABASE_MEDIA_BUCKET=archive-media
```

Publishable key 可以进入浏览器；service-role、数据库密码和 Storage S3 secret 绝不能使用 `VITE_` 前缀或进入仓库。

先在预发布环境完成以下验收，再把同一迁移应用到生产：

1. 未登录访客只能读取已发布且未删除的档案。
2. 编辑者只能读取、更新自己的私人档案。
3. 非成员 Auth 用户写入时收到权限错误。
4. 本地创建后显示“待同步”，联网同步后变为“私人草稿”。
5. 点击发布后，无痕窗口无需重新部署即可看到档案。
6. 两台设备同时修改同一档案时出现冲突选择，而不是静默覆盖。
7. 私人档案的 Storage 签名链接无法由其他账号取得。

## 4. 迁移现有 IndexedDB 档案

用户登录后，地点档案面板会显示“备份并上传本机档案”。该操作先下载一份可移植 JSON，再把旧档案认领到当前账号并作为私人草稿进入 outbox。服务端逐条确认前，IndexedDB 原记录不会被清除。

导入的 JSON 一律重置为当前账号的私人草稿；备份文件中的 `ownerId`、发布状态和服务端版本不会被信任。

## 5. 同步和冲突语义

- 本地保存和 outbox 写入使用同一 IndexedDB 事务。
- 每个档案只保留最新待提交变更，并携带稳定 `mutationId`。
- 服务端使用 `baseRevision` 原子比较；版本不匹配返回冲突。
- 拉取以 `change_sequence` 为游标，包含软删除记录。
- Realtime 不是正确性的依赖；登录、联网恢复和页面重新可见都会执行推送后拉取。
- 冲突必须由用户选择“保留本机”或“保留云端”。

## 6. 地理信息保护

`npm run geography:verify` 必须在 CI 中通过。若确实要更新 Natural Earth 或城市数据：

1. 在独立分支运行 `scripts/process-geography.mjs`；
2. 审查国家数量、行政区数量、名称、坐标范围和政治数据测试；
3. 运行 `npm run geography:manifest` 显式接受新的完整性哈希；
4. 提交生成资产和 manifest，并通过代码审查；
5. 不通过档案同步 API 上传或修改任何边界多边形。

应用启动时的地点和国籍补全只作用于内存展示，不再写回仓库。需要修订历史地点快照时，应编写一次性、可审计、可回滚的数据迁移。

## 7. 备份与恢复

Supabase 数据库备份不包含 Storage 对象内容，因此必须分别备份：

- 每日数据库备份；
- 每周 `supabase db dump` 或 `pg_dump` 到独立位置；
- 定期通过 Storage S3 接口将 `archive-media` 复制到独立对象存储；
- 保存对象路径、大小和 SHA-256 清单；
- 每季度在隔离项目中恢复数据库和媒体并实际打开档案验证。

用户侧 JSON 导出会把私有 Storage 图片重新嵌入为 Data URL，继续兼容现有 v1 备份格式。

## 8. 发布和回滚

上线顺序固定为：数据库迁移 → RLS 验证 → Storage 验证 → 设置前端环境变量 → 构建部署。回滚前端时不要回滚或删除数据库列；先移除前端环境变量即可恢复纯本地界面。任何生产数据清理都应在确认独立备份和恢复演练后进行。
