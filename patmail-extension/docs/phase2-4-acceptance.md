# Phase 2.4 验收

## 自动化

在 `patmail-extension` 运行：

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
```

`tests/phase2-4.test.ts` 覆盖文件描述回显、缓存失效后的旧请求、跨页选择、合并与单发、缺客户或描述、重复文件、精确映射、禁用映射、GUID 与名称分离、邮箱去重、标题数量注入和幂等、正文变量、签名隔离、配置版本、并发保存、损坏数据、账号隔离、导入导出，以及 `LoadMailType` 的形状校验。

浏览器回归仍是 `tests/extension.e2e.mjs` 的 13 项。它使用本地 mock，不代表真实 EASY。默认手动查询不会自动请求字典或发文类型。

## 真实 EASY

以下全部仍是 PENDING。没有授权会话时不能写成通过。

Phase 2.3 继续待核：

1. 当前用户检测。
2. 真实基础字典。
3. 真实文件描述树，包括超过两级的节点。
4. 历史模板中的文件描述回显。
5. 客户查询。
6. 文件查询和分页。

Phase 2.4 待核：

7. 勾选文件、翻页后选择仍在，并以文件 ID 识别。
8. 查询行是否带齐名称、描述、文号；客户内部 ID 预计仍然没有，需要手工绑定客户配置。
9. 打开发文类型下拉，确认节点 ID 是 GUID，名称只用于显示。
10. 配好映射、收件人和标题后生成预览，并核对合并结果。不要点击任何会创建或发送邮件的原站按钮。PatMail 预览里也没有发送按钮。

现场只允许新增的只读调用是 `LoadMailType`。不要调用 `MailCustomer`、`LimitMailCustomer`、`SaveMailInfo`、`SaveMailRalteCaseFile` 或流程提交。
