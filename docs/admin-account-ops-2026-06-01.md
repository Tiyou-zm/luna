# 管理员账号运维说明

## 原则

普通注册和微信一键登录都只能创建普通用户：

- `role: "user"`
- `is_admin: false`

管理员账号不再由“第一个注册用户”自动产生，只能通过后台指令授予或撤销。

## 后台指令

云函数：`dbApi`

### 授予管理员

```json
{
  "action": "setUserAdmin",
  "username": "target_username",
  "isAdmin": true,
  "setupToken": "后台配置的 ADMIN_SETUP_TOKEN"
}
```

也可以用 openid：

```json
{
  "action": "setUserAdmin",
  "openid": "target_openid",
  "isAdmin": true,
  "setupToken": "后台配置的 ADMIN_SETUP_TOKEN"
}
```

### 撤销管理员

```json
{
  "action": "setUserAdmin",
  "username": "target_username",
  "isAdmin": false,
  "setupToken": "后台配置的 ADMIN_SETUP_TOKEN"
}
```

## 权限保护

`setUserAdmin` 需要满足其一：

- 调用者当前微信 openid 已经是管理员；
- 或云函数环境变量 `ADMIN_SETUP_TOKEN` 已配置，且请求里的 `setupToken` 与其一致。

建议上线前在云开发控制台给 `dbApi` 配置 `ADMIN_SETUP_TOKEN`，只在后台操作时使用，不要写进小程序前端。
