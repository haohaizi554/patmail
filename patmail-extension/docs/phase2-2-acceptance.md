> 本文不是现行产品说明。插件现在怎么工作，见 [../../README.md](../../README.md)。使用范围见 [../../LICENSE](../../LICENSE)。

# Phase 2.2 验收

自动化使用脱敏 fixture 和 mock transport，不访问真实 EASY。

## 历史模板

- [x] Options 列表归一化为 id / name / source
- [x] Options 为 null 或空数组时得到空列表
- [x] Options 结构非法、缺 title 时 `INVALID_RESPONSE`
- [x] IsLogin 为 false 时会话失效
- [x] 传输超时返回 `REQUEST_TIMEOUT`
- [x] 指定 query_id 读取 query_xml
- [x] 详情没有 XML 时视为模板不存在
- [x] 详情 Options 为 null 时沿用列表缓存标题
- [x] 非 GUID 的 query_id 在发请求前拒绝
- [ ] 扩展界面在真实 EASY 会话中刷新历史模板

## QueryXml

- [x] 正常 xmlRoot、空字符串、中文、GUID、`&amp;`
- [x] `_text` 进入显示值，不进入请求字段
- [x] 未知节点进入 unknownFields
- [x] 重复字段保留最后一个并警告
- [x] 空 XML、非法 XML、缺少 xmlRoot、DOCTYPE、超长、节点过多均拒绝

## 合并与查询

- [x] 仅基础模板、加客户、加临时、三层同时存在
- [x] 空字符串覆盖；缺键不覆盖；不修改原对象
- [x] 原型污染键和未注册键不进入请求
- [x] 合并结果交给 116 字段 Builder，分页参数保留
- [x] 空条件，以及只有 case_type / fileclass 时拒绝全库查询
- [x] 未注册或伪造 Call 被拒绝
- [x] 手工查询路径仍由原 Builder 处理（既有 file-search 测试）

## 客户与存储

- [x] 本地模板保存、改名、删除；拒绝把 EASY 模板写入本地仓库
- [x] 客户新增后可删除；非法 GUID 被拒绝
- [x] 损坏的模板项被跳过；版本不一致时不覆盖原数据
- [ ] 在已登录的 EASY 页面里完成一次客户配置查询

## 界面

- [x] 默认仍是手动查询，e2e 仍能找到唯一的「查询文件」按钮
- [x] 历史模板和客户模板区域只在切换来源后挂载
- [ ] 真实页面上的预览、导入和翻页尚未人工点过

命令结果见 [phase2-2-report.md](phase2-2-report.md)。
