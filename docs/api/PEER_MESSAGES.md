# 个人连接消息 API

日期：2026-11-12 · 契约规范：基于 `peer_connections` 的私密会话消息。

## 概述与权限

- 路径前缀 `/api/v1/connections/:connectionId/messages`。
- 均需真实有效个人用户会话（actor 从会话自动推导，不接受外部传入的 sender 参数）。
- Web 端写请求（POST/DELETE）必须提供合法 `X-CSRF-Token`；移动端使用 Bearer 认证。
- 仅属于该连接的两位用户可调用收发与列表接口，其他用户一律返回 404（避免泄露连接存在性）。

## 端点列表

### 1. 发送消息

- **方法**: `POST`
- **路径**: `/api/v1/connections/:connectionId/messages`
- **请求体**:
  ```json
  {
    "content": "你好，关于下周活动的事项想和你沟通一下",
    "clientMessageId": "c9a1d3f5-6218-4e89-8d72-88ef5f3d43a1"
  }
  ```
  - `content`: 字符串，必填，trim 后长度 1..4000。
  - `clientMessageId`: UUID，必填，由客户端生成，用于发送幂等保证。
- **响应 (201 Created)**:
  ```json
  {
    "id": "b3e21820-80a5-42d4-bb3f-21f48641198c",
    "connectionId": "f1a23456-789a-4bcd-ef01-23456789abcd",
    "senderUserId": "a1111111-1111-4111-a111-111111111111",
    "content": "你好，关于下周活动的事项想和你沟通一下",
    "clientMessageId": "c9a1d3f5-6218-4e89-8d72-88ef5f3d43a1",
    "createdAt": "2026-11-12T11:40:00.000Z"
  }
  ```
- **幂等与冲突处理**:
  - 若同一 `connectionId` 与 `clientMessageId` 重复提交，且发送者与内容完全一致，返回现有消息（200 或 201），保证网络重试安全；
  - 若内容不一致或发送者不一致，返回 409 Conflict。

### 2. 消息倒序列表（游标分页）

- **方法**: `GET`
- **路径**: `/api/v1/connections/:connectionId/messages`
- **查询参数**:
  - `limit`: 整数，可选，1..50，默认 20。
  - `cursorCreatedAt`: ISO8601 时间戳，可选。
  - `cursorId`: UUID，可选，与 `cursorCreatedAt` 共同组成复合游标。
- **响应 (200 OK)**:
  ```json
  {
    "connectionId": "f1a23456-789a-4bcd-ef01-23456789abcd",
    "messages": [
      {
        "id": "b3e21820-80a5-42d4-bb3f-21f48641198c",
        "connectionId": "f1a23456-789a-4bcd-ef01-23456789abcd",
        "senderUserId": "a1111111-1111-4111-a111-111111111111",
        "content": "你好，关于下周活动的事项想和你沟通一下",
        "clientMessageId": "c9a1d3f5-6218-4e89-8d72-88ef5f3d43a1",
        "createdAt": "2026-11-12T11:40:00.000Z"
      }
    ],
    "nextCursor": {
      "createdAt": "2026-11-12T11:40:00.000Z",
      "id": "b3e21820-80a5-42d4-bb3f-21f48641198c"
    }
  }
  ```
  - 消息按 `createdAt DESC, id DESC` 排序。
  - 当前用户单方软删除的消息不会出现在此列表中。

### 3. 单方删除消息（软删除）

- **方法**: `DELETE`
- **路径**: `/api/v1/connections/:connectionId/messages/:messageId`
- **响应 (200 OK)**:
  ```json
  {
    "success": true,
    "messageId": "b3e21820-80a5-42d4-bb3f-21f48641198c"
  }
  ```
  - 操作仅在当前用户的视角下隐藏此消息（标记 `deleted_by_sender` 或 `deleted_by_recipient`）；
  - 对方仍可正常查看会话上下文；
  - 双方均删除后，系统后台 Worker 将在保留维护批次中物理清空消息正文。

## 错误代码

- `401 Unauthorized`: 未登录或会话失效
- `403 Forbidden`: 缺少 CSRF Token，或非个人用户身份
- `404 Not Found`: 连接不存在、非连接参与者、或消息不存在
- `409 Conflict`: 幂等键冲突（不同内容重用相同 clientMessageId）
- `422 Unprocessable Entity`: 内容为空、纯空白、超过 4000 字符、或 UUID 格式非法
