#!/usr/bin/env python3
"""一键部署 WPS Office（Windows）。

三级策略（按优先级）:
    1. 已安装: 注册表检测 KWPP.Application -> 直接跳过
    2. 本地离线包: <技能根>/offline/*.exe 存在 -> 静默安装 /S（无需网络）
    3. 在线获取: winget 官方源静默安装；失败则提示从官方 CDN 手动下载

用法:
    python deploy_wps.py [--offline <path-to-exe>]

授权提醒: 个人版免费但含推广内容；政企环境建议采购企业版授权。
"""
import argparse
import glob
import os
import subprocess
import sys
import time

WINGET_ID = "Kingsoft.WPSOffice"
COM_PROGIDS = ["KWPP.Application", "KWPP.Application.1"]
OFFICIAL_URLS = [
    "https://official-package.wpscdn.cn/wps/download/WPS_Setup_11691.exe",
    "https://wdl1.pcfg.cache.wpscdn.com/wpsdl/wpsoffice/download/wps_ai_version/win/WPS_Office.exe",
]


def skill_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def offline_package():
    off = os.path.join(skill_root(), "offline")
    if os.path.isdir(off):
        exes = sorted(glob.glob(os.path.join(off, "*.exe")))
        return exes[0] if exes else None
    return None


def wps_registered():
    for key in ("HKEY_CLASSES_ROOT\\%s" % pid for pid in COM_PROGIDS):
        try:
            r = subprocess.run(["reg", "query", key], capture_output=True, timeout=15)
            if r.returncode == 0:
                return True
        except Exception:
            pass
    return False


def silent_install(pkg, timeout=900):
    print("静默安装 %s ...（/S 参数，若弹出界面请手动完成）" % os.path.basename(pkg))
    try:
        r = subprocess.run([pkg, "/S"], capture_output=True, timeout=timeout)
        print("安装器退出码: %s" % r.returncode)
    except subprocess.TimeoutExpired:
        print("安装超时（%ds），WPS 可能仍在后台安装，稍后验证。" % timeout)


def download_official(dest_dir):
    import urllib.request
    os.makedirs(dest_dir, exist_ok=True)
    for url in OFFICIAL_URLS:
        dest = os.path.join(dest_dir, os.path.basename(url))
        try:
            print("下载 %s ..." % url.rsplit("/", 1)[-1])
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as f:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            return dest
        except Exception as e:
            print("源失败: %s (%s)" % (url.rsplit("/", 1)[-1], e))
    return None


def main():
    ap = argparse.ArgumentParser(description="WPS Office 一键部署")
    ap.add_argument("--offline", default=None, help="指定本地离线安装包路径")
    ap.parse_args()

    if sys.platform != "win32":
        print("仅支持 Windows。")
        return

    if wps_registered():
        print("已检测到 WPS COM 注册（KWPP.Application），无需安装。")
        return

    # 1) 本地离线包
    pkg = args.offline or offline_package()
    if pkg and os.path.isfile(pkg):
        silent_install(pkg)
        if wps_registered():
            print("WPS 部署完成（离线包）。")
            return
        print("离线包安装后 COM 未注册，尝试在线方式...")

    # 2) winget
    print("尝试 winget 安装官方包（%s）..." % WINGET_ID)
    r = subprocess.run(
        ["winget", "install", "--id", WINGET_ID,
         "--silent", "--accept-package-agreements", "--accept-source-agreements"],
        capture_output=True, text=True, timeout=900)
    if r.returncode == 0:
        print("winget 安装完成。")
        if wps_registered():
            print("WPS 部署完成。")
            return
    else:
        print("winget 不可用或失败: %s" % (r.stderr or r.stdout)[:200])

    # 3) 官方 CDN 直链下载后静默安装
    print("尝试从官方 CDN 下载...")
    dl = download_official(os.path.join(skill_root(), "offline"))
    if dl:
        silent_install(dl)
        if wps_registered():
            print("WPS 部署完成（CDN 包）。")
            return

    print("自动部署未成功。备选:")
    print("  1. 浏览器打开 https://www.wps.cn/ 下载安装包，放到 offline/ 后重跑本脚本")
    print("  2. 或手动安装 WPS 后重跑本脚本验证")


if __name__ == "__main__":
    main()
