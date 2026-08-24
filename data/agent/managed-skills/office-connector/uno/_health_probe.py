"""UNO 服务健康探测：仅验证连接可用，不打开文档（避免 Impress 多文档挂起）。"""
import sys

try:
    import uno

    lc = uno.getComponentContext()
    res = lc.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", lc)
    ctx = res.resolve("uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext")
    desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    sys.exit(0 if desktop is not None else 1)
except Exception:
    sys.exit(1)
