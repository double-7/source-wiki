---
title: "{{API 名称}}"
created: 2026-04-21T00:00:00Z
updated: 2026-04-21T00:00:00Z
tags: []
depends: []
modules: []
flows: []
features: []
---

# {{API 名称}}

> 本页面属于架构级文档。API 文档只记录端点的**契约**（参数、返回值、错误码），不记录内部实现。实现细节在对应的 feature 或 module 页面中。
> 核心章节必须包含。扩展章节仅在源码有明确证据时添加，无证据不要创建。
> 证据判定：✅ 源码中存在对应方法/类/常量 ｜ ✅ 配置文件中存在对应字段 ｜ ❌ 仅凭命名推测 ｜ ❌ 从其他页面推断

## 概述

> 用 1-2 句话描述这组 API 的用途。

## 端点列表

| 方法   | 路径           | 说明     |
|--------|----------------|----------|
| GET    | `/api/resource` | 获取资源列表 |
| POST   | `/api/resource` | 创建资源 |
| GET    | `/api/resource/:id` | 获取单个资源 |
| PUT    | `/api/resource/:id` | 更新资源 |
| DELETE | `/api/resource/:id` | 删除资源 |

## 端点详情

### `GET /api/resource`

**描述**：获取资源列表

**请求参数**：

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| page | query | number | 否 | 页码，默认 1 |
| limit | query | number | 否 | 每页条数，默认 20 |

**响应**：

```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

**错误码**：

| 状态码 | 说明 |
|--------|------|
| 400    | 参数错误 |
| 401    | 未认证 |
| 500    | 服务器错误 |

### `POST /api/resource`

> 同上格式，逐一展开每个端点。

## 关联的实现

| 端点 | 实现方 |
|------|--------|
| POST /api/resource/login | [[features/user-login]] |
| POST /api/resource/register | [[features/user-register]] |

> 链接到实现该端点的 feature 或 module 页面。本页面不重复描述实现逻辑。

## 认证方式

> 【扩展章节】API 需要认证时添加（Bearer Token、API Key、Session 等），无认证要求时不要创建此章节。

## 调用示例

> 【扩展章节】API 有典型调用场景时添加。示例可能过时，仅在必要时添加。

```bash
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/resource?page=1&limit=10
```
