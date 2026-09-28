"""PatMail 一键启动。

启动当前仓库里的本地服务，并在结束时一起关掉。

- 插件：每次启动先在 patmail-extension 执行一次生产构建，结果写入 dist
- 管理端原型：项目根目录的 Vite，地址 5173
- 插件工作台是 dist 里的扩展页面，不另开本地端口
"""

from __future__ import annotations

import functools
import os
import shutil
import signal
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND_PORT = 5173
FRONTEND_URL = f"http://127.0.0.1:{FRONTEND_PORT}"
EXTENSION = ROOT / "patmail-extension"

processes: list[subprocess.Popen[str]] = []
stopping = False
print = functools.partial(print, flush=True)


def registry_paths() -> list[str]:
    if sys.platform != "win32":
        return []
    import winreg

    found: list[str] = []
    keys = (
        (winreg.HKEY_CURRENT_USER, r"Environment"),
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    )
    for hive, subkey in keys:
        try:
            with winreg.OpenKey(hive, subkey) as key:
                value, _ = winreg.QueryValueEx(key, "Path")
        except OSError:
            continue
        if isinstance(value, str):
            found.extend(
                os.path.expandvars(part.strip())
                for part in value.split(os.pathsep)
                if part.strip()
            )
    return found


def search_path() -> str:
    local = os.environ.get("LOCALAPPDATA", "")
    roaming = os.environ.get("APPDATA", "")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    directories = [
        *os.environ.get("PATH", "").split(os.pathsep),
        *registry_paths(),
        str(Path(program_files) / "nodejs"),
        str(Path(program_files_x86) / "nodejs"),
        str(Path(local) / "Programs" / "nodejs"),
        str(Path(roaming) / "npm"),
        str(Path(local) / "pnpm"),
    ]
    unique: list[str] = []
    for directory in directories:
        if directory and directory not in unique:
            unique.append(directory)
    return os.pathsep.join(unique)


def command(name: str) -> str | None:
    path = search_path()
    if sys.platform == "win32":
        found = shutil.which(f"{name}.cmd", path=path)
        if found:
            return found
    return shutil.which(name, path=path)


def tool_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = search_path()
    return env


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    if processes:
        stop()
    if sys.platform == "win32" and sys.stdin.isatty():
        try:
            input("按回车关闭...")
        except EOFError:
            pass
    raise SystemExit(1)


def ensure_frontend(runner: str) -> None:
    vite_js = ROOT / "node_modules" / "vite" / "bin" / "vite.js"
    if vite_js.is_file():
        return
    print("管理端依赖不完整，正在按锁文件恢复...")
    # 只恢复根目录管理端。不能把插件目录算进这次安装，否则会改写锁文件。
    result = subprocess.run(
        [runner, "install", "--frozen-lockfile", "--ignore-workspace"],
        cwd=ROOT,
        env=tool_env(),
        check=False,
    )
    if result.returncode != 0 or not vite_js.is_file():
        fail("管理端依赖恢复失败。请在项目根目录查看 pnpm install 的输出。")


def stop() -> None:
    global stopping
    if stopping:
        return
    stopping = True
    print("\n正在停止服务...")
    for proc in processes:
        if proc.poll() is not None:
            continue
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            proc.terminate()
    for proc in processes:
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()


def handle_stop(signum: int, _frame: object) -> None:
    stop()
    raise SystemExit(0)


def pipe_output(proc: subprocess.Popen[str], ready: threading.Event) -> None:
    if proc.stdout is None:
        return
    for line in proc.stdout:
        print(line, end="")
        if "Local:" in line:
            ready.set()


def build_extension(runner: str) -> None:
    if not (EXTENSION / "package.json").is_file():
        fail("找不到 patmail-extension/package.json，无法编译插件。")
    if not (EXTENSION / "node_modules" / "vite").is_dir():
        print("插件依赖不完整，正在按插件目录的锁文件恢复...")
        install = subprocess.run(
            [runner, "install", "--frozen-lockfile"],
            cwd=EXTENSION,
            env=tool_env(),
            check=False,
        )
        if install.returncode != 0:
            fail("插件依赖恢复失败。请在 patmail-extension 目录查看 pnpm install 的输出。")
    print(f"编译插件    {EXTENSION / 'dist'}")
    build = subprocess.run(
        [runner, "run", "build"],
        cwd=EXTENSION,
        env=tool_env(),
        check=False,
    )
    if build.returncode != 0:
        fail(f"插件编译失败，退出码 {build.returncode}。管理端没有启动。")
    print("插件编译完成。若 Chrome 已加载该扩展，请在扩展管理页重新加载。")
    print()


def start_logged(runner: str, args: list[str], cwd: Path) -> subprocess.Popen[str]:
    proc = subprocess.Popen(
        [runner, *args],
        cwd=cwd,
        env=tool_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    processes.append(proc)
    return proc


def start_frontend(runner: str) -> subprocess.Popen[str]:
    if not (ROOT / "package.json").is_file():
        fail("项目根目录没有 package.json，无法启动管理端。")
    ensure_frontend(runner)
    print(f"启动管理端  {FRONTEND_URL}")
    return start_logged(
        runner,
        ["exec", "vite", "--host", "127.0.0.1", "--port", str(FRONTEND_PORT), "--strictPort"],
        ROOT,
    )


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    signal.signal(signal.SIGINT, handle_stop)
    if sys.platform == "win32":
        signal.signal(signal.SIGBREAK, handle_stop)

    runner = command("pnpm") or command("npm")
    if runner is None:
        fail("未找到 pnpm 或 npm。请先安装 Node.js。")

    print("PatMail")
    print(f"管理端原型  {FRONTEND_URL}")
    print(f"插件目录    {EXTENSION / 'dist'}")
    print("每次启动都会先编译插件。工作台跟着扩展走：在 Chrome 里点 PatMail 图标，或在 EASY 页面点「打开工作台」。")
    print("按 Ctrl+C 停止。")
    print()

    build_extension(runner)
    frontend = start_frontend(runner)
    ready = threading.Event()
    threading.Thread(target=pipe_output, args=(frontend, ready), daemon=True).start()
    if ready.wait(timeout=40) and frontend.poll() is None:
        webbrowser.open(FRONTEND_URL)
    elif frontend.poll() is not None:
        fail(f"管理端启动失败，退出码 {frontend.returncode}。端口 {FRONTEND_PORT} 可能已被占用。")
    else:
        print("管理端还没有打印访问地址，请查看上方日志。")

    code = frontend.wait()
    stop()
    raise SystemExit(code)


if __name__ == "__main__":
    main()
