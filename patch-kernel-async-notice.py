#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tiffa 内核补丁：修复后台任务完成通知的「状态自相矛盾」。

症状
----
agent 收到后台任务交付帧时看到矛盾状态：
    Background job bg_4 has completed. Resume your work using the result below.
    ...
    Command exited with code 2
帧头说「完成」（成功语义），正文却是非 0 退出（失败）。弱模型据此可能误判，
后续回合行为不可预期。

根因（内核 dist/cli.js）
-----------------------
生成 async-result 通知的 xCs() 构造模板数据时**刻意丢弃了 job.status**
（只取 type / label），模板因此无从区分成功与失败，帧头恒为 "has completed"。
正文 {{this.result}} 才是真正的命令输出（含 `Command exited with code N`）。

外挂（plugins/*.ts）拦不到这里 —— 它是内核内部模板，且交付走消息注入而非 tool_result。

修法（3 处，幂等）
-----------------
1. xCs 的 map 补 `failed` 判定：job.status==="failed" 或 result 含非 0 exit code；
   并打 `Tiffa-patch:async-exitcode` 标记，供升级后识别。
2. 多任务帧头 "have completed" -> "have finished"（中性措辞）。
3. 单任务帧头按 jobs[0].failed 分叉：失败 -> "has failed. Review the error below."，
   成功 -> 保持 "has completed. Resume your work using the result below."

权威定义：**命令 exit code 为准**（非 0 = 失败）；job 的 "completed" 仅表示进程结束、有结果。

⚠️ 内核 `npm-global/` 是 gitignore（不入库），升级内核会整包覆盖 → 升级后需重新执行本脚本。
   **不需要手动跑**：install.ps1 会在安装/升级尾声自动执行仓库根的 `patch-kernel-*.py`
   （`Invoke-KernelPatches`，幂等）。本脚本手动执行仅用于：内网机器单独补打、或诊断。

用法
----
    python patch-kernel-async-notice.py [便携包根目录]
    # 不给根目录时依次尝试 $PORTABLE_ROOT、脚本所在目录
    # 约定：参数唯一 = 便携包根目录；已打过则退出 0；锚点失配则非 0 且不写盘

注：**进度输出刻意用英文 ASCII**——install.ps1 调用时读的是子进程 stdout，
   中文在 PS 5.1 下会按控制台代码页解码成乱码（实测 `[ok] 已打过补丁` → `宸叉墦杩囪ˉ涓?`）。
   中文保留在注释/docstring 里（本文件自身的编码不经那条管道）。
"""
import os
import shutil
import sys

MARK = b"Tiffa-patch:async-exitcode"

EDITS = [
    # 1) xCs: 给模板数据补 failed 判定（含标记）
    (
        b'if(e.length===0)return null;let t=e.map((s)=>({jobId:s.jobId,result:s.result,'
        b'type:s.job?.type,label:s.job?.label,durationMs:s.durationMs}))',
        b'if(e.length===0)return null;/*Tiffa-patch:async-exitcode*/let t=e.map((s)=>('
        b'{jobId:s.jobId,result:s.result,type:s.job?.type,label:s.job?.label,'
        b'durationMs:s.durationMs,failed:s.job?.status==="failed"'
        b'||/Command exited with code \\d+/.test(String(s.result||""))}))',
    ),
    # 2) 多任务帧头：completed -> finished（中性）
    (
        b"{{jobs.length}} background jobs have completed. Resume your work using the results below.",
        b"{{jobs.length}} background jobs have finished. Resume your work using the results below.",
    ),
    # 3) 单任务帧头：按 failed 分叉
    (
        b"{{else}}Background job {{jobs.[0].jobId}} has completed. "
        b"Resume your work using the result below.",
        b"{{else}}Background job {{jobs.[0].jobId}} "
        b"{{#if jobs.[0].failed}}has failed. Review the error below."
        b"{{else}}has completed. Resume your work using the result below.{{/if}}",
    ),
]


def main() -> int:
    if len(sys.argv) > 1:
        root = sys.argv[1]
    elif os.environ.get("PORTABLE_ROOT"):
        root = os.environ["PORTABLE_ROOT"]
    else:
        root = os.path.dirname(os.path.abspath(__file__))

    cli = os.path.join(
        root, "npm-global", "node_modules", "@oh-my-pi", "pi-coding-agent", "dist", "cli.js"
    )
    if not os.path.isfile(cli):
        print(f"[skip] kernel bundle not found: {cli}")
        print("       arg must be the Tiffa portable root (containing npm-global/).")
        return 1

    data = open(cli, "rb").read()
    if MARK in data:
        print("[ok] already patched, skip (idempotent)")
        return 0

    # 只在三处都唯一命中时才动手，避免命中错位的旧/新内核
    for i, (old, _new) in enumerate(EDITS, 1):
        c = data.count(old)
        if c != 1:
            print(f"[fail] anchor {i} matched {c} time(s), expected 1 -- kernel bundle changed; nothing written")
            return 1

    bak = cli + ".bak-async-exitcode"
    if not os.path.exists(bak):
        shutil.copy2(cli, bak)
        print(f"[bak] {bak}")

    for old, new in EDITS:
        data = data.replace(old, new, 1)
    open(cli, "wb").write(data)
    print("[done] kernel patched: async-result notice now distinguishes success / failure")
    print("       restart Tiffa to take effect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
