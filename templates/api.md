---
title: "{{API 名称}}"
type: architecture
created: 2026-04-10
updated: 2026-04-10
source: "相关源码路径"
tags: []
related: []
guidelines: []
issues: []
---

# {{API 名称}}

> 本页面属于架构级文档。API 文档只记录端点的**契约**（参数、返回值、错误码），不记录内部实现。实现细节在对应的 [[feature]] 或 [[module]] 页面中。
> 如果某个章节不适用于当前项目（如无认证要求），直接删除该章节，而非留空表格。

## 概述

> 用 1-2 句话描述这组 API 的用途。

## 认证方式

> 描述这组 API 的认证方式（Bearer Token、API Key、Session 等）。

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

## 调用示例

```bash
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/resource?page=1&limit=10
```

## 关联的实现

| 端点 | 实现方 |
|------|--------|
| POST /api/resource/login | [[user-login]] |
| POST /api/resource/register | [[user-register]] |

> 链接到实现该端点的 feature 或 module 页面。本页面不重复描述实现逻辑。
