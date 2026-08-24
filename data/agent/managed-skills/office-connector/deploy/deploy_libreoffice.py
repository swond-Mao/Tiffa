#!/usr/bin/env python3
"""一键部署 LibreOffice 便携版（Windows）。

用法:
    python deploy_libreoffice.py [--dest DIR] [--source auto|tuna|official]

流程: 检测 -> 下载官方 MSI -> lessmsi 解包 -> 部署 -> 验证 -> 写路径配置
Linux/macOS: 提示使用系统包管理器。
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lo_path  # noqa: E402

VERSION = "25.8.7"
MSI = "LibreOffice_%s_Win_x86-64.msi" % VERSION
SOURCES = {
    "tuna": "https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable/%s/win/x86_64/%s" % (VERSION, MSI),
    "official": "https://download.documentfoundation.org/libreoffice/stable/%s/win/x86_64/%s" % (VERSION, MSI),
}
LESSMSI_URL = "https://github.com/activescott/lessmsi/releases/download/v2.12.9/lessmsi-v2.12.9.zip"
TMP_MARK = "lo_deploy_"


def _dl(url, path, label=""):
    print("下载 %s ..." % (label or url))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                print("  %d%% (%d MB)" % (done * 100 // total, done // (1 << 20)), end="\r")
    print()


def _download_first(urls, path):
    for u in urls:
        try:
            _dl(u, path, u.rsplit("/", 1)[-1])
            return path
        except Exception as e:
            print("源失败: %s (%s)" % (u, e))
    raise RuntimeError("所有下载源均失败")


def _verify(dest):
    exe = os.path.join(dest, "program", "soffice.exe")
    r = subprocess.run([exe, "--version"], capture_output=True, timeout=60)
    print("soffice --version exit=%s" % r.returncode)
    work = tempfile.mkdtemp(prefix=TMP_MARK)
    try:
        txt = os.path.join(work, "t.txt")
        with open(txt, "w", encoding="utf-8") as f:
            f.write("LibreOffice deploy test")
        out = os.path.join(work, "out")
        os.makedirs(out)
        profile = "file:///%s" % (dest + "/profile").replace("\\", "/")
        r2 = subprocess.run(
            [exe, "--headless", "-env:UserInstallation=%s" % profile,
             "--convert-to", "pdf", "--outdir", out, txt],
            capture_output=True, timeout=120)
        pdfs = [f for f in os.listdir(out) if f.endswith(".pdf")]
        if not pdfs:
            raise RuntimeError("转换验证失败: %s" % r2.stderr.decode("utf-8", "ignore")[:300])
        print("转换验证 OK: %s" % pdfs[0])
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="LibreOffice 便携版一键部署")
    ap.add_argument("--dest", default=None, help="目标目录（默认 E:/Tools/LibreOffice 或 LIBREOFFICE_DIR）")
    ap.add_argument("--source", default="auto", choices=["auto", "tuna", "official"], help="下载源")
    ap.add_argument("--force", action="store_true", help="验证失败时强制重新部署")
    args = ap.parse_args()

    if sys.platform != "win32":
        print("Linux/macOS: 请用系统包管理器安装:")
        print("  Debian/Ubuntu: sudo apt-get install libreoffice")
        print("  macOS: brew install --cask libreoffice")
        print("安装后设置环境变量 LIBREOFFICE_DIR 指向安装目录即可。")
        return

    dest = args.dest or os.environ.get("LIBREOFFICE_DIR") or "E:/Tools/LibreOffice"
    exe = os.path.join(dest, "program", "soffice.exe")
    if os.path.isfile(exe):
        ok = False
        try:
            r = subprocess.run([exe, "--version"], capture_output=True, timeout=60)
            ok = r.returncode == 0
            if not ok:
                print("soffice --version 返回 %s: %s" % (r.returncode, r.stderr.decode("utf-8", "ignore")[:200]))
        except subprocess.TimeoutExpired:
            print("soffice --version 超时（60s），视为验证失败")
        except Exception as e:
            print("验证异常: %s" % e)
        if ok:
            print("已存在可用部署: %s（跳过）" % dest)
            lo_path.write_config(dest)
            return
        print("检测到 %s 但验证失败" % exe)
        if not args.force:
            print("已保留现有安装。如确需重新部署，请加 --force 参数。")
            return

    work = tempfile.mkdtemp(prefix=TMP_MARK)
    try:
        urls = [SOURCES[args.source]] if args.source != "auto" else [SOURCES["tuna"], SOURCES["official"]]
        msi = os.path.join(work, MSI)
        _download_first(urls, msi)

        lz = os.path.join(work, "lessmsi.zip")
        _dl(LESSMSI_URL, lz, "lessmsi-v2.12.9.zip")
        with zipfile.ZipFile(lz) as z:
            z.extractall(os.path.join(work, "lessmsi"))
        lessmsi = os.path.join(work, "lessmsi", "lessmsi.exe")

        print("解包 MSI ...")
        subprocess.run([lessmsi, "x", msi, "-o", os.path.join(work, "x")], check=True, timeout=900)

        src = os.path.join(work, "x", "SourceDir", "LibreOffice")
        if not os.path.isfile(os.path.join(src, "program", "soffice.exe")):
            alt = os.path.join(work, "x", "SourceDir", "Program Files", "LibreOffice")
            if os.path.isfile(os.path.join(alt, "program", "soffice.exe")):
                src = alt
            else:
                raise RuntimeError("解包后未找到 LibreOffice 主目录")

        parent = os.path.dirname(dest) or "."
        os.makedirs(parent, exist_ok=True)
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.move(src, dest)

        ini = os.path.join(dest, "update-settings.ini")
        if os.path.isfile(ini):
            with open(ini, "w", encoding="utf-8") as f:
                f.write("; auto update disabled\n[Settings]\nACCEPTED_MAR_CHANNEL_IDS=\n")

        _verify(dest)
        lo_path.write_config(dest)
        print("部署完成: %s" % dest)
        print("后续可运行技能命令: 见 SKILL.md / README.md")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
