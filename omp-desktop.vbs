' Tiffa Desktop Launcher - 无控制台窗口启动 Electron
' 放置在便携包根目录，双击运行

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' 获取脚本所在目录（便携包根）
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
If Right(scriptDir, 1) = "\" Then scriptDir = Left(scriptDir, Len(scriptDir) - 1)

' Electron 二进制路径
electronExe = scriptDir & "\electron\node_modules\electron\dist\electron.exe"
electronDir = scriptDir & "\electron"

' 检查 Electron 是否存在
If Not fso.FileExists(electronExe) Then
    MsgBox "未找到 Electron：" & vbCrLf & electronExe & vbCrLf & vbCrLf & "请确认 electron 目录完整。", vbCritical, "Tiffa 桌面版"
    WScript.Quit 1
End If

' 启动 Electron（0 = 隐藏控制台窗口，False = 不等待）
shell.Run """" & electronExe & """ """ & electronDir & """ --portable-root=""" & scriptDir & """", 0, False
