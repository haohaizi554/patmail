# Phase 2.2 模板合并

合并函数是 `resolveQueryTemplate(base, customer, temporary)`。它不修改入参，结果放在 `Object.create(null)` 上。

## 优先级

```text
临时覆盖 > 客户覆盖 > 基础模板
```

判断依据是键是否存在，而不是值是否为真。客户把 `filetype` 设为 `""` 时，最终 `filetype` 是空字符串，来源记为 `customer`。某一层没有这个键时，保留下一层已经写入的值。

来源标记：

| `sources` | 界面文案 |
|---|---|
| `base` | 基础模板 |
| `customer` | 客户配置 |
| `temporary` | 临时输入 |

未注册键、非字符串值和 `__proto__` / `prototype` / `constructor` 只进入 `warnings`，不进入 `fields`。

## 显示文本

预览在来源仍是基础模板、且该字段有 `displayValues` 时显示文本，例如文件描述显示「专利证书」而请求仍使用 GUID。客户或临时覆盖改过该字段后，预览显示覆盖后的原始值，避免用旧的中文名称盖住新的 ID。

## 进入 GetSearchFiles

`buildGetSearchFilesFromFields` 使用同一份 116 项请求字段表。系统字段（页码、`Call`、`IsFirst`、`is_pat`、`colsel`、`_t`、`log_pagename`）由函数自己填写。

`fileclass` 和 `case_type` 只在字段不存在时回落当前环境默认值。显式空字符串会盖掉默认值。这两个字段即使有值，也不算「有效筛选」。除此之外，至少要有一个已注册业务字段的非空值，否则返回「不能进行全库查询」，不发请求。

`filetype` 非空时必须是逗号分隔的 GUID。`app_no` 会去掉点号，与手工查询一致。

## 客户配置

`CustomerQueryProfile.baseTemplateId` 指向 EASY 的 `query_id` 或本地模板 ID。找不到或 XML 无法解析时，界面标出配置异常，不改绑其他模板。`easyCustomerId` 只有在用户填入并通过 GUID 校验时才保存，不会按客户名称生成。

临时条件目前是我方文号、申请号、附件名称。勾选后即使输入为空也参与覆盖；取消勾选则该键不存在。「恢复基础模板」只清空临时条件，客户覆盖还在。

选择模板或客户不会自动查询。
