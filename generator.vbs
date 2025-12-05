Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\user\Documents\git\dummy-generator"
WshShell.Run "cmd /c npm start", 1, False