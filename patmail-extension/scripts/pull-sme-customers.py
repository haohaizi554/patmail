"""拉一份中小客户名单快照到 public/assets/sme-customers.json。

中小客户的 GetCustomerlist 接口有三万多家，响应要二三十分钟，插件走不过来。
这个脚本从备份数据库 IPEasy-X 直读客户编号和名称，写成静态快照打包进扩展。

用法（密码只从环境变量读，不写进脚本和仓库）：

    set DB_PWD=...
    python scripts/pull-sme-customers.py

跑完重新构建扩展，快照就是新的。客户管理里的「重新读取」在中小客户模式下只会重读这份文件。
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymssql

SERVER = "183.36.43.66"
PORT = "8097"
DATABASE = "IPEasy-X"
USER = "sa"
# vite 的 publicDir 在仓库根的 public/，不是 patmail-extension/public。
OUT = Path(__file__).resolve().parents[2] / "public" / "assets" / "sme-customers.json"


def main() -> int:
    password = os.environ.get("DB_PWD", "")
    if not password:
        print("缺 DB_PWD 环境变量（数据库 sa 密码）。不在脚本里存密码。")
        return 1
    conn = pymssql.connect(
        server=SERVER,
        port=PORT,
        user=USER,
        password=password,
        database=DATABASE,
        timeout=30,
        login_timeout=15,
        tds_version="7.0",
        charset="utf8",
    )
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT customer_id, customer_name FROM dbo.c_customer "
            "WHERE customer_name IS NOT NULL AND customer_name <> '' "
            "ORDER BY customer_name"
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    customers = [[str(row[0]).strip(), str(row[1]).strip()] for row in rows]
    taken = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"takenAt": taken, "count": len(customers), "customers": customers}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"已写 {OUT}：{len(customers)} 家，{OUT.stat().st_size // 1024} KB，快照时间 {taken}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())