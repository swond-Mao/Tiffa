"""LibreOffice UNO 服务管理：ensure_server / stop_server（invisible 模式）。

关键经验（踩坑记录）:
1. 全新 profile 必须先用命令行转换预热 Impress，否则服务模式 loadComponentFromURL 卡死。
2. invisible 服务生命周期内只能稳定处理一个 Impress 文档，故每个命令后必须 stop_server。
3. socket 端口轮询不会污染 UNO 连接（已验证）；等端口开立即操作（服务空闲过久会异常）。
4. 服务端存在 Writer 文档时打开 Impress 会挂起，故不设占位文档。
5. doc.close() 会报 bridge disposed（无害），由调用方 safe_close 容错。
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lo_path  # noqa: E402

PORT = 2002


def _port_open(port, timeout=1.0):
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=timeout)
        s.close()
        return True
    except OSError:
        return False


def _warmup(lo_dir, profile_dir):
    """全新 profile 用命令行转换预热 Impress（创建完整初始化状态）。"""
    exe = os.path.join(lo_dir, "program", "soffice.exe")
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "base.pptx")
    tmp = tempfile.mkdtemp(prefix="lo_warm_")
    try:
        subprocess.run(
            [exe, "--headless",
             "-env:UserInstallation=file:///%s" % profile_dir.replace("\\", "/"),
             "--convert-to", "pdf", "--outdir", tmp, base],
            capture_output=True, timeout=120)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def ensure_server(port=PORT, lo_dir=None, wait=30):
    """确保 UNO 服务就绪。profile 未初始化先预热；socket 轮询端口开立即返回。"""
    lo_dir = lo_dir or lo_path.find_libreoffice_dir()
    if not lo_dir:
        return False
    profile_dir = os.path.join(lo_dir, "profile")
    if not os.path.isfile(os.path.join(profile_dir, "user", "registrymodifications.xcu")):
        _warmup(lo_dir, profile_dir)
    exe = os.path.join(lo_dir, "program", "soffice.exe")
    env = dict(os.environ)
    subprocess.Popen(
        [exe, "--invisible", "--nodefault", "--norestore", "--nologo",
         "--accept=socket,host=127.0.0.1,port=%d;urp;" % port,
         "-env:UserInstallation=file:///%s" % profile_dir.replace("\\", "/")],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(wait):
        if _port_open(port):
            time.sleep(3)  # 端口开后等 Impress 就绪，避免首个文档打开挂起
            return True
        time.sleep(1)
    return False


def stop_server():
    subprocess.run(["taskkill", "/F", "/IM", "soffice.bin"], capture_output=True)
    subprocess.run(["taskkill", "/F", "/IM", "soffice.exe"], capture_output=True)
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-Process | Where-Object {$_.Name -like 'soffice*'} | Stop-Process -Force"],
                   capture_output=True)
    time.sleep(3)
    return True


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "stop":
        stop_server()
        print("UNO 服务已停止")
    else:
        ok = ensure_server()
        print("UNO 服务就绪" if ok else "UNO 服务启动失败（请先部署 LibreOffice）")
        sys.exit(0 if ok else 1)
