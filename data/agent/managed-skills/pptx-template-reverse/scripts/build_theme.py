# -*- coding: utf-8 -*-
"""build_theme.py — 按配置构建主题模板
用法: python build_theme.py <theme_config.json>
配置格式见 SKILL.md Step 3 / references/case-hejiang.md
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from theme_lib import build


def main():
    if len(sys.argv) < 2:
        print('usage: python build_theme.py <theme_config.json>')
        sys.exit(1)
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    build(cfg)


if __name__ == '__main__':
    main()
