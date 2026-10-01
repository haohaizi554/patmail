> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 3.0 架构

正式界面是扩展内的完整页面 `app.html`。地址形如 `chrome-extension://<extension-id>/app.html`。`localhost:5173` 只作为根目录原型的开发预览，不是插件运行依赖。

```text
Full-page App
    → WORKSPACE / 既有任务消息
    → Background Service Worker
    → Customer / MailRule / AutomationTask / Evidence
    → chrome.storage.local / IndexedDB

EASY 请求
    → 用户选定的 easyTabId
    → chrome.tabs.sendMessage
    → Content Script
    → EasyRuntime
    → http://183.36.43.66:88
```

完整页面的 Origin 是 `chrome-extension://`。业务站点只来自 `EasyConnectionContext.easyOrigin`，也就是已确认的 `http://183.36.43.66:88`。

点击扩展图标时，`chrome.action.onClicked` 调用 `openWorkspaceTab`。已有 `app.html` 标签页会被激活，没有时才创建。`manifest.json` 不再包含 `action.default_popup`。

Content Script 在 `document_idle` 后不再调用 `injectPanel`。`SHOW_PANEL` 仍可打开旧浮窗，供兼容和调试。`src/floating/` 保留。

生产写开关保持关闭：`EASY_MAIL_WRITES_ENABLED`、`WORKFLOW_WRITES_ENABLED` 为 false，`productionWriteAllowed()` 固定返回 false。完整页面桥不转发 `CREATE_EASY_MAIL` 和 `SAVE_EASY_MAIL`。
