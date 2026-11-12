# Blocks and Reports API Specification

本文档定义用户屏蔽（拉黑）与违规举报的 HTTP API 契约。

## 1. 用户拉黑 (Blocks)

### 1.1 拉黑指定用户
`POST /api/v1/blocks`

- **请求头**：Cookie（含认证会话）与 `x-csrf-token`，或 Bearer Token。
- **请求体**：
  ```json
  {
    "blockedUserId": "uuid",
    "reason": "optional reason (max 500 chars)"
  }
  ```
- **响应**：`201 Created`
  ```json
  {
    "id": "uuid",
    "ownerUserId": "uuid",
    "blockedUserId": "uuid",
    "reason": "optional reason",
    "createdAt": "2026-11-12T13:00:00.000Z"
  }
  ```
- **错误**：
  - `400 Bad Request`：参数格式错误或尝试拉黑自己。
  - `401 Unauthorized`：未登录。
  - `404 Not Found`：目标用户不存在或已被禁用。

### 1.2 解除拉黑
`DELETE /api/v1/blocks/:userId`

- **请求头**：认证 Cookie/Bearer。
- **响应**：`200 OK`
  ```json
  {
    "unblocked": true
  }
  ```

### 1.3 获取本人的黑名单列表
`GET /api/v1/blocks`

- **请求头**：认证 Cookie/Bearer。
- **响应**：`200 OK`
  ```json
  {
    "blocks": [
      {
        "id": "uuid",
        "blockedUserId": "uuid",
        "reason": "optional reason",
        "createdAt": "2026-11-12T13:00:00.000Z"
      }
    ]
  }
  ```

---

## 2. 违规举报 (Reports)

### 2.1 提交举报
`POST /api/v1/reports`

- **请求头**：认证 Cookie/Bearer。
- **请求体**：
  ```json
  {
    "targetType": "user" | "peer_message" | "connection_invitation" | "event",
    "targetId": "uuid",
    "reason": "spam" | "harassment" | "inappropriate_content" | "privacy_violation" | "other",
    "details": "optional details (max 1000 chars)"
  }
  ```
- **响应**：`201 Created`
  ```json
  {
    "id": "uuid",
    "reporterUserId": "uuid",
    "targetType": "user",
    "targetId": "uuid",
    "reason": "spam",
    "details": "...",
    "status": "open",
    "createdAt": "2026-11-12T13:00:00.000Z"
  }
  ```
- **错误**：
  - `400 Bad Request`：分类或 targetType 不合法。
  - `401 Unauthorized`：未登录。

### 2.2 查询我的历史举报
`GET /api/v1/reports`

- **请求头**：认证 Cookie/Bearer。
- **响应**：`200 OK`
  ```json
  {
    "reports": [
      {
        "id": "uuid",
        "targetType": "user",
        "targetId": "uuid",
        "reason": "spam",
        "details": "...",
        "status": "open",
        "createdAt": "2026-11-12T13:00:00.000Z"
      }
    ]
  }
  ```
