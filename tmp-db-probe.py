import os
import pymssql

conn = pymssql.connect(
    server="183.36.43.66", port="8097", user="sa", password=os.environ["DB_PWD"],
    database="IPEasy-D", timeout=20, login_timeout=15, tds_version="7.0", charset="utf8",
)
cur = conn.cursor()

for db in ("IPEasy-D", "IPEasy-X"):
    cur.execute(f"SELECT COUNT(*) FROM [{db}].dbo.c_customer")
    count = cur.fetchone()[0]
    print(f"\n== {db} dbo.c_customer 行数: {count} ==")

for db in ("IPEasy-D", "IPEasy-X"):
    cur.execute(f"""
SELECT TOP 3 customer_id, customer_name FROM [{db}].dbo.c_customer
WHERE customer_name LIKE '%海目星%'
""")
    rows = cur.fetchall()
    print(f"\n== {db} 里的海目星 ==")
    for row in rows:
        print(" ", row)

for db in ("IPEasy-D", "IPEasy-X"):
    cur.execute(f"""
SELECT TOP 3 customer_id, customer_name FROM [{db}].dbo.c_customer
WHERE customer_name LIKE '%安士精密%' OR customer_name LIKE '%安易控%' OR customer_name LIKE '%微慕%'
""")
    rows = cur.fetchall()
    print(f"\n== {db} 里的其他中小客户样例 ==")
    for row in rows:
        print(" ", row)

cur.execute("""
SELECT c.name, t.name AS type_name FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.c_customer')
ORDER BY c.column_id
""")
print("\n== dbo.c_customer 列 ==")
print([f"{r[0]}({r[1]})" for r in cur.fetchall()])
conn.close()