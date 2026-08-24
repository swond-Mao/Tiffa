"""LibreOffice 便携版路径发现（供 uno_client / start_server / deploy 复用）。"""
import json
import os
import shutil

CONFIG_NAME = ".lo_config.json"
COMMON_PATHS = [
    "E:/Tools/LibreOffice",
    "D:/Tools/LibreOffice",
    "C:/Tools/LibreOffice",
    "C:/Program Files/LibreOffice",
    "C:/Program Files (x86)/LibreOffice",
]


def skill_dir():
    return os.path.dirname(os.path.abspath(__file__))


def config_path():
    return os.path.join(skill_dir(), CONFIG_NAME)


def write_config(lo_dir):
    with open(config_path(), "w", encoding="utf-8") as f:
        json.dump({"libreoffice_dir": lo_dir}, f, indent=2)


def find_libreoffice_dir():
    """返回 LibreOffice 根目录（含 program/soffice.exe），找不到返回 None。"""
    env = os.environ.get("LIBREOFFICE_DIR")
    if env and os.path.isfile(os.path.join(env, "program", "soffice.exe")):
        return env
    cfg = config_path()
    if os.path.isfile(cfg):
        try:
            d = json.load(open(cfg, encoding="utf-8")).get("libreoffice_dir")
            if d and os.path.isfile(os.path.join(d, "program", "soffice.exe")):
                return d
        except Exception:
            pass
    for p in COMMON_PATHS:
        if os.path.isfile(os.path.join(p, "program", "soffice.exe")):
            return p
    soffice = shutil.which("soffice")
    if soffice:
        d = os.path.dirname(os.path.dirname(soffice))
        if os.path.isfile(os.path.join(d, "program", "soffice.exe")):
            return d
    return None


def find_lo_python():
    d = find_libreoffice_dir()
    if not d:
        return None
    py = os.path.join(d, "program", "python.exe")
    return py if os.path.isfile(py) else None
